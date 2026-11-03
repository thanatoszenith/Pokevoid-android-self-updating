import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

test('unresponsive WebView cache APIs never block game startup', async () => {
  for (const sourcePath of ['bootstrap/native-cache.ts','patches/native-cache.ts']) {
    const source = fs.readFileSync(sourcePath, 'utf8').replace('export async function', 'async function');
    const serviceWorker = { register: async () => true, getRegistrations: async () => new Promise(() => {}) };
    const caches = { open: async () => true, keys: async () => new Promise(() => {}) };
    const context = vm.createContext({
      console, navigator: { serviceWorker }, window: { caches }, caches,
      setTimeout: cb => { queueMicrotask(cb); return 1; },
      clearTimeout: () => {},
    });
    vm.runInContext(stripTypeScriptTypes(source), context);
    await vm.runInContext('clearNativeAssetCaches()', context);
    await assert.rejects(serviceWorker.register(), /Native asset caching is disabled/);
    await assert.rejects(caches.open(), /Native asset caching is disabled/);
  }
});

test('native game startup does not await cache maintenance', () => {
  const apply = fs.readFileSync('patches/apply.mjs', 'utf8');
  const bootstrap = fs.readFileSync('bootstrap/main.ts', 'utf8');
  assert.doesNotMatch(apply, /await clearNativeAssetCaches\(/);
  assert.doesNotMatch(bootstrap, /await clearNativeAssetCaches\(/);
  assert.match(bootstrap, /Checking installed game in PokeVoid\/Game/);
  assert.match(bootstrap, /reportStartup/);
  const html = fs.readFileSync('bootstrap/index.html', 'utf8');
  assert.match(html, /The installer did not start/);
});
