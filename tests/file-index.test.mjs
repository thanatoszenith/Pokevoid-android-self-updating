import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createFileIndex } from '../scripts/create-file-index.mjs';

test('file index includes deterministic SHA-256 hashes and sizes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevoid-index-'));
  try {
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), 'hello');
    fs.writeFileSync(path.join(dir, 'assets', 'game.js'), 'game');
    const zip = path.join(dir, 'game.zip');
    execFileSync('zip', ['-q', '-r', zip, 'index.html', 'assets'], { cwd: dir });
    const index = createFileIndex(zip, '1.2.3');
    assert.equal(index.version, '1.2.3');
    assert.equal(index.files.length, 2);
    assert.equal(index.files.find(f => f.path === 'index.html').size, 5);
    assert.match(index.archiveSha256, /^[a-f0-9]{64}$/);
    assert.ok(index.files.every(f => /^[a-f0-9]{64}$/.test(f.sha256)));
    assert.deepEqual(createFileIndex(zip, '1.2.3'), index);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file index rejects invalid version', () => {
  assert.throws(() => createFileIndex('unused.zip', '../1'), /Invalid game version/);
});
