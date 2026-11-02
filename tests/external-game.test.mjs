import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const java = fs.readFileSync('native/ExternalGamePlugin.java', 'utf8');
const bridge = fs.readFileSync('bootstrap/external-game.ts', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');

test('external game installer is registered in the Android build', () => {
  assert.match(workflow, /ExternalGamePlugin\.java/);
  assert.match(workflow, /registerPlugin\(ExternalGamePlugin\.class\)/);
  assert.match(bridge, /registerPlugin</);
});

test('external extraction is permission-gated and validates archive paths and hashes', () => {
  assert.match(java, /Environment\.isExternalStorageManager\(\)/);
  assert.match(java, /PokeVoid\/Game/);
  assert.match(java, /matches\(archive, key\)/);
  assert.match(java, /canonical\.startsWith\(base\)/);
  assert.match(java, /index\.html/);
});

test('activation preserves previous version until launch confirmation', () => {
  assert.match(java, /public void activate\(PluginCall call\)/);
  assert.match(java, /active\.renameTo\(previous\)/);
  assert.match(java, /staged\.renameTo\(active\)/);
  assert.match(java, /previous\.renameTo\(active\)/);
  assert.match(java, /public void confirmLaunch\(PluginCall call\)/);
  assert.match(java, /deleteTree\(previous\)/);
  assert.match(java, /public void recover\(PluginCall call\)/);
});

test('staging never extracts game assets into private app storage', () => {
  assert.match(java, /new File\(root, "\.staging-"/);
  assert.doesNotMatch(java, /getContext\(\)\.getFilesDir\(\), "current"/);
});
