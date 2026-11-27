export const isTrainCode = (head) => /^(?:[0-9][A-Z][0-9]{2}|[A-Z][0-9]{3})$/.test(head);

export function hemelBerths(layout) {
  const mile = layout.stations.find((station) => station.code === 'HML').mile;
  return layout.tracks.flatMap((track) => {
    const incoming = track.berths.filter((berth) => (mile - berth.mile) * track.direction >= 0);
    if (track.direction === 1) incoming.reverse();
    return incoming.map((berth, index) => ({
      id: berth.id,
      line: track.id.endsWith('F') ? 'fast' : 'slow',
      track: track.name,
      direction: track.direction,
      stage: berth.mile === mile ? 'station' : 'approach',
      distance: Math.abs(berth.mile - mile),
      immediate: index === 1,
    }));
  });
}

export function hemelTrains(berths, board, areaFresh) {
  const groups = { fast: [], slow: [] };
  for (const berth of berths) {
    const head = board.values[berth.id];
    const area = berth.id.slice(0, 2);
    if (!head || !areaFresh(area)) continue;
    const match = board.services[area + '/' + head];
    if (match?.id || (berth.stage === 'station' && isTrainCode(head))) {
      groups[berth.line].push({ ...berth, head, service: match?.id ? match : null });
    }
  }
  for (const trains of Object.values(groups)) trains.sort((a, b) => a.distance - b.distance);
  return groups;
}

export function cardCandidates(trains, lookup) {
  const occupied = trains.filter((t) => t.stage === 'station');
  if (occupied.length) return occupied.map((t) => ({ ...t, call: lookup(t.service, true) }));
  // Check nearer trains first. A previously verified stop can stay on screen
  // while the timetable of a closer train is being fetched.
  let canRequest = true;
  for (const train of trains) {
    const call = lookup(train.service, canRequest);
    if (call?.booked) return [{ ...train, call }];
    if (call?.pending) canRequest = false;
  }
  return [];
}

// One clock per line. Feed updates and changes in speed of replay do not restart the rotation.
export function cardRotation() {
  let previous, since;
  return (trains, now) => {
    const key = trains.map((t) => [t.track, t.head, t.service?.id, t.stage].join('/')).join('|');
    if (key !== previous) {
      previous = key;
      since = now;
    }
    if (trains.length <= 1) return trains[0];
    return trains[Math.floor((now - since) / 5000) % trains.length];
  };
}

let dayFormatter;
function londonDay(time) {
  dayFormatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: '2-digit',
  });
  return dayFormatter.format(time);
}
export function schedulePath(service, replayTime, formatDay = londonDay) {
  if (!/^[A-Z0-9]\d{5}$/.test(service?.uid)) return null;
  const prefix = '/api/hemel-schedule/' + service.uid + '/';
  if (Number.isFinite(service.startTime)) return prefix + formatDay(service.startTime);
  // Older recordings only have the origin day-of-month in the TRUST train ID.
  if (!Number.isFinite(replayTime) || !/^[A-Z0-9]{8}\d{2}$/.test(service.id)) return null;
  const today = formatDay(replayTime);
  const [day, month, year] = today.split('/').map(Number);
  const yesterday = formatDay(Date.UTC(2000 + year, month - 1, day - 1, 12));
  const date = [today, yesterday].find((date) => date.startsWith(service.id.slice(-2) + '/'));
  return date ? prefix + date : null;
}

const clockTime = /^(?:[01]\d|2[0-3]):[0-5]\d½?$/;
function minutes(time) {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + (time.endsWith('½') ? 0.5 : 0);
}
export function readHemelSchedule(html, service, path) {
  // A template keeps upstream scripts and subresources inert. Only plain text leaves this parser.
  const template = document.createElement('template');
  template.innerHTML = html;
  return readHemelScheduleRoot(template.content, service, path);
}

