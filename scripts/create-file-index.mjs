import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** Deterministic per-file inventory for future incremental updates.
 * Generated at publication, never during a normal Android launch.
 * This does NOT change the existing full-ZIP installation protocol.
 */
export function createFileIndex(zip, version) {
  if (!/^\d+(?:\.\d+)*$/.test(version)) throw Error('Invalid game version');
  if (!fs.statSync(zip).isFile()) throw Error('Missing game ZIP');
  const names = execFileSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim().split('\n');
  if (names.length > 200000 || !names.includes('index.html')) throw Error('Invalid game archive');
  const seen = new Set();
  const files = [];
  for (const name of names) {
    if (!name || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.includes('\r') || name.includes('\n') || name.split('/').includes('..') || seen.has(name))
      throw Error('Unsafe or duplicate archive entry');
    seen.add(name);
    if (name.endsWith('/')) continue;
    const bytes = execFileSync('unzip', ['-p', zip, name], { maxBuffer: 256 * 1024 * 1024 });
    files.push({ path: name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { schema: 1, version, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), files };
}

if (process.argv[1] && process.argv[1].endsWith('create-file-index.mjs')) {
  const [zip, version, output] = process.argv.slice(2);
  if (!zip || !version || !output) throw Error('Usage: create-file-index.mjs ZIP VERSION OUTPUT');
  fs.writeFileSync(output, JSON.stringify(createFileIndex(zip, version)) + '\n');
}
