import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('native startup initializes saves while online checks remain nonblocking', () => {
  const source = fs.readFileSync('patches/apply.mjs', 'utf8');
  assert.ok(source.includes('import { Capacitor } from "@capacitor/core"'));
  assert.ok(source.includes('prefetchGameUpdate();'));
  assert.ok(source.includes('await initializeDirectSaves(); startOfficialDailySync();'));
  assert.ok(source.includes('if (Capacitor.isNativePlatform())'));
  assert.ok(!source.includes('await updateBeforeGame()'));
  assert.ok(!source.includes('(window as any).Capacitor'));
});
