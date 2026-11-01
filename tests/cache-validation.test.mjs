import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../patches/daily-cache.ts', import.meta.url), 'utf8');
test('official daily cache validates stored and newly downloaded seeds using one predicate', () => {
  assert.match(src, /const validSeed = /);
  assert.match(src, /value\.day === utcDay\(\) && validSeed\(value\.seed\)/);
  assert.match(src, /if \(!validSeed\(seed\)\) return cachedOfficialDaily\(\)/);
});
