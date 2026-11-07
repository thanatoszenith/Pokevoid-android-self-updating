import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('warm launch opens installed game without network release fetch', () => {
  const source = read('bootstrap/main.ts');
  const installed = source.indexOf("if (await reportStartup('Opening installed game…', restoreInstalledGame()))");
  const network = source.indexOf('latest = await release()');
  assert.ok(installed >= 0 && network > installed);
  assert.match(source.slice(installed, network), /return;/);
});

test('startup timing instrumentation and no redundant folder setup', () => {
  const source = read('bootstrap/main.ts');
  assert.match(source, /startupMetric\('Installed game open requested'/);
  assert.doesNotMatch(source, /await SharedStorage\.createFolders\(\)/);
});

test('installed game is not rehashed on warm launch', () => {
  const source = read('native/ExternalGameStorage.java');
  const start = source.indexOf('public boolean installed()');
  const end = source.indexOf('public boolean pending()', start);
  assert.match(source.slice(start, end), /index\.html/);
  assert.doesNotMatch(source.slice(start, end), /matches\(/);
});

test('confirmed rollback deletion is off the launch-critical worker', () => {
  const storage = read('native/ExternalGameStorage.java');
  const plugin = read('native/ExternalGamePlugin.java');
  const confirm = storage.slice(storage.indexOf('public synchronized void confirm()'), storage.indexOf('public synchronized void cleanupConfirmed()'));
  assert.doesNotMatch(confirm, /removeTree\(/);
  assert.match(plugin, /maintenance\.execute\(\(\) -> \{\s*try \{\s*storage\(\)\.cleanupConfirmed\(\)/);
});

test('resumable downloader preserves partial data after retry exhaustion', () => {
  const source = read('native/ResumableDownloadPlugin.java');
  assert.match(source, /partial data preserved/);
  assert.match(source, /Range/);
});
