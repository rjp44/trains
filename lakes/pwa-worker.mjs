import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

export const publicDir = new URL('./public/', import.meta.url);
export async function offlineWorker() {
  const files = [];
  async function visit(prefix) {
    for (const entry of await readdir(new URL(prefix, publicDir), { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) await visit(path + '/');
      else if (entry.isFile() && !entry.name.startsWith('.')) files.push(path);
    }
  }
  await visit('');
  files.sort();
  const template = await readFile(new URL('./worker-template.js', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(template);
  for (const file of files) hash.update(file).update(await readFile(new URL(file, publicDir)));
  return template
    .replace('__REVISION__', JSON.stringify(hash.digest('hex').slice(0, 16)))
    .replace('__ASSETS__', JSON.stringify(files.map((file) => '/' + file)));
}
