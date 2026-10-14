// -----------------------------------------------------------------------------
// The push link of evcc: its websocket `/ws`, one JSON object per frame. The
// first frame holds every key of the state (flattened: `loadpoints.0.mode`),
// then evcc sends what changes at each cycle (30 s by default, `interval` of
// its configuration). No authentication.
//
// Node 22+ ships WebSocket as a global: no dependency needed.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const DEFAULT_SOCKET_TIMINGS = {
  // evcc sends at least the powers at each cycle; a cycle can be set to a
  // few minutes, so silence means a dead link only after a long while.
  idleTimeout: 5 * 60_000,
  reconnectMin: 2_000,
  reconnectMax: 60_000,
};

/**
 * Emits `message` (each parsed frame), `open` and `close` (with the number of
 * failed attempts so far). Reconnects by itself until stop().
 */
export class PushLink extends EventEmitter {
  constructor({ url, createSocket = (target) => new WebSocket(target), timings = {} }) {
    super();
    this.url = url;
    this.createSocket = createSocket;
    this.timings = { ...DEFAULT_SOCKET_TIMINGS, ...timings };
    this.socket = null;
    this.running = false;
    this.live = false;
    this.failures = 0;
    this.retryTimer = null;
    this.idleTimer = null;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    this.failures = 0;
    this.#open();
  }

  stop() {
    this.running = false;
    clearTimeout(this.retryTimer);
    clearTimeout(this.idleTimer);
    this.retryTimer = null;
    this.idleTimer = null;
    this.#drop();
    this.#setLive(false, '');
  }

  #open() {
    let socket;
    try {
      socket = this.createSocket(this.url);
    } catch (err) {
      this.#scheduleRetry(err.message);
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.#armIdle();
    socket.onmessage = (event) => this.#receive(socket, event.data);
    socket.onerror = () => {
      // The close event follows and carries the retry.
    };
    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.#scheduleRetry('socket closed');
    };
  }

  #receive(socket, raw) {
    if (this.socket !== socket) {
      return;
    }
    let data;
    try {
      data = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
    } catch {
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return;
    }
    this.#armIdle();
    if (!this.live) {
      this.failures = 0;
      this.#setLive(true);
    }
    this.emit('message', data);
  }

  #armIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.#drop();
      this.#scheduleRetry(`no message for ${Math.round(this.timings.idleTimeout / 1000)} s`);
    }, this.timings.idleTimeout);
    this.idleTimer.unref?.();
  }

  #setLive(live, reason) {
    if (this.live !== live) {
      this.live = live;
      this.emit(live ? 'open' : 'close', reason);
    }
  }

  #drop() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  #scheduleRetry(reason) {
    clearTimeout(this.idleTimer);
    if (!this.running) {
      return;
    }
    this.failures += 1;
    this.#setLive(false, reason);
    const delay = Math.min(
      this.timings.reconnectMax,
      this.timings.reconnectMin * 2 ** Math.min(this.failures - 1, 10),
    );
    this.emit('retry', { reason, delay, failures: this.failures });
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) {
        this.#open();
      }
    }, delay);
    this.retryTimer.unref?.();
  }
}
