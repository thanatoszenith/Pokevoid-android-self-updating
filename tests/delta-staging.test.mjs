import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('delta stage verifies downloaded archive and every reconstructed file', () => {
  const source = read('native/ExternalGameStorage.java');
  const stage = source.slice(source.indexOf('public synchronized void stageDelta('), source.indexOf('public synchronized void activate('));
  assert.match(stage, /matches\(archive, deltaSha\)/);
  assert.match(stage, /matches\(dest, item\.getValue\(\)\)/);
  assert.match(stage, /Files\.copy\(original\.toPath\(\), dest\.toPath\(\)\)/);
  assert.match(stage, /version\(\)\.equals\(baseVersion\)/);
  assert.match(stage, /removeTree\(staging\)/);
  assert.doesNotMatch(stage, /removeTree\(current\(\)\)/);
});

test('delta stage uses the same transactional activation as full update', () => {
  const native = read('native/ExternalGamePlugin.java');
  const bridge = read('bootstrap/external-game.ts');
  assert.match(native, /@PluginMethod public void stageDelta\(PluginCall call\)/);
  assert.match(native, /storage\(\)\.stageDelta\(archive, sha, baseVersion, targetVersion, targetSha, hashes\)/);
  assert.match(bridge, /stageDelta\(options:/);
});
