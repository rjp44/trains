import { readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { relative, resolve, isAbsolute, sep } from 'node:path';
import { encode, maxBytes } from '../app-format/format.mjs';

export function compile(path = new URL('../../apps/hemel/overlay.json', import.meta.url)) {
  const { licenceFile, ...source } = JSON.parse(readFileSync(path));
  const root = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
  if (typeof licenceFile !== 'string' || isAbsolute(licenceFile))
    throw Error('Expected a repository-relative licenceFile');
  const file = realpathSync(resolve(root, licenceFile)),
    name = relative(root, file);
  if (name === '..' || name.startsWith('..' + sep) || isAbsolute(name) || statSync(file).size > maxBytes)
    throw Error('Invalid package licence file');
  return encode(source, readFileSync(file));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4)
    throw Error('Usage: node packages/compiler/build.mjs SOURCE.json OUTPUT.tdp');
  writeFileSync(process.argv[3], compile(process.argv[2]));
}
