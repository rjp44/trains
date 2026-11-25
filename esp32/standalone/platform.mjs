// The IDF networking task pumps these adapters on one QuickJS context.
// HTTPS runs on its own task so a slow timetable cannot block TD updates.
let socket, generation = 0, subscription = '';
export class RelaySocket {
  constructor() {
    socket = this;
    this.generation = ++generation;
  }
  send(text) { subscription = text; }
  close() { if (socket === this) socket = null; }
}
export const socketId = () => socket?.generation || 0;
export function opened() {
  subscription = '';
  socket?.onopen();
  return subscription;
}
export const message = (data) => socket?.onmessage({ data });
export const closed = () => socket?.onclose();

const timers = new Map();
let serial = 0;
function timer(fn, ms, repeat) {
  const id = ++serial;
  timers.set(id, { fn, next: Date.now() + ms, repeat });
  return id;
}
export const timeout = (fn, ms) => timer(fn, ms, 0);
export const interval = (fn, ms) => timer(fn, ms, ms);
export const clear = (id) => timers.delete(id);
export function tick() {
  const now = Date.now();
  for (const [id, t] of timers) {
    if (t.next > now) continue;
    if (t.repeat) t.next = now + t.repeat;
    else timers.delete(id);
    t.fn();
  }
  return socketId();
}

const requests = [];
let active;
export class Controller {
  signal = { aborted: false };
  abort() {
    this.signal.aborted = true;
    for (const job of [...requests, active]) {
      if (job?.signal === this.signal) job.reject(Error('Lookup cancelled'));
    }
  }
}
export const Signal = { timeout(ms) {
  const c = new Controller();
  timeout(() => c.abort(), ms);
  return c.signal;
} };
export function get(url, { signal }) {
  return new Promise((resolve, reject) => {
    if (signal.aborted || requests.length >= 12) return reject(Error('Lookup unavailable'));
    requests.push({ url: String(url), signal, resolve, reject });
  });
}
export function request() {
  if (active) return '';
  while (requests.length) {
    const next = requests.shift();
    if (!next.signal.aborted) {
      active = next;
      return next.url;
    }
  }
  return '';
}
export function response(body) {
  if (active && !active.signal.aborted)
    active.resolve({ ok: !!body, text: () => body, json: () => JSON.parse(body) });
  active = null;
}
