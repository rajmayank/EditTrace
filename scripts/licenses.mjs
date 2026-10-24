import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['Third-party software distributed with EditTrace\n'];
for (const [path, entry] of Object.entries(lock.packages)) {
  if (!path || entry.dev) continue;
  const files = await readdir(path);
  const license = files.find(f => /^licen[sc]e(?:\.|$)/i.test(f));
  if (!license) throw new Error('Missing license text: ' + path);
  notices.push(`\n${'='.repeat(70)}\n${path.replace('node_modules/', '')} ${entry.version}\n\n` + await readFile(join(path, license), 'utf8'));
}
await writeFile('dist/third-party-licenses.txt', notices.join('\n'));
