import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../native/ExternalGameStorage.java', import.meta.url), 'utf8');
test('external game releases live in shared PokeVoid/Game', () => {
  assert.match(source, /"PokeVoid\/Game"/);
  assert.match(source, /new File\(root\(\), "releases"\)/);
});
test('external extraction verifies archive and rejects traversal', () => {
  assert.match(source, /sameHash\(archive, checksum\)/);
  assert.match(source, /getCanonicalPath\(\)/);
  assert.match(source, /ZIP path traversal blocked/);
  assert.match(source, /staging\.renameTo\(dest\)/);
});
test('existing external game release is not deleted by the installer', () => {
  assert.match(source, /Existing incomplete release requires explicit recovery/);
  assert.doesNotMatch(source, /removeTree\(dest\)/);
});
