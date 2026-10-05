import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';

const files = {};
async function collect(folder, prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) await collect(filename, `${name}/`);
    else files[name] = new Uint8Array(await readFile(filename));
  }
}
await collect('extension');
const { version } = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
await mkdir('dist', { recursive: true });
const output = `dist/lumen-new-tab-${version}.zip`;
await writeFile(output, zipSync(files, { level: 9 }));
console.log(output);
