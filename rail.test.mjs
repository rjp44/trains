import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  Corridor,
  locateTrain,
  corridorTracks,
  withStationReports,
  routeMile,
  berthDiagram,
  fitStationNames,
  junctionPathSlots,
} from './rail.mjs';

import { abbeyCandidates, lookupURL, stationReport } from './abbey.mjs';

const layout = JSON.parse(readFileSync(new URL('./public/data/corridor.json', import.meta.url)));
const event = (type, message, timestamp, area = 'R1') => ({ type, message, timestamp, area });

test('only a snapshot can initialise the board, and unknown signals stay unknown', () => {
  const board = new Corridor(layout);
  assert.equal(board.accept(event('TD_UPDATE', { 'R103:7': '1' }, 1), 1), undefined);
  board.accept(event('TD_ALL', { 'R103:7': '1', 'R103:8': '0', R15145: '2K65' }, 10), 11);
  assert.equal(board.values['R103:7'], 'off');
  assert.equal(board.values['R103:8'], 'on');
  assert.equal(board.values['R104:8'], undefined);
  board.accept(event('TD_UPDATE', { R15145: '', R15147: '2K65', 'R103:8': '?' }, 20), 22);
  assert.equal(board.values.R15145, '');
  assert.equal(board.values.R15147, '2K65');
  assert.equal(board.values['R103:8'], null);
  assert.equal(board.events.length, 3);
  board.accept(event('TD_UPDATE', { R15145: 'old' }, 19), 22);
  board.accept(event('TD_UPDATE', { R15145: 'wrong area' }, 21, 'WJ'), 22);
  assert.equal(board.values.R15145, '');
  board.accept(event('TD_UPDATE', { R15147: '2K65', R19999: 'other' }, 22), 22);
  assert.equal(board.events.length, 3);
  board.accept(event('TD_ALL', { 'R103:7': '0' }, 24), 25);
  assert.deepEqual(board.values, { 'R103:7': 'on' });
  assert.deepEqual(board.events, []);
  assert.equal(board.lastDeltas.R1, undefined);
});

const markers = layout.tracks.flatMap((track) => track.berths);
const pilot = markers.filter((m) => m.pilot);

test('the expanded sector has distinct, addressable berths and signal indications', () => {
  assert.equal(layout.stations.length, 9);
  assert.deepEqual(layout.areas, ['R1', 'WJ', 'WS']);
  assert.equal(markers.length, 168);
  assert.equal(new Set(markers.map((m) => m.id)).size, markers.length);
  const signals = markers.filter((m) => m.bit);
  assert.equal(signals.length, 162);
  assert.equal(new Set(signals.map((m) => m.bit)).size, signals.length);
  assert.equal(pilot.length, 30);
  assert.equal(new Set(pilot.map((m) => m.signal)).size, 30);
  for (const m of signals) assert.match(m.bit, /^(R1|WJ)[0-9A-F]{2}:[1-8]$/);
  for (const track of layout.tracks) {
    assert.ok(track.berths.some((m) => m.mile < -14) && track.berths.some((m) => m.mile > 14));
    assert.ok(track.berths.every((m) => Math.abs(m.mile) <= 15));
    assert.deepEqual(
      track.berths.map((m) => m.mile),
      track.berths.map((m) => m.mile).sort((a, b) => a - b),
    );
  }
});

test('each area requires a fresh snapshot after a gap, and an area refresh retains its neighbour', () => {
  const board = new Corridor(layout);
  const input = (type, area, message, time) => board.accept(event(type, message, time, area), time);
  input('TD_ALL', 'R1', { R15145: '2K65' }, 10);
  input('TD_ALL', 'WJ', { WJ0143: '1A80' }, 11);
  input('TD_UPDATE', 'WJ', { WJ0143: '1B23' }, 12);
  input('TD_ALL', 'R1', {}, 13);
  assert.deepEqual(board.values, { WJ0143: '1B23' });
  assert.equal(board.events[0].key, 'WJ0143');
  board.newConnection();
  assert.deepEqual(board.areaTimes, {});
  input('TD_UPDATE', 'WJ', { WJ0143: '1C45' }, 14);
  assert.equal(board.values.WJ0143, '1B23');
  input('TD_ALL', 'R1', { R15145: '9Z99' }, 15);
  assert.equal(board.areaTimes.WJ, undefined);
  input('TD_ALL', 'WJ', {}, 16);
  assert.deepEqual(board.values, { R15145: '9Z99' });
});

