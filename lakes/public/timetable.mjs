// All offsets in the extract are GTFS seconds on the operator's local service day.
const dayMs = 86400000;
const london = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});
const shortDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});
function localClock(instant) {
  const p = Object.fromEntries(london.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: p.year + '-' + p.month + '-' + p.day,
    seconds: +p.hour * 3600 + +p.minute * 60 + +p.second,
  };
}
const dayNumber = (date) => Date.parse(date + 'T00:00:00Z') / dayMs;
export function serviceSeconds(instant, serviceDate) {
  const clock = localClock(instant);
  return clock.seconds + (dayNumber(clock.date) - dayNumber(serviceDate || clock.date)) * 86400;
}
export const hhmm = (seconds) =>
  [Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
export function stopTitle(group) {
  return [group.name, group.town].filter(Boolean).join(', ');
}

export class Timetable {
  constructor(data) {
    Object.assign(this, data);
    this.firstDay = dayNumber(this.start);
    this.lastDay = dayNumber(this.end);
    this.boards = this.groups.map(() => []);
    this.routesAt = this.groups.map(() => new Set());
    for (const trip of this.trips) {
      const calls = this.patterns[trip.pattern];
      // Follow the next distinct stop even when a trip visits two stands in the same group.
      let nextGroup = null;
      for (let i = calls.length - 1; i >= 0; i--) {
        const [ref, , dep, pickup, exact] = calls[i];
        const group = this.stops[ref].group;
        this.routesAt[group].add(trip.route);
        if (i + 1 < calls.length) {
          const next = this.stops[calls[i + 1][0]].group;
          if (next !== group) nextGroup = next;
        }
        if (pickup && nextGroup !== null)
          this.boards[group].push({ trip, ref, via: nextGroup, seconds: trip.start + dep, exact });
      }
    }
  }
  active(trip, day) {
    return this.calendars[trip.service][day - this.firstDay] === '1';
  }
  match(v) {
    const instant = Date.parse(v.departure);
    if (!Number.isFinite(instant) || !v.origin || !v.terminus) return null;
    const start = localClock(instant);
    const day = dayNumber(v.serviceDate || start.date);
    const seconds = start.seconds + (dayNumber(start.date) - day) * 86400;
    let matched = null;
    for (const trip of this.trips) {
      if (trip.route !== v.route || trip.start !== seconds || !this.active(trip, day)) continue;
      const calls = this.patterns[trip.pattern];
      if (calls[0][0] !== v.origin || calls.at(-1)[0] !== v.terminus) continue;
      if (matched && matched.pattern !== trip.pattern) return null;
      matched = trip;
    }
    return matched;
  }
  departures(group, instant, routes) {
    const selected = typeof routes === 'string' ? new Set([routes]) : routes;
    const clock = localClock(instant),
      today = dayNumber(clock.date);
    const covered = today >= this.firstDay && today <= this.lastDay;
    const sections = new Map();
    if (!covered) return { covered, sections };
    // Include a previous service day's after-midnight calls, and the next seven days.
    const current = today * 86400 + clock.seconds;
    for (const call of this.boards[group]) {
      if (selected && !selected.has(call.trip.route)) continue;
      if (!sections.has(call.via)) sections.set(call.via, []);
      const list = sections.get(call.via);
      for (let d = today - 1; d <= Math.min(today + 7, this.lastDay); d++) {
        const at = d * 86400 + call.seconds;
        if (at < current || at >= current + 7 * 86400 || !this.active(call.trip, d)) continue;
        const day = Math.floor(at / 86400);
        const prefix =
          day === today ? '' : day === today + 1 ? 'Tomorrow ' : shortDate.format(day * dayMs) + ' ';
        list.push({ ...call, at, time: prefix + hhmm(call.seconds) });
      }
    }
    for (const [via, list] of sections) {
      const seen = new Set();
      sections.set(
        via,
        list
          .sort((a, b) => a.at - b.at || a.trip.route.localeCompare(b.trip.route))
          .filter((call) => {
            const key = [call.trip.route, call.trip.pattern, call.at, call.ref].join('/');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .slice(0, 3),
      );
    }
    return { covered, sections };
  }
}
