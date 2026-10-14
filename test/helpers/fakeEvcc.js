// -----------------------------------------------------------------------------
// An evcc instance in memory: its REST API (a `fetch` implementation) and its
// websocket (a WebSocket stand-in), starting from the states recorded on
// `evcc --demo` 0.317.1 and 0.210.0 (test/fixtures/evcc/). The tests drive
// it: change a loadpoint or the site (pushed as evcc pushes, one frame per
// key), take evcc down, ask for the admin password.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

// Silent integration logs (LOG_LEVEL is read on every log call);
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../fixtures/evcc/${name}`, import.meta.url), 'utf8'));
}

export const PASSWORD = 'test-password';

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

class FakeSocket {
  constructor(server, url) {
    this.server = server;
    this.url = url;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    setImmediate(() => {
      if (this.closed) {
        return;
      }
      if (!server.websocket || server.down) {
        this.#close();
        return;
      }
      server.sockets.add(this);
      this.onopen?.();
      // evcc's first frame: every key, flattened like its updates.
      this.deliver(flatten(server.state));
    });
  }

  deliver(message) {
    if (!this.closed) {
      setImmediate(() => !this.closed && this.onmessage?.({ data: JSON.stringify(message) }));
    }
  }

  close() {
    this.#close();
  }

  #close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.server.sockets.delete(this);
    setImmediate(() => this.onclose?.({ code: 1000 }));
  }
}

/** The websocket form of a state: `loadpoints.0.mode`, other keys whole. */
export function flatten(state) {
  const frame = {};
  for (const [key, value] of Object.entries(state)) {
    if (key === 'loadpoints' && Array.isArray(value)) {
      value.forEach((lp, index) => {
        for (const [field, item] of Object.entries(lp)) {
          frame[`loadpoints.${index}.${field}`] = item;
        }
      });
    } else {
      frame[key] = value;
    }
  }
  return frame;
}

export function createEvcc({
  host = '192.0.2.20:7070',
  state = fixture('state-0.317.1.json'),
  wrap = false,
  websocket = true,
  password = null,
} = {}) {
  const server = {
    host,
    url: `http://${host}`,
    state: structuredClone(state),
    wrap,
    websocket,
    password,
    down: false,
    sockets: new Set(),
    requests: [],
    writes: [],
    sessions: new Set(),

    /** Push a loadpoint change (index from 0), one frame per key as evcc does. */
    setLoadpoint(index, patch) {
      Object.assign(server.state.loadpoints[index], patch);
      for (const [field, value] of Object.entries(patch)) {
        server.push({ [`loadpoints.${index}.${field}`]: value });
      }
    },

    /** Push top-level keys (`homePower`, `grid`, `vehicles`...). */
    setSite(patch) {
      Object.assign(server.state, patch);
      for (const [key, value] of Object.entries(patch)) {
        server.push({ [key]: value });
      }
    },

    push(message) {
      for (const socket of server.sockets) {
        socket.deliver(message);
      }
    },

    /** evcc stops: sockets closed, requests fail. */
    stop() {
      server.down = true;
      for (const socket of [...server.sockets]) {
        socket.close();
      }
    },

    restart() {
      server.down = false;
    },

    createSocket(url) {
      return new FakeSocket(server, url);
    },

    async fetch(input, init = {}) {
      const url = new URL(input);
      const method = init.method ?? 'GET';
      if (server.down) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      server.requests.push({ method, path: url.pathname });
      if (url.pathname === '/api/auth/login' && method === 'POST') {
        const body = JSON.parse(init.body ?? '{}');
        if (!server.password || body.password !== server.password) {
          return json(401, { error: 'invalid password' });
        }
        const token = `token-${server.sessions.size + 1}`;
        server.sessions.add(token);
        return json(200, null, { 'set-cookie': `auth=${token}; Path=/; HttpOnly` });
      }
      if (server.password) {
        const cookie = init.headers?.cookie ?? '';
        const token = cookie.match(/auth=([^;]+)/)?.[1];
        if (!server.sessions.has(token)) {
          return json(401, { error: 'unauthorized' });
        }
      }
      if (url.pathname === '/api/state' && method === 'GET') {
        return json(200, server.wrap ? { result: server.state } : server.state);
      }
      const lp = url.pathname.match(
        /^\/api\/loadpoints\/(\d+)\/(mode|limitsoc|limitenergy)\/(.+)$/,
      );
      if (lp && method === 'POST') {
        const index = Number(lp[1]) - 1;
        const loadpoint = server.state.loadpoints[index];
        if (!loadpoint) {
          return json(404, { error: 'loadpoint not found' });
        }
        server.writes.push({ loadpoint: index + 1, [lp[2]]: lp[3] });
        if (lp[2] === 'mode') {
          if (!['off', 'pv', 'minpv', 'now', 'smart'].includes(lp[3])) {
            return json(400, { error: `invalid value: ${lp[3]}` });
          }
          // evcc 0.317 translates the legacy values (evcc-io/evcc#32490).
          if ('alwaysCharge' in loadpoint && ['pv', 'minpv'].includes(lp[3])) {
            server.setLoadpoint(index, {
              mode: 'smart',
              alwaysCharge: lp[3] === 'minpv' ? 'on' : 'off',
            });
          } else {
            server.setLoadpoint(index, { mode: lp[3] });
          }
          return json(200, { result: lp[3] });
        }
        if (lp[2] === 'limitsoc') {
          server.setLoadpoint(index, { limitSoc: Number(lp[3]), effectiveLimitSoc: Number(lp[3]) });
          return json(200, { result: Number(lp[3]) });
        }
        server.setLoadpoint(index, { limitEnergy: Number(lp[3]) });
        return json(200, { result: Number(lp[3]) });
      }
      const vehicle = url.pathname.match(/^\/api\/vehicles\/([A-Za-z0-9_.:-]+)\/limitsoc\/(\d+)$/);
      if (vehicle && method === 'POST') {
        const [, name, value] = vehicle;
        if (!server.state.vehicles?.[name]) {
          return json(400, { error: 'vehicle not found' });
        }
        server.writes.push({ vehicle: name, limitsoc: value });
        const vehicles = structuredClone(server.state.vehicles);
        vehicles[name].limitSoc = Number(value);
        server.setSite({ vehicles });
        return json(200, { result: Number(value) });
      }
      return json(404, { error: 'not found' });
    },
  };
  return server;
}

export function network(...servers) {
  const byHost = (url) => {
    const host = new URL(url).host;
    const server = servers.find((s) => s.host === host);
    if (!server) {
      throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
    }
    return server;
  };
  return {
    fetch: async (input, init) => byHost(input).fetch(input, init),
    createSocket: (url) => byHost(url.replace(/^ws/, 'http')).createSocket(url),
  };
}

/** Let the pending promises and setImmediate callbacks run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Wait until a condition holds (timers of the hub included), or fail. */
export async function until(condition, { timeout = 2000, what = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
}