test('service matches are scoped by area, timetable identity, cancellation and deletion', () => {
  const board = new Corridor(layout);
  board.accept(event('TD_ALL', { R15145: '2K65' }, 10), 10);
  board.accept(event('TD_ALL', { WJ0143: '2K65' }, 11, 'WJ'), 11);
  const a = { ti: '722K65M724', t: ['R1'], sk: 'W70438', ol: 'LONDON EUSTON', dl: 'MILTON KEYNES CENTRAL' };
  const b = { ti: '992K65AB24', t: ['WJ'] };
  board.accept(event('TRUST_ALL', { a, b }, 12), 12);
  assert.equal(board.services['R1/2K65'].id, 'a');
  assert.equal(board.services['WJ/2K65'].id, 'b');
  board.accept(event('TRUST_UPDATE', { c: a }, 13), 13);
  assert.deepEqual(board.services['R1/2K65'], { ambiguous: true });
  board.accept(event('TRUST_UPDATE', { c: { ...a, c: true } }, 14), 14);
  assert.equal(board.services['R1/2K65'].id, 'a');
  board.accept({ ...event('TRUST_UPDATE', { b: { ...b, f: true } }, 15), deleted: ['a'] }, 15);
  assert.deepEqual(board.services, {});
});

test('a pinned train follows a matching service across berths and area boundaries', () => {
  const train = { head: '2K65', berth: 'R15145', area: 'R1' };
  const service = { id: '722K65M724', uid: 'W70438' };
  const board = { values: { R15145: '2K65' }, services: { 'R1/2K65': service } };
  assert.equal(locateTrain(train, markers, board).service.uid, 'W70438');
  board.values = { R15147: '2K65' };
  assert.equal(locateTrain(train, markers, board).marker.id, 'R15147');
  board.values = { WJ0143: '2K65' };
  board.services = { 'WJ/2K65': service };
  assert.equal(locateTrain(train, markers, board).marker.id, 'WJ0143');
  board.values = { R15145: '2K65' };
  board.services = { 'R1/2K65': { id: 'another train' } };
  const result = locateTrain(train, markers, board);
  assert.equal(result.current, false);
  assert.equal(result.service.id, service.id);
  assert.equal(result.marker.id, 'WJ0143');
});
test('the sector replay opens with all three areas and contains train and signal changes beyond the pilot', () => {
  const { startTime, frames } = JSON.parse(
    readFileSync(new URL('./public/data/replay.json', import.meta.url)),
  );
  const board = new Corridor(layout);
  assert.ok(frames[0].time <= startTime && startTime < frames.at(-1).time);
  assert.ok(frames.every((frame, i) => !i || frame.time >= frames[i - 1].time));
  for (const frame of frames.filter((f) => f.time <= startTime)) board.apply(frame);
  assert.deepEqual(Object.keys(board.areaTimes).sort(), layout.areas.slice().sort());
  assert.ok(board.abbey.available && board.abbey.reports.length);
  for (const area of layout.areas) {
    const berths = corridorTracks(layout)
      .flatMap((t) => t.berths)
      .filter((b) => !b.pilot && b.id.startsWith(area));
    assert.ok(
      berths.some((b) => board.values[b.id]),
      area + ' has an occupied outer berth at the start',
    );
    const changes = frames.filter((f) => !f.full && f.area === area && f.time > startTime);
    assert.ok(
      changes.some((f) => berths.some((b) => f.values[b.id])),
      area + ' has a train movement',
    );
    assert.ok(
      changes.some((f) => berths.some((b) => b.bit && f.values[b.bit])),
      area + ' has a signal change',
    );
  }
});

