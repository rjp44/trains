import { Corridor } from './rail.mjs';
import { abbeyCandidates, lookupURL, stationReport } from './abbey.mjs';

const freshness = 45000;
const relay = 'wss://ws.signalmaps.co.uk/new';

// The browser and the optional Node recorder use the same area and freshness rules.
export function createLiveFeed(layout, { abbeyEndpoint, onFrame } = {}) {
  const board = new Corridor(layout);
  const stations = new Set(layout.branches.find((b) => b.id === 'abbey').stations.map((s) => s.code));
  let transport = 'Disconnected';
  let lastError = '';
  let backoff = 2000;
  let retry = null;
  let cancelSession = null;

  function updateAbbey(abbey) {
    const frame = { time: abbey.checked, received: Date.now(), abbey };
    board.apply(frame);
    onFrame?.(frame);
  }

  function stop() {
    clearTimeout(retry);
    retry = null;
    cancelSession?.();
    cancelSession = null;
    transport = 'Disconnected';
    if (board.abbey?.available)
      updateAbbey({ ...board.abbey, checked: Date.now(), available: false });
  }

  function reconnect(reason) {
    stop();
    lastError = reason;
    retry = setTimeout(() => {
      retry = null;
      start();
    }, backoff);
    backoff = Math.min(30000, backoff * 2);
  }

  function start() {
    if (cancelSession || retry !== null) return;
    transport = 'Connecting';
    board.newConnection();
    const connectedAt = Date.now();
    let socket;
    try {
      socket = new WebSocket(relay);
    } catch {
      reconnect('Public relay unreachable');
      return;
    }
    let lastId, abbeyTimer, lookup;
    let timetableReady = false;
    let cancelled = false;
    const watchdog = setInterval(() => {
      if (!cancelled && layout.areas.some((area) => Date.now() - (board.areaTimes[area] || connectedAt) > freshness))
        reconnect('No fresh sector updates');
    }, 5000);
    cancelSession = () => {
      cancelled = true;
      clearInterval(watchdog);
      clearTimeout(abbeyTimer);
      lookup?.abort();
      socket.close();
    };

    async function pollAbbey() {
      if (cancelled) return;
      const previous = board.abbey?.reports ?? [];
      const candidates = abbeyCandidates(board.catalogue, Date.now());
      lookup = new AbortController();
      const timeout = setTimeout(() => lookup.abort(), 8000);
      const results = await Promise.allSettled(
        candidates.map(async (entry) => {
          const response = await fetch(lookupURL(entry[1], abbeyEndpoint), {
            signal: lookup.signal,
            cache: 'no-store',
          });
          if (!response.ok) throw Error('Station reports unavailable');
          return stationReport(entry, await response.json(), stations);
        }),
      );
      clearTimeout(timeout);
      if (cancelled) return;
      lookup = null;
      const reports = results.flatMap((result, i) => {
        const id = candidates[i][0];
        const service = board.catalogue.get(id);
        if (!service || service.c || service.f) return [];
        if (result.status === 'rejected') return previous.filter((report) => report.id === id);
        return result.value ? [result.value] : [];
      });
      updateAbbey({ checked: Date.now(), available: results.every((r) => r.status === 'fulfilled'), reports });
      abbeyTimer = setTimeout(pollAbbey, 30000);
    }

    socket.onopen = () => {
      if (cancelled) return;
      transport = 'Synchronising';
      socket.send(JSON.stringify({
        Message: {
          type: 'SET_OPTIONS',
          areas: layout.areas,
          timestamp: Date.now(),
          options: ['delay_colouration', 'message_ids'],
        },
      }));
    };
    socket.onmessage = (event) => {
      if (cancelled) return;
      let frame;
      try {
        frame = JSON.parse(event.data);
      } catch {
        return;
      }
      const message = frame?.Message ?? frame;
      if (!message) return;
      if (Number.isInteger(message.messageID)) {
        if (message.messageID === lastId) return;
        if (lastId !== undefined && message.messageID !== lastId + 1) {
          reconnect('Feed sequence interrupted');
          return;
        }
        lastId = message.messageID;
      }
      const service = message.type === 'TRUST_ALL' || (message.type === 'TRUST_UPDATE' && timetableReady);
      const areaData =
        layout.areas.includes(message.area) &&
        ['TD_ALL', 'TD_UPDATE', 'SEND_ALL', 'SEND_UPDATE'].includes(message.type);
      if (!service && !areaData) return;
      const received = Date.now();
      const upstream = Number(message.timestamp);
      if (!Number.isFinite(upstream) || Math.abs(received - upstream) > freshness) {
        reconnect('Relay timestamp is stale');
        return;
      }
      const lastAreaTime = board.areaTimes[message.area];
      if (areaData && message.type.endsWith('_UPDATE') && lastAreaTime && received - lastAreaTime > freshness) {
        reconnect('No fresh sector updates');
        return;
      }
      const change = board.accept(message, received);
      if (change) onFrame?.(change);
      if (message.type === 'TRUST_ALL' && !timetableReady) {
        timetableReady = true;
        void pollAbbey();
      }
      if (areaData && board.areaTimes[message.area] === upstream) {
        transport = 'Connected';
        lastError = '';
        backoff = 2000;
      }
    };
    socket.onerror = () => {
      if (!cancelled) reconnect('Public relay unreachable');
    };
    socket.onclose = () => {
      if (!cancelled) reconnect('Public relay disconnected');
    };
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
  return { start, stop, snapshot };
}
