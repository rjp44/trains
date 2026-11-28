import { watchStations, atStation, locateFollow, trainSummary, watchArrivals } from './rail-watch.mjs';
import { readHemelSchedule, schedulePath } from './hemel.mjs';
import { watchPanel } from './panel/watch.mjs';

export function railMonitor({
  id,
  layout,
  host,
  ids,
  defaultStation,
  fresh,
  live,
  play,
  focus,
  stationFocus,
  draw,
}) {
  const stations = watchStations(layout),
    arrivals = watchArrivals(),
    schedules = new Map();
  let target,
    matchedBerth,
    lastInfo,
    generation = 0;
  const panel = watchPanel(id, stations, defaultStation, host, () => {
    reset();
    stationFocus(panel.station);
    draw();
  });
  function reset() {
    target = matchedBerth = lastInfo = null;
    generation++;
    arrivals.reset();
    panel.show(null);
  }
  function stop() {
    reset();
    stationFocus(panel.station);
    draw();
  }
  function follow(berth, head, service) {
    reset();
    target = { berth, head, service: service?.id };
    draw();
  }
  function timetable(train, location) {
    if (!location || !train.service || !live()) return null;
    const path = schedulePath(train.service);
    if (!path) return null;
    const key = path + '/' + train.service.id + '/' + location;
    if (!schedules.has(key)) {
      if (schedules.size >= 256) schedules.delete(schedules.keys().next().value);
      const entry = {};
      schedules.set(key, entry);
      entry.promise = fetch(path, { signal: AbortSignal.timeout(8000) })
        .then(async (res) => res.ok && readHemelSchedule(await res.text(), train.service, path, location))
        .catch(() => null)
        .then((call) => (entry.call = call));
    }
    return schedules.get(key);
  }
  function update(board) {
    if (!board) return;
    if (target) {
      const match = locateFollow(target, ids, board);
      matchedBerth = match?.berth;
      if (match) {
        focus(match.berth);
        lastInfo = trainSummary(match, 'Following' + (fresh(match.berth.slice(0, 2)) ? '' : ' · last known'));
      } else if (fresh(target.berth.slice(0, 2))) {
        reset();
        stationFocus(panel.station);
      } else if (lastInfo) lastInfo = { ...lastInfo, context: 'Following · last known' };
      if (target) {
        panel.show(lastInfo || { head: target.head, context: 'Following · awaiting report' }, stop);
        return;
      }
    }
    const s = panel.station;
    if (!s || (id === 'hemel' && s.id === 'HML')) {
      panel.show(null);
      return;
    }
    const trains = atStation(s, board, fresh);
    if (live())
      arrivals.sample(trains, s, fresh, (train) => {
        const version = generation,
          entry = timetable(train, s.location);
        const stationReport = train.service?.station === s.id && !!train.service?.action;
        if (stationReport || !entry || entry.call || play.mode() !== 'stops')
          play.sound(train.direction > 0, stationReport || !!entry?.call?.booked);
        else
          entry.promise.then((call) => {
            if (call?.booked && generation === version && live() && fresh(train.berth.slice(0, 2)))
              play.sound(train.direction > 0, true);
          });
      });
    const train = trains[Math.floor(Date.now() / 5000) % trains.length];
    panel.show(train && trainSummary(train, s.name, timetable(train, s.location)?.call));
  }
  return {
    group: panel.group,
    watch: panel.watch,
    follow,
    reset,
    update,
    get followedBerth() {
      return matchedBerth;
    },
    get watchedStation() {
      return target ? undefined : panel.station?.id;
    },
    get hemel() {
      return !target && panel.station?.id === 'HML';
    },
  };
}