test('real replay preserves train order, direction and the two observed signal transitions', () => {
  const recording = JSON.parse(readFileSync(new URL('./public/data/hemel-replay.json', import.meta.url)));
  const { frames } = recording;
  assert.ok(frames[0].full);
  const board = new Corridor(layout);
  const journeys = { '1A80': [], '2K65': [] };
  const aspects = { 'R103:8': [], 'R104:4': [] };
  const occupied = new Map();
  let previous = 0;
  for (const frame of frames) {
    assert.ok(frame.time >= previous);
    previous = frame.time;
    board.apply(frame);
    for (const [k, v] of Object.entries(frame.values ?? {})) {
      if (Object.hasOwn(journeys, v) && pilot.some((m) => m.id === k)) journeys[v].push(k);
      if (Object.hasOwn(aspects, k)) aspects[k].push(v);
      occupied.set(k, v);
    }
  }
  assert.deepEqual(journeys['1A80'], ['R13154', 'R13152', 'R13150', 'R13146', 'R13144', 'R13140', 'R13138']);
  assert.deepEqual(journeys['2K65'], [
    'R15139',
    'R15141',
    'R15145',
    'R15147',
    'R15151',
    'R15153',
    'R15155',
    'R15159',
  ]);
  assert.deepEqual(aspects['R103:8'].slice(0, 4), ['on', 'off', 'on', 'off']);
  assert.deepEqual(aspects['R104:4'].slice(0, 3), ['off', 'on', 'off']);
  assert.deepEqual(board.values, Object.fromEntries(occupied));
  const match = frames.find((frame) => frame.services?.['R1/2K65'])?.services['R1/2K65'];
  assert.deepEqual(
    [match.uid, match.origin, match.destination, match.departure, match.arrival],
    ['W70438', 'LONDON EUSTON', 'MILTON KEYNES CENTRAL', '2124', '2227'],
  );
  assert.equal(frames.find((frame) => frame.services?.['R1/1A80']).services['R1/1A80'].uid, 'W34161');
  assert.equal(board.areaTimes.WJ, undefined);
});

test('Watford branches use their own rail distances and unique TD addresses', () => {
  const all = corridorTracks(layout).flatMap((t) => t.berths);
  assert.equal(new Set(all.map((m) => m.id)).size, all.length);
  const bits = all.filter((m) => m.bit).map((m) => m.bit);
  assert.equal(new Set(bits).size, bits.length);
  const [dc, abbey] = layout.branches;
  const via = -layout.stations.find((s) => s.code === 'WFJ').mile;
  assert.equal(dc.limit, 15 - via);
  assert.ok(dc.stations.every((s) => s.distance + via <= 15));
  assert.equal(dc.stations.at(-1).code, 'KNT');
  assert.equal(abbey.stations.at(-1).distance, 6.375);
  assert.equal(abbey.stations.at(-1).code, 'SAA');
  const terminal = dc.tracks.find((t) => t.id === 'terminal');
  assert.deepEqual([...new Set(terminal.berths.map((m) => m.platform))], ['1', '2', '3', '4']);
  assert.equal(all.find((m) => m.id === 'WJ0856').platform, '11');
});

test('Abbey services use confirmed calls and exclude future, mismatched and cancelled workings', () => {
  const now = Date.parse('2026-11-24T22:54:00Z');
  const id = '712F39M824',
    s = {
      ti: id,
      st: Date.parse('2026-11-24T22:45:00Z'),
      ol: 'WATFORD JUNCTION',
      dl: 'ST ALBANS ABBEY',
      od: '2245',
    };
  const candidates = abbeyCandidates(
    new Map([
      [id, s],
      ['unrelated', { ...s, dl: 'LONDON EUSTON' }],
      ['future', { ...s, st: now + 600000 }],
      ['cancelled', { ...s, c: true }],
    ]),
    now,
  );
  assert.deepEqual(
    candidates.map((c) => c[0]),
    [id],
  );
  assert.equal(lookupURL(s).searchParams.get('date'), '2026-11-24');
  const valid = new Set(['WFJ', 'GSN', 'SAA']);
  const trip = {
    summary: { dep: '22:45' },
    calls: [
      { crs: 'WFJ', status: 'on_time', here: true },
      { crs: 'GSN', status: 'on_time', expected: '22:52' },
      { crs: 'SAA', status: 'on_time' },
    ],
  };
  assert.equal(stationReport(candidates[0], trip, valid), null);
  trip.calls[1].status = 'departed';
  assert.equal(stationReport(candidates[0], trip, valid).station, 'GSN');
  assert.equal(stationReport(candidates[0], { ...trip, cancelled: true }, valid), null);
  assert.equal(stationReport(candidates[0], { ...trip, summary: { dep: '22:59' } }, valid), null);
});

