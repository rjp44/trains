// Build the same projection and feed code the USB bridge uses into a flash asset.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const here = (path) => fileURLToPath(new URL(path, import.meta.url));
await build({
  entryPoints: [here('board.mjs')], outfile: process.argv[2], bundle: true,
  format: 'iife', globalName: 'railFeed', platform: 'browser', target: 'es2022', minify: true,
  plugins: [{ name: 'device-crc', setup(b) {
    if (process.argv.includes('--runtime-layout')) {
      b.onResolve({ filter: /corridor\.json$/ }, () => ({path:'layout',namespace:'overlay'}));
      b.onLoad({filter: /.*/,namespace:'overlay'}, () => ({contents:'export default globalThis.transportCorridor;'}));
    }
    b.onResolve({ filter: /^node:zlib$/ }, () => ({ path: 'crc', namespace: 'device' }));
    b.onLoad({ filter: /.*/, namespace: 'device' }, () => ({ contents: 'export const crc32 = globalThis.panelCRC;' }));
  } }],
});
