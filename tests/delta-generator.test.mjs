import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createDelta } from '../scripts/create-delta.mjs';

test('delta contains changed files, excludes unchanged and deleted files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevoid-delta-test-'));
  try {
    const old = path.join(root, 'old'), next = path.join(root, 'next');
    fs.mkdirSync(old); fs.mkdirSync(next);
    fs.writeFileSync(path.join(old, 'index.html'), 'old');
    fs.writeFileSync(path.join(next, 'index.html'), 'new');
    fs.writeFileSync(path.join(old, 'deleted.txt'), 'deleted');
    const unchanged = 'unchanged '.repeat(10000);
    fs.writeFileSync(path.join(old, 'keep.txt'), unchanged);
    fs.writeFileSync(path.join(next, 'keep.txt'), unchanged);
    const oldZip = path.join(root, 'old.zip'), newZip = path.join(root, 'new.zip');
    execFileSync('zip', ['-q', oldZip, 'index.html', 'deleted.txt', 'keep.txt'], { cwd: old });
    execFileSync('zip', ['-q', newZip, 'index.html', 'keep.txt'], { cwd: next });
    const deltaZip = path.join(root, 'delta.zip');
    const delta = createDelta(oldZip, newZip, '1.0', '1.1', deltaZip);
    assert.ok(delta);
    assert.equal(delta.from, '1.0');
    assert.equal(delta.files['index.html'].length, 64);
    assert.equal(delta.files['deleted.txt'], undefined);
    const entries = execFileSync('unzip', ['-Z', '-1', deltaZip], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(entries, ['index.html']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
