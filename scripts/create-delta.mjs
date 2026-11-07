import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createFileIndex } from './create-file-index.mjs';

export function createDelta(oldZip, newZip, oldVersion, newVersion, output) {
  const oldIndex = createFileIndex(oldZip, oldVersion);
  const nextIndex = createFileIndex(newZip, newVersion);
  const oldFiles = new Map(oldIndex.files.map(f => [f.path, f.sha256]));
  const changed = nextIndex.files.filter(f => oldFiles.get(f.path) !== f.sha256).map(f => f.path);
  if (!changed.length) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevoid-delta-'));
  try {
    execFileSync('unzip', ['-q', newZip, '-d', dir]);
    const list = changed.join('\n') + '\n';
    const result = execFileSync('zip', ['-q', '-@', path.resolve(output)], { cwd: dir, input: list, maxBuffer: 1024 * 1024 });
    void result;
    const size = fs.statSync(output).size;
    if (size >= fs.statSync(newZip).size) { fs.rmSync(output, { force: true }); return null; }
    return { from: oldVersion, url: '', checksum: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'), bytes: size, files: Object.fromEntries(nextIndex.files.map(f => [f.path, f.sha256])) };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

if (process.argv[1]?.endsWith('create-delta.mjs')) {
  const [oldZip, newZip, oldVersion, newVersion, output, metadata] = process.argv.slice(2);
  if (!metadata) throw Error('Usage: create-delta.mjs OLD_ZIP NEW_ZIP OLD_VERSION NEW_VERSION DELTA_ZIP METADATA_JSON');
  const result = createDelta(oldZip, newZip, oldVersion, newVersion, output);
  fs.writeFileSync(metadata, JSON.stringify(result) + '\n');
}
