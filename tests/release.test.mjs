import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare } from '../scripts/check-release-order.mjs';
test('numeric versions compare by components, not lexicographically', () => {
  assert.equal(compare('1.10', '1.9'), 1);
  assert.equal(compare('1.2.0', '1.2'), 0);
  assert.equal(compare('2', '10'), -1);
});
test('invalid and unsafe versions are rejected', () => {
  for (const v of ['1..2', 'v1.0', '1.9007199254740992', '1.-2', '']) {
    assert.throws(() => compare(v, '1.0'));
  }
});

test('workflow does not interpolate version input directly into shell commands', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
  const runBlocks = workflow.split(/\n\s*- name: /).filter(section => /\n\s*run:/.test(section));
  for (const section of runBlocks) {
    const runPart = section.split(/\n\s*run:\s*(?:\||>\s*)?\n?/)[1];
    if (runPart) assert.doesNotMatch(runPart, /\$\{\{\s*inputs\.version\s*\}\}/);
  }
});

test('official daily sync initializes at game boot, not only on daily selection', () => {
  const apply = fs.readFileSync(new URL('../patches/apply.mjs', import.meta.url), 'utf8');
  const daily = fs.readFileSync(new URL('../patches/offline-daily.mjs', import.meta.url), 'utf8');
  assert.match(apply, /startOfficialDailySync\(\)/);
  assert.match(apply, /if \(Capacitor\.isNativePlatform\(\)\)/);
  assert.doesNotMatch(daily, /startOfficialDailySync\(\)/);
});