test('the branch replay follows a DC service and a shuttle through successive confirmed stations', () => {
  const { frames } = JSON.parse(readFileSync(new URL('./public/data/watford-replay.json', import.meta.url)));
  const board = new Corridor(layout);
  const all = corridorTracks(layout).flatMap((t) => t.berths);
  const dc = { head: '2D66', area: 'WS', berth: 'WS0057' },
    shuttle = { head: '2F39', area: 'AB', berth: 'ABWFN' };
  const dcSteps = new Set(),
    stops = new Set();
  for (const frame of frames) {
    board.apply(frame);
    const view = withStationReports(board);
    if (view.services['WS/2D66']) dcSteps.add(locateTrain(dc, all, view).marker.id);
    if (view.services['AB/2F39']) stops.add(locateTrain(shuttle, all, view).marker.station);
  }
  assert.deepEqual([...stops], ['WFN', 'GSN', 'BWO']);
  assert.ok(['WS0057', 'WS0061', 'WS0063'].every((k) => dcSteps.has(k)));
  assert.equal(dc.service.uid, 'C34178');
  assert.equal(shuttle.service.uid, 'W11194');
  assert.ok(!Object.hasOwn(board.values, 'ABBWO'));
  assert.ok(Object.hasOwn(withStationReports(board).values, 'ABBWO'));
  const stale = withStationReports({ ...board, abbey: { ...board.abbey, available: false } });
  assert.equal(stale.values.ABBWO, '2F39');
  assert.equal(stale.abbey.available, false);
});

test('the Abbey platform and station report resolve to one service', () => {
  const report = { head: '2F39', id: '712F39M824', station: 'WFJ' };
  const board = { values: { WJ0856: '2F39' }, services: {}, abbey: { reports: [report] } };
  assert.equal(withStationReports(board).services['WJ/2F39'].id, report.id);
  assert.equal(withStationReports(board).values.ABWFJ, undefined);
  report.station = 'GSN';
  const view = withStationReports(board);
  assert.equal(view.values.ABGSN, '2F39');
  assert.equal(view.values.WJ0856, undefined);
  assert.equal(board.values.WJ0856, '2F39');
});

test('Watford platform mappings preserve the physical sector and both line connections', () => {
  const anchor = layout.stations.find((s) => s.code === 'WFJ').mile;
  const platforms = layout.junction.platforms.map((p) => p.number);
  assert.deepEqual(platforms, ['1', '2', '3', '4', '6', '7', '8', '9', '10', '11']);
  const berths = corridorTracks(layout).flatMap((t) => t.berths.map((b) => ({ ...b, track: t })));
  for (const p of platforms) {
    const terminal = berths.filter((b) => b.platform === p);
    assert.ok(terminal.length > 0);
    assert.ok(terminal.every((b) => Math.abs(routeMile(b, b.track.branch, anchor) - anchor) < 0.25));
  }
  for (const branch of layout.branches) {
    const [origin, station] = branch.stations;
    assert.equal(routeMile(origin, branch.id, anchor), anchor);
    assert.ok(Math.abs(Math.abs(routeMile(station, branch.id, anchor) - anchor) - station.distance) < 1e-8);
  }
  assert.equal(routeMile({ distance: layout.branches[0].limit }, 'dc', anchor), -15);
  const paths = layout.junction.paths;
  assert.ok(paths.some((p) => p.route === 'dc' && p.slots.at(-1)[1] === 5)); // Down Fast
  assert.ok(paths.some((p) => p.route === 'bay' && p.slots[0][1] === 8)); // Up Slow
  assert.ok(paths.some((p) => p.route === 'abbey' && p.slots[0][1] === 9 && p.slots.at(-1)[1] === 10));
  const board = new Corridor(layout);
  board.accept(event('TD_ALL', { WJB374: '2O99', 'WJ16:6': '1' }, 1, 'WJ'), 1);
  assert.equal(board.values.WJB374, '2O99');
  assert.equal(board.values['WJ16:6'], 'off');
});

