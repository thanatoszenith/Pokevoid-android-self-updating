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

test('resumed responses validate byte ranges and archive cleanup happens only after import', () => {
  assert.match(native, /declaredTotal = Long\.parseLong/);
  assert.match(native, /Inconsistent Content-Range and Content-Length/);
  for (const source of [bootstrap, gate]) {
    const imported = source.indexOf('CapacitorUpdater.download({');
    const released = source.indexOf('ResumableDownload.releaseArchive(');
    assert.ok(imported >= 0 && released > imported, 'archive cannot be deleted before import');
  }
});

test('build patches the generated activity rather than introducing a duplicate', () => {
  assert.match(workflow, /rglob\('MainActivity\.java'\)/);
  assert.doesNotMatch(workflow, /cat > android\/app\/src\/main\/java\/com\/zenni\/pokevoid\/MainActivity\.java/);
});

test('successful bundles remain recoverable when Capgo omits checksum metadata', () => {
  for (const source of [bootstrap, gate]) {
    assert.match(source, /bundle\.status === 'success'/);
    assert.match(source, /!\(bundle as typeof bundle & \{ checksum\?: string \}\)\.checksum/);
  }
});

test('publication validates public ZIP before deploying the update feed', () => {
  const publish = fs.readFileSync('.github/workflows/publish-game.yml', 'utf8');
  const zipCheck = publish.indexOf('Verify release ZIP is publicly downloadable');
  const feedDeployment = publish.indexOf('Prepare Pages update manifest');
  assert.ok(zipCheck >= 0 && feedDeployment > zipCheck);
  assert.match(publish, /curl --head --fail --location/);
});

test('loopback ZIP server rejects invalid ranges and caps request headers', () => {
  assert.match(native, /416 Range Not Satisfiable/);
  assert.match(native, /headerCount > 64/);
  assert.match(native, /start >= file\.length\(\)/);
});

test('bootstrap does not make redundant cross-origin HEAD requests', () => {
  assert.doesNotMatch(bootstrap, /fetchBundleSize\(/);
});

test('bootstrap retry reuses the interrupted download action directly', () => {
  assert.match(bootstrap, /const install = async \(\) => \{/);
  assert.match(bootstrap, /retry\('Retry download', install\)/);
  assert.doesNotMatch(bootstrap, /retry\('Retry download', async \(\) => \{ await main\(\); \}\)/);
});

test('HTTP 416 response uses CRLF escapes, not escaped backslash characters', () => {
  const line = native.split('\n').find(x => x.includes('416 Range Not Satisfiable'));
  assert.ok(line);
  assert.ok(line.includes(String.raw`\r\nContent-Range`));
  assert.ok(!line.includes(String.raw`\\r\\nContent-Range`));
});
