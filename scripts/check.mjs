import { readFile, readdir, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const extension = path.resolve('extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (manifest.manifest_version !== 3 || manifest.version !== pkg.version) {
  throw new Error('Check the manifest format and package version.');
}
await access(path.join(extension, manifest.chrome_url_overrides.newtab));
await access(path.join(extension, manifest.background.service_worker));
const html = await readFile(path.join(extension, 'newtab.html'), 'utf8');
for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!/^https?:/.test(match[1])) await access(path.join(extension, match[1]));
}
async function checkScripts(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) await checkScripts(filename);
    else if (/\.m?js$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`Syntax check failed: ${filename}`);
    }
  }
}
for (const folder of ['extension', 'scripts', 'tests']) await checkScripts(folder);
console.log('Manifest, asset paths and JavaScript syntax checked.');
