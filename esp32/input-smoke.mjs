// Compare bridged recordings with flash replay and exercise the actual LVGL pointer path.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { Corridor } from '../rail.mjs';
import { createProjection, encoder } from './projection.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'hemel-input-'));
const data = (name) => JSON.parse(readFileSync(new URL('../public/data/' + name + '.json', import.meta.url)));
const layout = data('corridor'),
  { project, fingerprint, markers } = createProjection(layout);
const rec = data('hemel-replay'),
  board = new Corridor(layout);
function at(seconds) {
  for (const f of rec.frames) {
    if (f.time > rec.frames[0].time + seconds * 1000) break;
    board.apply(f);
  }
  return project(board, (s) => (s && rec.hemelCalls?.[s.id]?.uid === s.uid ? rec.hemelCalls[s.id] : null));
}
const encode = encoder(fingerprint);
const ninety = at(90),
  later = at(250);
const initial = encode(ninety, 4),
  delta = encode(later, 4),
  heartbeat = encode(later, 4),
  resync = encode(later, 4, true);
const render = (stream, taps = [], seconds = 90) => {
  const args = ['--view', 'hemel', '--light', '--output', join(tmp, 'panel.bmp')];
  if (stream != null) args.push('--live');
  else args.push('--sample', 'hemel', '--at', String(seconds));
  for (const point of taps) args.push('--tap', point);
  execFileSync(process.argv[2], args, { input: stream ?? '' });
  const bmp = readFileSync(join(tmp, 'panel.bmp'));
  return bmp.subarray(bmp.readUInt32LE(10));
};
// Ignore the live status and observation clock in the bottom-left margin.
// SDL's BMP rows are bottom-up.
const diagram = (pixels) => pixels.subarray(35 * 1024 * 3);
const pixel = (bmp, x, y) => bmp.readUIntLE(((599 - y) * 1024 + x) * 3, 3) & 0xf8fcf8;
const checksum = (body) => body + '!' + crc32(body) + '\n';
try {
  assert.deepEqual(diagram(render(initial)), diagram(render(null)));
  assert.deepEqual(diagram(render(initial + delta)), diagram(render(null, [], 250)));
  const normal = render(initial);
  const train = render(initial, ['567,266']);
  assert.notDeepEqual(diagram(train), diagram(normal));
  assert.deepEqual(diagram(train), diagram(render(null, ['567,266'])));
  assert.deepEqual(render(initial, ['567,266', '722,165']), normal); // close button
  assert.deepEqual(render(initial, ['567,266', '20,540']), normal); // tap outside
  const sector = ['40,17', '40,17'];
  const sectorFrame = render(initial, sector);
  // Tap the newly exposed edges of both enlarged cards in the 15-mile view.
  for (const point of ['735,126', '875,518']) {
    const taps = [...sector, point];
    const opened = render(initial, taps);
    assert.notDeepEqual(diagram(opened), diagram(sectorFrame));
    assert.deepEqual(diagram(opened), diagram(render(null, taps)));
  }
  assert.deepEqual(render(initial, [...sector, '500,476']), sectorFrame); // former slow-card position
  const signal = render(initial, ['567,137']);
  assert.notDeepEqual(diagram(signal), diagram(normal));
  assert.notDeepEqual(diagram(signal), diagram(train));
  assert.deepEqual(render(initial, ['40,53', '40,53']), normal);
  assert.notDeepEqual(diagram(render(initial, ['40,53'])), diagram(normal));
  assert.deepEqual(render(initial, ['40,17', '40,17', '40,17']), normal);
  assert.notDeepEqual(diagram(render(initial, ['40,17'])), diagram(normal));
  assert.deepEqual(render(initial, ['40,17', '40,17', '662,242']), normal); // tap Hemel's station label
  const bad = checksum(delta.split('!')[0] + 'M\t9999\t2\t0\t\t\t\t\n');
  const wrongMap = encoder(fingerprint + 1)(later, 4);
  for (const broken of [heartbeat, bad, wrongMap, delta.replace('!', '!9')]) {
    const stale = render(initial + broken);
    assert.equal(pixel(stale, 560, 274), 0xb0bcb3 & 0xf8fcf8);
    assert.deepEqual(render(initial + broken + resync), render(resync));
  }
  // The optional arrival trailer is usable once, after its own continuous live
  // batch. Repeating a full+delta pair or replaying a recording must stay quiet.
  const liveEncoder = encoder(fingerprint);
  const seed = liveEncoder(ninety, 2), entries = liveEncoder(later, 2, false, 'dU');
  const event = entries.slice(entries.indexOf('A1\t'));
  const invalid = entries.replace(/(A1[^\n]*\t)\d+\n$/, '$10\n');
  function heard(bytes) {
    const result = spawnSync(process.argv[2], ['--live', '--output', join(tmp, 'events.bmp')], { input: bytes });
    assert.equal(result.status, 0);
    return [...result.stderr.toString().matchAll(/Station entry ((?:Up|Down)(?: booked)?)/g)].map((m) => m[1]);
  }
  assert.deepEqual(heard(seed + entries + event + seed + entries), ['Down booked', 'Up']);
  assert.deepEqual(heard(seed + entries.replace(/^S1[^\n]+\n/, '')), ['Down', 'Up']);
  assert.deepEqual(heard(seed + entries.replace(/^S1[^\n]+/, 'S1\t1\t3\t0')), ['Down', 'Up']);
  assert.deepEqual(heard(seed + invalid + event), []);
  assert.deepEqual(heard(entries), []);
  assert.deepEqual(heard(initial + delta + event), []);
  // Live per-area expiry removes a Hemel card and keeps the last train in stale colours.
  const raw = { ...board, areaStatus: { R1: 'Stale', WJ: 'Live', WS: 'Live' } };
  const stale = project(raw, () => null, true);
  assert.ok(stale.cards.every((c) => !c[4]));
  assert.ok(stale.rows.every((r, i) => !markers[i].id.startsWith('R1') || (!r[0] && (!r[1] || r[1] === 3))));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