test('station anchors align across independent berth sequences and the WCML/DC interchanges', () => {
  const diagram = berthDiagram(layout);
  const anchors = {
    APS: ['R13137', 'R13138', 'R15139', 'R15140'],
    HML: ['R13143', 'R13144', 'R15145', 'R15146'],
    BKM: ['R13157', 'R13154', 'R15159', 'R15156'],
    HRW: ['WJ0147', 'WJ0142', 'WJ0351', 'WJ0346', 'WS0055', 'WS0306'],
    BSH: ['WJ0161', 'WJ0160', 'WJ0363', 'WJ0362', 'WS0067', 'WS0068'],
    WFH: ['WS0075', 'WS0072'],
  };
  for (const [code, ids] of Object.entries(anchors))
    for (const id of ids) assert.equal(diagram.positions.get(id), diagram.columns.get(code), id);
  const positions = (ids) => ids.map((id) => diagram.positions.get(id));
  assert.deepEqual(
    positions(['R15139', 'R15141', 'R19880', 'R15145']).map((x) => x - diagram.columns.get('APS')),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    positions(['R13137', 'R13139', 'R13143']).map((x) => x - diagram.columns.get('APS')),
    [0, 1.5, 3],
  );
  assert.ok(diagram.positions.get('WS0074') < diagram.positions.get('WS0309'));
  const junction = layout.stations.find((s) => s.code === 'WFJ').mile;
  for (const t of corridorTracks(layout).filter((t) => !t.branch || ['up', 'down'].includes(t.id))) {
    const ordered = t.berths
      .slice()
      .sort((a, b) => routeMile(a, t.branch, junction) - routeMile(b, t.branch, junction));
    for (let i = 1; i < ordered.length; i++)
      assert.ok(diagram.positions.get(ordered[i].id) > diagram.positions.get(ordered[i - 1].id));
  }
  const updated = structuredClone(layout);
  updated.tracks[0].berths[0].mile -= 0.25;
  assert.deepEqual(berthDiagram(updated).positions, diagram.positions);
  const all = corridorTracks(layout).flatMap((track) => track.berths);
  assert.equal(diagram.positions.size, all.length);
  for (const p of all) {
    const c = diagram.positions.get(p.id);
    assert.ok(Number.isFinite(c) && c > diagram.start && c < diagram.end);
  }
});

test('the junction, branch stops, sector bounds and turnouts share the berth grid', () => {
  const d = berthDiagram(layout);
  for (const track of corridorTracks(layout)) {
    for (const berth of track.berths.filter((b) => b.platform)) {
      assert.ok(Math.abs(d.positions.get(berth.id)) === (berth.platform === '11' ? 0 : 0.5));
    }
  }
  assert.equal(d.columns.get('WFJ'), 0);
  const stations = layout.branches.find((b) => b.id === 'abbey').stations;
  stations.forEach((s, i) => assert.equal(d.positions.get('AB' + s.code), i));
  const paths = new Map(layout.junction.paths.map((p) => [p.name, junctionPathSlots(d, p)]));
  for (const points of paths.values())
    for (const [x, y] of points) assert.ok(Number.isFinite(x) && Number.isFinite(y));
  assert.deepEqual(
    paths.get('Watford yard connection and Abbey single line')[0],
    paths.get('Up Slow to bay platform 10')[1],
  );
  assert.equal(
    paths.get('Watford yard connection and Abbey single line').at(-1)[0],
    d.positions.get('ABSAA'),
  );
  assert.equal(paths.get('Down DC to platform 2')[0][0], d.dcLines.find((l) => l.id === 'down').start);
  assert.equal(paths.get('Harrow reversing siding')[0][0], d.harrow);
  assert.ok(paths.get('Harrow reversing siding')[1][0] < d.positions.get('WS0307'));
  assert.ok(d.positions.get('WS0307') < paths.get('Harrow reversing siding').at(-1)[0]);
});

test('station labels use full names when space permits and keep shortened names on their station', () => {
  const stations = [
    'Hemel Hempstead',
    'Watford Junction',
    'Kings Langley',
    'Watford High Street',
    'How Wood',
  ].map((name, i) => ({ name, code: ['HML', 'WFJ', 'KGL', 'WFH', 'HWW'][i] }));
  const measure = (text, size) => text.length * size * 0.55;
  for (const spacing of [30, 50, 140]) {
    const right = 40 + 4 * spacing;
    const result = fitStationNames(
      stations.map((station, i) => ({ station, x: 20 + i * spacing })),
      0,
      right,
      measure,
    );
    assert.equal(result.length, stations.length);
    if (spacing === 140) assert.ok(result.every((item) => item.label === item.station.name));
    if (spacing <= 50) assert.ok(result.every((item) => item.size <= 13));
    if (spacing === 50)
      assert.ok(
        result.some(
          (item) =>
            item.label !== item.station.name && item.label.startsWith(item.station.name.split(' ')[0] + ' '),
        ),
      );
    for (const row of [0, 1]) {
      let end = -Infinity;
      for (const item of result.filter((item) => item.row === row)) {
        const start = item.labelX - item.width / 2;
        assert.ok(item.width >= measure(item.label, item.size) + 8);
        assert.ok(start >= end + 5.99 && start >= -1e-8);
        end = start + item.width;
        assert.ok(end <= right + 1e-8 && start <= item.x && end >= item.x);
      }
    }
  }
});
