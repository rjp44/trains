// Exercise the exact flash bundle with just the two native bindings and a clock.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { crc32 } from 'node:zlib';
const tmp = mkdtempSync(join(tmpdir(), 'hemel-feed-'));
try {
  const bundle = join(tmp, 'feed.js');
  execFileSync(process.execPath, [fileURLToPath(new URL('bundle.mjs', import.meta.url)), bundle]);
  let now = Date.UTC(2026, 10, 25, 15), seq = 0;
  const clock = class extends Date { static now() { return now; } };
  const ctx = vm.createContext({ panelCRC: crc32, londonDate: () => '25/11/26', Date: clock });
  vm.runInContext(readFileSync(bundle, 'utf8'), ctx);
  const f = ctx.railFeed;
  const msg = (type, message, area = 'R1', timestamp = now, messageID = seq++) =>
    f.message(JSON.stringify({ Message: { type, area, messageID, timestamp, message } }));
  const packets = [];
  function frame(directions = '', full = false) {
    const packet = f.packet(full);
    assert.equal(packet.match(/^A1\t\d+\t\d+\t([DU]+)\t\d+$/m)?.[1] || '', directions);
    packets.push(packet);
    return packet;
  }
  f.start();
  assert.deepEqual(JSON.parse(f.opened()).Message.areas, ['R1','WJ','WS']);
  msg('TD_UPDATE', { R15145: '2K65' }); // pre-seed
  msg('TD_ALL', { R13143: '2K01' });
  frame('', true);
  msg('TD_UPDATE', { R13139: '2K15' }); // approach only
  frame();
  msg('TD_UPDATE', { R13143:'1A80', R13144:'1A81', R15145:'2K65', R15146:'2K64' });
  frame('DUDU');
  msg('TD_UPDATE', { R13143:'1A80', R13144:'1A81', R15145:'2K65', R15146:'2K64' });
  frame();
  msg('TRUST_ALL', { '123': { ti:'001A80000', t:['R1'], ol:'ORIGIN',dl:'DEST',tc:'LM' } });
  assert.match(frame(), /Origin to Dest/);
  now += 5100; f.tick(); frame(); // card rotation
  msg('TD_ALL', { R15145:'2K65' }); frame();
  msg('TD_UPDATE', { R15145:'ITEM', R15146:'', R13144:'', R13143:'' }); frame();
  msg('TD_UPDATE', { R15145:'2K65' }); frame('D');
  msg('TD_UPDATE', { R15146:'2K64' }, 'R1', now, seq-1); frame(); // duplicate message ID
  now += 10000;
  msg('TD_ALL', { R13143:'1B00' }, 'R1', now-40000); frame(); // older than last R1 observation
  msg('TD_UPDATE', { R15146:'2K64' }, 'R1', now-46000); frame();
  assert.equal(f.tick(), 0);
  now += 2500; assert.ok(f.tick()); f.opened();
  seq = 0;
  msg('TD_UPDATE', { R15146:'2K64' }); frame();
  msg('TD_ALL', { R15146:'2K64' }); frame();
  msg('TD_UPDATE', { R15146:'2K64' }); frame();
  msg('TD_UPDATE', { R15146:'1A99' }); frame('U');
  msg('TD_UPDATE', { R13143:'1C00' }, 'R1', now, seq+1); frame(); // gap resets pending
  // A timetable can promote an approaching train to a next-booked card.
  now += 4000; assert.ok(f.tick()); f.opened(); seq = 0;
  msg('TD_ALL', { R13139: '1A88' });
  msg('TD_UPDATE', {});
  msg('TRUST_ALL', { '001A880125': { ti: '001A880125', t: ['R1'], sk: 'X12345', st: now,
    ol: 'WATFORD JUNCTION', dl: 'TRING', tc: 'LM' } });
  frame();
  assert.match(f.request(), /X12345\/25\/11\/26$/);
  const heading = 'Location|P|WTT|Public|Actual|WTT|Actual|WTT|Public|Actual|Path-Line|Allowances|Activities|P|Notes';
  function timetableRow(location, depart, activity) {
    const cells = Array(15).fill('');
    cells[0] = '<a href="/rail/liverail/sum/' + location + '/25/11/26">Station</a>';
    cells[8] = depart; cells[12] = activity;
    return '<tr><td>' + cells.join('</td><td>') + '</td></tr>';
  }
  f.response('<html><h2>Service (X12345)</h2>Train ID = "001A880125"<table><tr><th>' +
    heading.split('|').join('</th><th>') + '</th></tr>' + timetableRow('WATFDJ', '', 'Train begins') +
    timetableRow('HEMLHMP', '15:25', '') + timetableRow('TRING', '', 'Train finishes') + '</table></html>');
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(frame(), /Approaching Hemel.*Booked 15:25/);
  msg('TD_UPDATE', { R13143: '1A88' });
  assert.match(frame('D'), /^S1\t\d+\t1\t\d+\n/);
  if (process.argv[2]) writeFileSync(process.argv[2], packets.join(''));
  console.log('Passed all four tracks, replacement, approach, repeats, service details, rotation, stale, reconnect and gap');
} finally { rmSync(tmp, { recursive: true, force: true }); }
