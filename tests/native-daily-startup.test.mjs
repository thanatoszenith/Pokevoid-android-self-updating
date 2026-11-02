import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('startup patch uses the imported Capacitor native detection API', () => {
  const source = fs.readFileSync('patches/apply.mjs', 'utf8');
  assert.match(source, /import \{ Capacitor \} from "@capacitor\/core"/);
  assert.match(source, /if \(Capacitor\.isNativePlatform\(\)\) \{ await initializeDirectSaves\(\); startOfficialDailySync\(\); \}/);
  assert.doesNotMatch(source, /\(window as any\)\.Capacitor/);
});
