// -----------------------------------------------------------------------------
// REST client of evcc: the state, and the few write endpoints the integration
// uses (checked in evcc's server/http.go, 0.317):
//   POST /api/loadpoints/{id}/mode/{off|pv|minpv|now}   (id from 1)
//   POST /api/loadpoints/{id}/limitsoc/{0..100}          (0 = no session limit)
//   POST /api/loadpoints/{id}/limitenergy/{kWh}          (0 = no energy limit)
//   POST /api/vehicles/{name}/limitsoc/{0..100}
// None of them needs the admin password today; older versions or a reverse
// proxy may answer 401. Then, when a password is configured, the client logs
// in (POST /api/auth/login, cookie `auth`) and tries once more.
// -----------------------------------------------------------------------------

import { unwrapState } from './model.js';

// A command may take three requests (401, login, retry): 18 s at worst, within
// the 20 s Gladys gives an action.
export const REQUEST_TIMEOUT_MS = 6_000;
// The state of a large installation stays far below this; the cap protects
// the 256 MB sandbox from a wrong address answering an endless body.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** An evcc error: `kind` is `unreachable`, `unauthorized`, `refused` or `invalid`. */
export class EvccError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export class EvccClient {
  constructor({ baseUrl, password = '', fetch = globalThis.fetch, timeout = REQUEST_TIMEOUT_MS }) {
    this.baseUrl = baseUrl;
    this.password = password;
    this.fetch = fetch;
    this.timeout = timeout;
    this.cookie = null;
  }

  async #request(method, path, body) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(this.cookie ? { cookie: this.cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeout),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new EvccError('unreachable', `evcc unreachable (${reason})`);
    }
    return response;
  }

  async #readJson(response) {
    const raw = await response.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new EvccError('invalid', 'evcc answer too large');
    }
    try {
      return raw === '' ? null : JSON.parse(raw);
    } catch {
      throw new EvccError('invalid', `not an evcc answer (HTTP ${response.status})`);
    }
  }

  async #login() {
    const response = await this.#request('POST', '/api/auth/login', { password: this.password });
    await response.text().catch(() => '');
    if (response.status === 401 || response.status === 403) {
      throw new EvccError('unauthorized', 'evcc refused the admin password', response.status);
    }
    if (!response.ok) {
      throw new EvccError(
        'refused',
        `evcc login failed (HTTP ${response.status})`,
        response.status,
      );
    }
    const cookie = (response.headers.get('set-cookie') ?? '').match(/(?:^|,\s*)(auth=[^;]+)/);
    this.cookie = cookie ? cookie[1] : null;
    if (!this.cookie) {
      throw new EvccError('refused', 'evcc login gave no session');
    }
  }

  /** A request that may need the admin session: logs in once on 401. */
  async #call(method, path) {
    let response = await this.#request(method, path);
    if (response.status === 401 && this.password) {
      await response.text().catch(() => '');
      this.cookie = null;
      await this.#login();
      response = await this.#request(method, path);
    }
    if (response.status === 401 || response.status === 403) {
      await response.text().catch(() => '');
      throw new EvccError(
        'unauthorized',
        this.password ? 'evcc refused the admin password' : 'evcc asks for the admin password',
        response.status,
      );
    }
    return response;
  }

  /** The raw state (unwrapped), or throws an EvccError. */
  async getState() {
    const response = await this.#call('GET', '/api/state');
    if (!response.ok) {
      await response.text().catch(() => '');
      throw new EvccError('refused', `evcc answered HTTP ${response.status}`, response.status);
    }
    const state = unwrapState(await this.#readJson(response));
    if (!state) {
      throw new EvccError('invalid', 'not an evcc state (no loadpoints)');
    }
    return state;
  }

  async #write(path) {
    const response = await this.#call('POST', path);
    const body = await this.#readJson(response).catch(() => null);
    if (!response.ok) {
      const detail = typeof body?.error === 'string' ? `: ${body.error.slice(0, 120)}` : '';
      throw new EvccError(
        'refused',
        `evcc refused (HTTP ${response.status}${detail})`,
        response.status,
      );
    }
    return body;
  }

  setMode(loadpoint, mode) {
    return this.#write(`/api/loadpoints/${loadpoint}/mode/${mode}`);
  }

  setLimitSoc(loadpoint, soc) {
    return this.#write(`/api/loadpoints/${loadpoint}/limitsoc/${soc}`);
  }

  setLimitEnergy(loadpoint, kwh) {
    return this.#write(`/api/loadpoints/${loadpoint}/limitenergy/${kwh}`);
  }

  setVehicleLimitSoc(name, soc) {
    // The route of evcc only matches these characters (`db:3` for a vehicle
    // added in its interface): nothing to encode, and nothing else accepted.
    if (!/^[A-Za-z0-9_.:-]+$/.test(name)) {
      throw new EvccError('refused', 'vehicle name evcc cannot address');
    }
    return this.#write(`/api/vehicles/${name}/limitsoc/${soc}`);
  }
}

export function socketUrl(baseUrl) {
  return `${baseUrl.replace(/^http/i, 'ws')}/ws`;
}
