import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { Corridor } from './rail.mjs';
import { abbeyCandidates, lookupURL, stationReport } from './abbey.mjs';

const { values: options } = parseArgs({
  options: {
    port: { type: 'string', default: '8174' },
    record: { type: 'string' },
    replay: { type: 'string' },
  },
});
const port = Number(options.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Choose a port from 1 to 65535');
const root = new URL('./public/', import.meta.url);
const layout = JSON.parse(await readFile(new URL('data/corridor.json', root)));
const board = new Corridor(layout);
let customReplay;
if (options.replay) {
  const lines = (await readFile(options.replay, 'utf8')).trim().split(/\r?\n/);
  const frames = lines.map((line) => JSON.parse(line));
  if (
    !frames.some((f) => f.full) ||
    !frames.every((f) => Number.isFinite(f.time) && (f.values || f.services || f.abbey))
  ) {
    throw Error('Expected a corridor recording beginning with a full snapshot');
  }
  customReplay = JSON.stringify({ source: 'Signal Maps public relay', frames });
}
const recording = options.record ? createWriteStream(options.record, { flags: 'wx' }) : null;
if (recording) await once(recording, 'open');
const relay = 'wss://ws.signalmaps.co.uk/new';
const freshness = 45000;
let socket,
  retry,
  timer,
  running = true,
  transport = 'Connecting',
  backoff = 2000;
let abbeyTimer,
  timetableReady = false;
const abbeyStations = new Set(layout.branches.find((b) => b.id === 'abbey').stations.map((s) => s.code));
let lastId,
  connectedAt,
  lastArea,
  lastError = '';

function connect() {
  transport = 'Connecting';
  board.newConnection();
  timetableReady = false;
  lastId = undefined;
  lastArea = 0;
  connectedAt = Date.now();
  socket = new WebSocket(relay);
  socket.onopen = () => {
    transport = 'Synchronising';
    socket.send(
      JSON.stringify({
        Message: {
          type: 'SET_OPTIONS',
          areas: layout.areas,
          timestamp: Date.now(),
          options: ['delay_colouration', 'message_ids'],
        },
      }),
    );
  };
  socket.onmessage = (e) => {
    let frame;
    try {
      frame = JSON.parse(e.data);
    } catch {
      return;
    }
    const message = frame.Message ?? frame;
    if (Number.isInteger(message.messageID)) {
      if (lastId !== undefined && message.messageID !== lastId + 1) {
        if (message.messageID === lastId) return;
        lastError = 'Feed sequence interrupted';
        socket.close();
        return;
      }
      lastId = message.messageID;
    }
    const service = ['TRUST_ALL', 'TRUST_UPDATE'].includes(message.type);
    const areaData =
      layout.areas.includes(message.area) &&
      ['TD_ALL', 'TD_UPDATE', 'SEND_ALL', 'SEND_UPDATE'].includes(message.type);
    if (!service && !areaData) return;
    const received = Date.now();
    const upstream = Number(message.timestamp);
    if (!Number.isFinite(upstream) || Math.abs(received - upstream) > freshness) {
      lastError = 'Relay timestamp is stale';
      socket.close();
      return;
    }
    const change = board.accept(message, received);
    if (message.type === 'TRUST_ALL' && !timetableReady) {
      timetableReady = true;
      if (!abbeyTimer) void pollAbbey();
    }
    if (areaData && board.areaTimes[message.area] === upstream) {
      lastArea = received;
      transport = 'Connected';
      lastError = '';
      backoff = 2000;
    }
    if (change && recording) recording.write(JSON.stringify(change) + '\n');
  };
  socket.onerror = () => {
    lastError = 'Public relay unreachable';
    socket.close();
  };
  socket.onclose = () => {
    transport = 'Disconnected';
    if (!running) return;
    retry = setTimeout(connect, backoff);
    backoff = Math.min(30000, backoff * 2);
  };
}

async function pollAbbey() {
  // Poll once for all browser tabs. A relay reconnect or HTTP outage must not
  // clear the last station observation or make it look freshly reported.
  abbeyTimer = true;
  const now = Date.now();
  const previous = board.abbey?.reports ?? [];
  let reports = previous;
  let available = timetableReady && socket.readyState === 1;
  if (available) {
    const candidates = abbeyCandidates(board.catalogue, now);
    const result = await Promise.allSettled(
      candidates.map(async (entry) => {
        const response = await fetch(lookupURL(entry[1]), { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw Error('Station reports unavailable');
        return stationReport(entry, await response.json(), abbeyStations);
      }),
    );
    available = timetableReady && socket.readyState === 1 && result.every((r) => r.status === 'fulfilled');
    reports = result.flatMap((r, i) =>
      r.status === 'fulfilled'
        ? r.value &&
          board.catalogue.has(candidates[i][0]) &&
          !board.catalogue.get(candidates[i][0]).c &&
          !board.catalogue.get(candidates[i][0]).f
          ? [r.value]
          : []
        : previous.filter((s) => s.id === candidates[i][0]),
    );
    if (!timetableReady || socket.readyState !== 1) reports = previous;
  }
  const abbey = { checked: Date.now(), available, reports };
  const frame = { time: abbey.checked, received: abbey.checked, abbey };
  board.apply(frame);
  if (running && recording) recording.write(JSON.stringify(frame) + '\n');
  if (running) abbeyTimer = setTimeout(pollAbbey, 30000);
}

function snapshot() {
  const now = Date.now();
  const areaStatus = {};
  for (const area of layout.areas) {
    const last = board.areaTimes[area];
    if (transport !== 'Connected' || !last || now - last > freshness) areaStatus[area] = 'Stale';
    else areaStatus[area] = board.lastDeltas[area] ? 'Live' : 'Synchronising';
  }
  const statuses = Object.values(areaStatus);
  let status = transport;
  if (transport === 'Connected') {
    status = statuses.every((s) => s === 'Live')
      ? 'Live'
      : statuses.includes('Live')
        ? 'Partial'
        : 'Synchronising';
  } else if (board.observed !== null) status = 'Stale';
  return {
    status,
    areaStatus,
    observed: board.observed,
    received: board.received,
    values: board.values,
    events: board.events,
    services: board.services,
    error: lastError,
    abbey: board.abbey,
  };
}

const files = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
  '/rail.mjs': ['../rail.mjs', 'text/javascript'],
  '/data/corridor.json': ['data/corridor.json', 'application/json'],
  '/data/watford-replay.json': ['data/watford-replay.json', 'application/json'],
  '/data/replay.json': ['data/replay.json', 'application/json'],
  '/data/EASM-LICENSE.txt': ['data/EASM-LICENSE.txt', 'text/plain'],
};
const server = http.createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (req.method !== 'GET' || (path !== '/api/live' && !Object.hasOwn(files, path))) {
    res.writeHead(404).end();
    return;
  }
  try {
    if (path === '/api/live') {
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(snapshot()));
    } else if (path === '/data/replay.json' && customReplay) {
      res
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(customReplay);
    } else {
      const [name, mime] = files[path];
      const bytes = await readFile(new URL(name, root));
      res
        .writeHead(200, { 'Content-Type': mime + '; charset=utf-8', 'Cache-Control': 'no-cache' })
        .end(bytes);
    }
  } catch {
    res.writeHead(503).end('File unavailable');
  }
});
server.on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => {
  console.log('Hemel Hempstead rail monitor at http://127.0.0.1:' + port);
  connect();
  timer = setInterval(() => {
    const now = Date.now();
    const silentArea = layout.areas.some((area) => now - (board.areaTimes[area] || connectedAt) > freshness);
    if (socket.readyState <= 1 && (silentArea || now - (lastArea || connectedAt) > freshness)) {
      lastError = 'No fresh sector updates';
      socket.close();
    }
  }, 5000);
});
function stop() {
  running = false;
  clearTimeout(retry);
  clearTimeout(abbeyTimer);
  clearInterval(timer);
  socket?.close();
  recording?.end();
  server.close();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
