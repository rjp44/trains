import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Corridor } from './rail.mjs';
import { hemelBerths, hemelTrains, cardCandidates, cardRotation, schedulePath, hemelCall, callText } from './public/hemel.mjs';

const layout = JSON.parse(readFileSync(new URL('./public/data/corridor.json', import.meta.url)));
const berths = hemelBerths(layout);

test('Hemel maps the four station berths and searches only their inbound sides', () => {
  const nearest = layout.tracks.map((track) => {
    const [station, next] = berths.filter((b) => b.track === track.name);
    assert.equal(station.stage, 'station');
    assert.equal(next.immediate, true);
    return [track.name, station.id, next.id];
  });
  assert.deepEqual(nearest, [
    ['Down fast', 'R13143', 'R13139'], ['Up fast', 'R13144', 'R13146'],
    ['Down slow', 'R15145', 'R19880'], ['Up slow', 'R15146', 'R15148'],
  ]);
  const board = new Corridor(layout);
  board.values = { R13143: '1A80', R13146: '1B22', R15145: 'ITEM', R15148: '2K60', R15147: '2K65' };
  for (const head of ['1B22', '2K60', '1A44']) board.services['R1/' + head] = { id: head };
  const select = (line) => cardCandidates(hemelTrains(berths, board, () => true)[line], () => ({ booked: '21:55' }));
  assert.deepEqual(select('fast').map((t) => t.head), ['1A80']);
  assert.deepEqual(select('slow').map((t) => [t.head, t.stage]), [['2K60', 'approach']]);
  board.values.R13143 = '';
  board.values.R13139 = '1A44';
  board.values.R15145 = '2K65';
  board.values.R15146 = '2K64';
  assert.equal(select('fast').length, 1);
  assert.deepEqual(select('slow').map((t) => [t.head, t.stage]), [['2K65', 'station'], ['2K64', 'station']]);
});

test('the closest confirmed Hemel call wins across both directions, skipping passing, stale and outbound trains', () => {
  const board = new Corridor(layout);
  board.values = { R13146: '1A80', R13137: '2N71', R13170: '2N32', WJ3129: '2N69', R13140: '2T01' };
  for (const [id, head] of Object.entries(board.values)) board.services[id.slice(0, 2) + '/' + head] = { id: head };
  const fast = hemelTrains(berths, board, (area) => area === 'R1').fast;
  assert.deepEqual(fast.map((t) => t.head), ['1A80', '2N71', '2N32']);
  let calls = { '1A80': { passing: true }, '2N71': { booked: '23:41' }, '2N32': { booked: '23:04' } };
  const pick = () => cardCandidates(fast, (service) => calls[service.id]).map((t) => t.head);
  assert.deepEqual(pick(), ['2N71']);
  delete calls['2N71'];
  assert.deepEqual(pick(), ['2N32']);
  calls = { '1A80': { pending: true } };
  const requests = [];
  assert.deepEqual(cardCandidates(fast, (service, canRequest) => {
    requests.push(canRequest);
    return calls[service.id];
  }), []);
  assert.deepEqual(requests, [true, false, false]);
});

test('opposing trains rotate independently of feed updates, with immediate handover when a berth clears', () => {
  const rotate = cardRotation();
  const trains = [{ head: '2K65', track: 'Down slow' }, { head: '2K60', track: 'Up slow' }];
  assert.equal(rotate(trains, 1800).head, '2K65');
  assert.equal(rotate(trains, 6799).head, '2K65');
  assert.equal(rotate(trains.map((t) => ({ ...t, call: { booked: '21:55' } })), 6800).head, '2K60');
  assert.equal(rotate(trains, 11800).head, '2K65');
  assert.equal(rotate(trains.slice(1), 11801).head, '2K60');
  assert.equal(rotate([], 11802), undefined);
});

test('schedule lookups use the service origin date in London, including summer midnight', () => {
  const service = { uid: 'W70438', startTime: Date.parse('2026-06-24T23:15:00Z') };
  assert.equal(schedulePath(service), '/api/hemel-schedule/W70438/25/06/26');
  assert.equal(schedulePath({ uid: 'W70438' }), null);
  const legacy = { uid: 'W70438', id: '722K65M731' };
  assert.equal(schedulePath(legacy, Date.parse('2026-04-01T00:30:00+01:00')), '/api/hemel-schedule/W70438/31/03/26');
  assert.equal(schedulePath(legacy, Date.parse('2026-04-02T12:00:00Z')), null);
  assert.equal(schedulePath({ ...service, uid: '../bad' }), null);
});

const origin = { location: 'EUSTON', activity: 'Train begins.' };
const end = { location: 'MKNSCEN', activity: 'Train finishes.' };
const emptyTime = { working: '', public: '', actual: '' };
const hemel = { location: 'HEMLHMP', activity: '', pass: '', arrival: emptyTime, departure: emptyTime };
test('a verified complete schedule distinguishes passing, stopping and missing Hemel times', () => {
  const call = (row) => hemelCall([origin, row, end]);
  assert.deepEqual(hemelCall([origin, end]), { passing: true });
  assert.deepEqual(call({ ...hemel, pass: '21:55½' }), { passing: true });
  assert.equal(hemelCall([origin]), null);
  assert.equal(call(hemel), null);
  const arrival = { working: '23:58½', public: '23:59', actual: '23:59 On time' };
  const departure = { working: '23:59½', public: '23:59', actual: '00:01½ 2 Late' };
  assert.deepEqual(call({ ...hemel, arrival, departure }), { booked: '23:59', delay: 2.5 });
  assert.deepEqual(call({ ...hemel, arrival }), { booked: '23:59', delay: 0 });
  assert.deepEqual(call({ ...hemel, departure: { ...departure, actual: 'Exp. 00:02' } }), { booked: '23:59' });
  assert.equal(callText({ booked: '23:59' }, -1), 'Booked 23:59 · Est. 1 min early');
  assert.equal(callText({ booked: '23:59', delay: 2.5 }, -1), 'Booked 23:59 · 2.5 min late');
  assert.equal(callText(null, 0), 'Timetable unavailable');
});

test('the Hemel pilot reproduces the passing and stopping trains offline at the replay cursor', () => {
  const replay = JSON.parse(readFileSync(new URL('./public/data/hemel-replay.json', import.meta.url)));
  const board = new Corridor(layout);
  for (const frame of replay.frames) {
    if (frame.time > replay.frames[0].time + 90000) break;
    board.apply(frame);
  }
  const { fast, slow } = hemelTrains(berths, board, (area) => Boolean(board.areaTimes[area]));
  const label = (t) => callText(replay.hemelCalls[t.service.id], t.service.delay);
  assert.deepEqual([fast[0].head, label(fast[0])], ['1A80', 'Passing']);
  assert.deepEqual([slow[0].head, label(slow[0])], ['2K65', 'Booked 21:55 · Est. on time']);
});

test('the 15-mile recording can show its incoming booked stop offline beyond the next berth', () => {
  const replay = JSON.parse(readFileSync(new URL('./public/data/replay.json', import.meta.url)));
  const board = new Corridor(layout);
  for (const frame of replay.frames) {
    if (frame.time > replay.frames[0].time + 5000) break;
    board.apply(frame);
  }
  const { fast } = hemelTrains(berths, board, (area) => Boolean(board.areaTimes[area]));
  const [train] = cardCandidates(fast, (s) => replay.hemelCalls[s.id]);
  assert.deepEqual([train.head, train.call.booked, train.distance, train.immediate], ['2N71', '23:41', 3.531, false]);
});
