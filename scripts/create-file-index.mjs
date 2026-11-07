import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

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
    // Stream extraction through a small temporary file instead of buffering
    // potentially huge game assets in the Node.js heap.
    const tmp = fs.mkdtempSync(new URL('pokevoid-index-', 'file:///tmp/').pathname);
    try {
      const target = tmp + '/entry';
      const fd = fs.openSync(target, 'w');
      try {
        const result = spawnSync('unzip', ['-p', zip, name], { stdio: ['ignore', fd, 'pipe'], maxBuffer: 1024 * 1024 });
        if (result.status !== 0 || result.error) throw Error('Cannot extract indexed entry: ' + name);
      } finally { fs.closeSync(fd); }
      const hash = crypto.createHash('sha256');
      const file = fs.openSync(target, 'r');
      let size = 0;
      try {
        const buffer = Buffer.allocUnsafe(65536);
        let n;
        while ((n = fs.readSync(file, buffer, 0, buffer.length, null)) > 0) {
          hash.update(buffer.subarray(0, n));
          size += n;
        }
      } finally { fs.closeSync(file); }
      files.push({ path: name, size, sha256: hash.digest('hex') });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return { schema: 1, version, archiveSha256: crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'), files };
}

if (process.argv[1] && process.argv[1].endsWith('create-file-index.mjs')) {
  const [zip, version, output] = process.argv.slice(2);
  if (!zip || !version || !output) throw Error('Usage: create-file-index.mjs ZIP VERSION OUTPUT');
  fs.writeFileSync(output, JSON.stringify(createFileIndex(zip, version)) + '\n');
}