export function readHemelScheduleRoot(root, service, path) {
  if (!root.querySelector('h2')?.textContent.includes('(' + service.uid + ')')) return null;
  const activations = [...root.textContent.matchAll(/Train ID = "([A-Z0-9]+)"/g)];
  if (!activations.length || activations.some((entry) => entry[1] !== service.id)) return null;
  const heading = [...root.querySelectorAll('tr')].find((row) =>
    [...row.children].map((c) => c.textContent.trim()).join('|') ===
    'Location|P|WTT|Public|Actual|WTT|Actual|WTT|Public|Actual|Path-Line|Allowances|Activities|P|Notes');
  if (!heading) return null;
  const rows = [];
  const date = path.split('/').slice(-3).join('/');
  for (let row = heading.nextElementSibling; row; row = row.nextElementSibling) {
    if (!row.children?.length || row.children[0].tagName !== 'TD') continue;
    const href = row.children[0].querySelector('a')?.getAttribute('href');
    const match = /^\/rail\/liverail\/sum\/([A-Z0-9]+)\/(\d{2}\/\d{2}\/\d{2})$/.exec(href ?? '');
    if (!match || match[2] !== date || row.children.length !== heading.children.length) return null;
    const cells = [...row.children].map((c) => c.textContent.trim());
    rows.push({
      location: match[1], activity: cells[12], pass: cells[5],
      arrival: { working: cells[2], public: cells[3], actual: cells[4] },
      departure: { working: cells[7], public: cells[8], actual: cells[9] },
    });
  }
  return hemelCall(rows);
}

export function hemelCall(rows) {
  if (!rows[0]?.activity.includes('Train begins') || !rows.at(-1)?.activity.includes('Train finishes')) return null;
  const calls = rows.filter((row) => row.location === 'HEMLHMP');
  if (!calls.length) return { passing: true };
  if (calls.length !== 1) return null;
  const { departure, arrival, pass } = calls[0];
  for (const schedule of ['public', 'working']) {
    for (const event of [departure, arrival]) {
      const booked = event[schedule];
      if (!clockTime.test(booked)) continue;
      const actual = event.actual.split(/\s/)[0];
      if (!clockTime.test(actual)) return { booked };
      const delay = (minutes(actual) - minutes(booked) + 2160) % 1440 - 720;
      return { booked, delay };
    }
  }
  return clockTime.test(pass) ? { passing: true } : null;
}

export function callText(call, reportedDelay) {
  if (call?.pending) return 'Checking timetable…';
  if (call?.passing) return 'Passing';
  if (!call?.booked) return 'Timetable unavailable';
  const observed = Number.isFinite(call.delay);
  const delay = observed ? call.delay : reportedDelay;
  const booked = 'Booked ' + call.booked + ' · ';
  if (!Number.isFinite(delay)) return booked + 'Timing unavailable';
  const variation = delay === 0 ? 'on time' : Math.abs(delay) + ' min ' + (delay > 0 ? 'late' : 'early');
  return booked + (observed ? '' : 'Est. ') + variation;
}

export function stationName(s) {
  return s?.toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bDc\b/g, 'DC') || 'Unknown';
}
export const operators = {
  LF: 'Lumo',
  LD: 'Lumo',
  VT: 'Avanti West Coast',
  LM: 'WM Trains',
  LO: 'London Overground',
  DB: 'DB Cargo UK',
  GB: 'GB Railfreight',
  FL: 'Freightliner',
  SN: 'Southern',
  ZZ: 'Operator unavailable',
};

export function describeCard(train) {
  const { service, stage, track, head, call } = train;
  const route = service ? stationName(service.origin) + ' → ' + stationName(service.destination) : 'Service details unavailable';
  const company = service && (operators[service.operator] || service.operator || 'Operator unknown');
  let location = 'At Hemel';
  if (stage !== 'station') location = train.immediate ? 'Approaching Hemel' : train.distance.toFixed(1) + ' mi to Hemel';
  const context = track + ' · ' + location;
  const timing = callText(call, service?.delay);
  return { head, route, company, context, timing };
}

// Accept only Corridor's admitted TD frames. A full R1 frame always reseeds
// all four berths, including empty addresses omitted by the relay.

export function stationArrivals(layout) {
  const berths = hemelBerths(layout).filter((b) => b.stage === 'station');
  const occupied = new Map();
  let pending = [], seeded = false;
  function reset() {
    occupied.clear();
    pending = [];
    seeded = false;
  }
  function accept(frame) {
    if (frame.area !== 'R1' || !frame.values) return;
    if (frame.full) reset();
    if (!frame.full && !seeded) return;
    for (const { id, direction } of berths) {
      if (!(id in frame.values)) continue;
      const head = frame.values[id] || '';
      if (seeded && isTrainCode(head) && occupied.get(id) !== head) {
        pending.push({ head, time: frame.time, direction: direction === 1 ? 'D' : 'U' });
        if (pending.length > 8) pending.shift();
      }
      occupied.set(id, head);
    }
    seeded = true;
  }
  function take(live, now = Date.now(), isBooked = () => false) {
    const directions = live ? pending.filter((e) => Math.abs(now - e.time) < 6500).map((e) => isBooked(e.head) ? e.direction.toLowerCase() : e.direction).join('') : '';
    pending = [];
    return directions;
  }
  return { accept, reset, take };
}
