// The checked points come from the browser diagram at 1024 × 600. Badge
// samples sit below the glyphs so font rasterisation does not affect them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'hemel-'));
const simulator = process.argv[2];
const train = 0xf4c465,
  stop = 0xb0372f,
  platform = 0x405d48;

function checkFrame(view, seconds, checks, light = true) {
  const file = join(temp, 'screen.bmp');
  const args = ['--sample', view, '--view', view, '--at', String(seconds), '--output', file];
  if (light) args.push('--light');
  execFileSync(simulator, args);
  const bmp = readFileSync(file);
  const width = bmp.readInt32LE(18),
    height = bmp.readInt32LE(22);
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.deepEqual([width, height, bmp.readUInt16LE(28)], [1024, 600, 24]);
  const stride = (width * 3 + 3) & ~3;
  for (const [label, x, y, expected] of checks) {
    const offset = bmp.readUInt32LE(10) + (height - 1 - y) * stride + 3 * x;
    const actual = bmp.readUIntLE(offset, 3);
    // Host and emulator can expand the 5/6-bit channels differently.
    const mask = 0xf8fcf8;
    assert.equal(actual & mask, expected & mask, `${view} +${seconds}s: ${label} at (${x}, ${y})`);
  }
}

try {
  checkFrame('sector', 5, [
    ['2N71 on the Down Fast', 497, 296, train],
    ['4L26 on the Up Fast', 759, 340, train],
    ['2D70 on the Down DC', 191, 162, train],
  ]);
  checkFrame('hemel', 90, [
    ['1A80 at Hemel', 560, 274, train],
    ['2K65 at Hemel', 560, 381, train],
    ['R103:7 on', 567, 137, stop],
  ]);
  checkFrame('hemel', 250, [
    ['1A80 has vacated', 560, 274, platform],
    ['2K65 has vacated', 560, 381, platform],
  ]);
  checkFrame('watford', 110, [
    ['2F39 at Garston', 779, 519, train],
    ['2F23 in platform 11', 560, 519, train],
  ]);
  checkFrame(
    'hemel',
    90,
    [
      ['dark train badge', 560, 274, 0xf7ca73],
      ['dark restrictive signal', 567, 137, 0xff887c],
    ],
    false,
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
