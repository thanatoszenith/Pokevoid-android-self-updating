import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync('native/ResumableDownloadPlugin.java', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');
const patcher = fs.readFileSync('patches/apply.mjs', 'utf8');
const bootstrap = fs.readFileSync('bootstrap/main.ts', 'utf8');
const gate = fs.readFileSync('patches/update-gate.ts', 'utf8');

test('both entrypoints use the resumable downloader before Capgo installation', () => {
  for (const source of [bootstrap, gate]) {
    assert.match(source, /ResumableDownload\.download\(/);
    assert.match(source, /CapacitorUpdater\.download\(\{\s*url: archive\.url/);
    assert.match(source, /ResumableDownload\.addListener\('progress'/);
  }
});

test('native bridge retains partial files and verifies archives before serving', () => {
  assert.match(native, /getFilesDir\(\)/);
  assert.match(native, /\.part/);
  assert.match(native, /setRequestProperty\("Range"/);
  assert.match(native, /Content-Range/);
  assert.match(native, /matches\(partial, key\)/);
  assert.match(native, /127\.0\.0\.1/);
});

test('Android build registers the plugin and bundles both TypeScript shims', () => {
  assert.match(workflow, /registerPlugin\(ResumableDownloadPlugin\.class\)/);
  assert.match(workflow, /ResumableDownloadPlugin\.java/);
  assert.match(patcher, /resumable-download\.ts/);
  assert.ok(fs.existsSync('bootstrap/resumable-download.ts'));
  assert.ok(fs.existsSync('patches/resumable-download.ts'));
});
