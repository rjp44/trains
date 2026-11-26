import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { compile } from '../../packages/compiler/build.mjs';
import { decode, encode } from '../../packages/app-format/format.mjs';
import { draw, seek } from '../../web/player/replay.mjs';
import { Corridor } from '../../rail.mjs';
import { createProjection } from '../../esp32/projection.mjs';
import { stationArrivals } from '../../esp32/arrivals.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const json = (f) => JSON.parse(readFileSync(join(root, f)));
const fixture = json('tests/conformance/hemel.json'),
  { licenceFile, ...source } = json('apps/hemel/overlay.json');
const licence = readFileSync(join(root, licenceFile));
const tmp = mkdtempSync(join(tmpdir(), 'transport-test-')),
  player = join(tmp, 'player'),
  file = join(tmp, 'test.tdp');
after(() => rmSync(tmp, { recursive: true, force: true }));
execFileSync(
  process.env.CXX || 'c++',
  [
    '-std=c++17',
    '-Wall',
    '-Wextra',
    '-Werror',
    'firmware/player/replay.cpp',
    'tests/conformance/native.cpp',
    '-o',
    player,
  ],
  { cwd: root },
);
const packageBytes = compile();
function trace(p, ms) {
  const s = seek(p, ms);
  const frame = [
    s.berth?.id || '-',
    s.berth ? p.scene.station.x + s.berth.offsetX : -1,
    s.track?.y ?? -1,
    s.card && s.frame.matched ? p.replay.service.id : '-',
    s.entry?.at ?? -1,
    s.entry?.direction || '-',
    Number(s.entry?.booked || 0),
  ];
  const lines = [['F', ...frame]];
  draw(p, s, { rect: (...a) => lines.push(['R', ...a]), text: (...a) => lines.push(['T', ...a]) });
  return { frame, lines };
}
test('captured movement, card and entry agree with the legacy reducer and 1024x600 schematic', () => {
  const layout = json('public/data/corridor.json'),
    rec = json(fixture.source),
    board = new Corridor(layout);
  const { project, markers } = createProjection(layout),
    arrivals = stationArrivals(layout);
  const legacy = join(tmp, 'legacy.h');
  execFileSync(process.execPath, ['esp32/pack.mjs', '1024', '600', legacy], { cwd: root });
  const packed = readFileSync(legacy, 'utf8').split('Marker hemelMarkers[] = {')[1].split('};')[0];
  const positions = new Map(
    [...packed.matchAll(/\{(\d+), (\d+), (\d+),/g)].map((m) => [markers[+m[1]].id, [+m[2], +m[3]]]),
  );
  const p = decode(packageBytes);
  for (const berth of p.scene.berths) {
    const track = p.scene.tracks.find((t) => t.id === berth.track);
    assert.deepEqual(positions.get(berth.id), [p.scene.station.x + berth.offsetX, track.y]);
  }
  let i = 0,
    entry = -1;
  assert.equal(rec.frames[0].time, fixture.originMs);
  for (const f of fixture.frames) {
    while (rec.frames[i]?.time <= fixture.originMs + f.ms) {
      const obs = rec.frames[i++];
      board.apply(obs);
      arrivals.accept(obs);
      const directions = arrivals.take(true, obs.time, (head) =>
        Boolean(rec.hemelCalls[board.services['R1/' + head]?.id]?.booked),
      );
      if (directions.includes('d')) entry = obs.time - fixture.originMs;
    }
    assert.equal(board.values[f.berth], p.replay.service.head);
    assert.deepEqual(positions.get(f.berth), [f.x, f.y]);
    assert.equal(entry, f.entry);
    const card = project(board, (svc) =>
      svc && rec.hemelCalls[svc.id]?.uid === svc.uid ? rec.hemelCalls[svc.id] : null,
    ).cards[2];
    const selected = card[0] === p.replay.service.head;
    assert.equal(selected ? board.services['R1/' + card[0]].id : '-', f.card);
    const s = seek(p, f.ms);
    if (selected) {
      assert.equal(s.frame.timing, card[3]);
      assert.equal(p.replay.service.route, card[2]);
      assert.equal(s.track.name + ' | ' + s.berth.context, card[1]);
    }
  }
});
test('one native binary and JS agree on state, card text and every drawing command after a layout edit', () => {
  assert.deepEqual(compile(), packageBytes);
  for (const dx of [0, fixture.layoutEdit.editedX - fixture.layoutEdit.originalX]) {
    const edited = structuredClone(source);
    edited.scene.station.x += dx;
    const bytes = encode(edited, licence),
      p = decode(bytes);
    assert.equal(p.licence, licence.toString());
    if (!dx) assert.deepEqual(bytes, packageBytes);
    writeFileSync(file, bytes);
    const expected = [];
    for (const f of fixture.frames) {
      const { frame, lines } = trace(p, f.ms);
      assert.deepEqual(frame, [
        f.berth,
        f.x + dx,
        f.y,
        f.card,
        f.entry,
        f.entry < 0 ? '-' : 'down',
        Number(f.entry >= 0),
      ]);
      expected.push(...lines.map((l) => l.join('\t')));
    }
    const actual = execFileSync(player, [file, ...fixture.frames.map((f) => String(f.ms))], {
      encoding: 'utf8',
    });
    assert.deepEqual(actual.trimEnd().split('\n'), expected);
  }
});
test('both readers reject damaged, unsupported and inconsistent packages', () => {
  function rejects(bytes) {
    assert.throws(() => decode(bytes));
    writeFileSync(file, bytes);
    assert.equal(spawnSync(player, [file]).status, 1);
  }
  rejects(packageBytes.subarray(0, 51));
  rejects(packageBytes.subarray(0, -1));
  const corrupt = Buffer.from(packageBytes);
  corrupt[60] ^= 1;
  rejects(corrupt);
  // Recompute the digest to exercise semantic validation in both readers.
  function replace(section, needle, replacement) {
    const b = Buffer.from(packageBytes),
      header = 4 + section * 12;
    const offset = b.readUInt32LE(header),
      length = b.readUInt32LE(header + 4),
      data = b.subarray(offset, offset + length);
    const at = data.indexOf(needle);
    assert(at >= 0);
    assert.equal(needle.length, replacement.length);
    data.write(replacement, at);
    b.writeUInt32LE(crc32(data), header + 8);
    rejects(b);
  }
  replace(0, 'station-pair-replay/1', 'station-pair-replay/2');
  replace(2, 'R15139', 'XXXXXX');
  const overlap = Buffer.from(packageBytes);
  overlap.writeUInt32LE(52, 16);
  rejects(overlap);
  for (const edit of [
    (s) => {
      s.scene.card.x = 1024;
    },
    (s) => {
      s.replay.frames[1].at = 0;
    },
    (s) => {
      s.scene.code = 'eval';
    },
    (s) => {
      s.scene.berths[1].id = s.scene.berths[0].id;
    },
  ]) {
    const s = structuredClone(source);
    edit(s);
    assert.throws(() => encode(s, licence));
  }
});
