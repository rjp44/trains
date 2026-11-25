import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { Corridor } from '../rail.mjs';
import { createLiveFeed } from '../live.mjs';
import { scheduleCache } from './schedules.mjs';
import { stationArrivals } from './arrivals.mjs';
import { createProjection, encoder } from './projection.mjs';

const { values: args } = parseArgs({
  options: {
    recording: { type: 'string' },
    at: { type: 'string', default: '0' },
    once: { type: 'boolean' },
    qemu: { type: 'string' },
  },
});
const data = (name) => JSON.parse(readFileSync(new URL('../public/data/' + name + '.json', import.meta.url)));
const layout = data('corridor'),
  projection = createProjection(layout);
const presets = new Map([
  ['hemel', 'hemel-replay'],
  ['sector', 'replay'],
  ['watford', 'watford-replay'],
]);
if (args.recording && !presets.has(args.recording)) throw Error('Choose sector, hemel or watford');
const offset = Number(args.at) * 1000;
if (!Number.isFinite(offset) || offset < 0) throw Error('Invalid replay offset');
if (args.qemu && (!/^\d+$/.test(args.qemu) || Number(args.qemu) < 1 || Number(args.qemu) > 65535))
  throw Error('Invalid local QEMU UART port');

const { lookup, expire } = scheduleCache((html) => parseHTML(html).document.documentElement);
const arrivals = stationArrivals(layout);
const live = args.recording ? null : createLiveFeed(layout, { onFrame: arrivals.accept, onReset: arrivals.reset });
const recording = args.recording ? data(presets.get(args.recording)) : null;
let board = new Corridor(layout),
  frame = 0,
  previousTime = -1;
const start = Date.now();
function sample() {
  if (live) {
    const raw = live.snapshot();
    expire(Date.now());
    return [projection.project(raw, lookup, true), { Live: 1, Partial: 2, Stale: 3 }[raw.status] ?? 0, arrivals.take(raw.areaStatus.R1 === 'Live')];
  }
  const first = recording.startTime ?? recording.frames[0].time;
  const duration = recording.frames.at(-1).time - first;
  const time = first + ((Math.min(duration, offset) + (args.once ? 0 : Date.now() - start)) % (duration + 1));
  if (time < previousTime) {
    board = new Corridor(layout);
    frame = 0;
  }
  previousTime = time;
  while (frame < recording.frames.length && recording.frames[frame].time <= time)
    board.apply(recording.frames[frame++]);
  const archived = (s) =>
    s && recording.hemelCalls?.[s.id]?.uid === s.uid ? recording.hemelCalls[s.id] : null;
  return [projection.project(board, archived), 4];
}

let serial, controls;
if (args.qemu) {
  controls = createInterface({ input: process.stdin }).on('line', (line) => {
    const tap = /^tap (\d{1,4}) (\d{1,4})$/.exec(line.trim());
    if (tap && serial?.writable) serial.write('T\t' + tap[1] + '\t' + tap[2] + '\n');
  });
}
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});
live?.start();
try {
  do {
    const encode = encoder(projection.fingerprint);
    if (args.qemu) {
      serial = net.createConnection({ host: '127.0.0.1', port: Number(args.qemu) });
      serial.on('error', () => {});
      serial.on('data', (data) => process.stderr.write(data));
      try {
        await once(serial, 'connect');
      } catch (err) {
        if (args.once) throw err;
        await wait(1000);
        continue;
      }
    }
    const output = serial ?? process.stdout;
    do {
      const [state, status, entries = ''] = sample();
      if (args.once && live && status !== 1 && status !== 2) {
        if (Date.now() - start >= 45000) throw Error('No fresh public feed within 45 seconds');
        await wait(500);
        continue;
      }
      if (output.destroyed) break;
      if (!output.write(encode(state, status, false, entries))) {
        // At most one packet waits in a slow device's transport buffer.
        await new Promise((resolve) => {
          const done = () => {
            output.off('drain', done);
            output.off('close', done);
            resolve();
          };
          output.once('drain', done);
          output.once('close', done);
        });
      }
      if (args.once) break;
      await wait(1500);
    } while (!output.destroyed);
    serial?.end();
  } while (args.qemu && !args.once);
} finally {
  controls?.close();
  serial?.end();
  live?.stop();
}
