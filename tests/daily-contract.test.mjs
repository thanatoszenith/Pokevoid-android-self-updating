import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const read = file => fs.readFileSync(new URL(file, root), 'utf8');
test('release manifest declares both protected daily capabilities', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pokevoid-contract-'));
  try {
    fs.writeFileSync(path.join(dir,'pokevoid-game-1.0.zip'),'fixture');
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('scripts/create-manifest.mjs',root))],{cwd:dir,env:{...process.env,POKEVOID_VERSION:'1.0',POKEVOID_RELEASE_BASE_URL:'https://github.com/example/repo/releases/download/game-feed/'},encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const m=JSON.parse(fs.readFileSync(path.join(dir,'capacitor-update.json')));
    assert.deepEqual(m.features,['offline-daily-v1','official-daily-cache-v1','external-game-v1']);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('both first-install and update activation reject missing daily capability declarations', () => {
  assert.match(read('bootstrap/main.ts'), /x\.features\.includes\('offline-daily-v1'\)/);
  assert.match(read('patches/update-gate.ts'), /r\.features\.includes\('offline-daily-v1'\)/);
  assert.match(read('scripts/verify-publication.mjs'), /manifest\.features\.includes\('offline-daily-v1'\)/);
});
test('release order check reads bounded stream instead of unbounded response.text()', () => {
  const s=read('scripts/check-release-order.mjs');
  assert.match(s,/response\.body\.getReader\(\)/);
  assert.doesNotMatch(s,/response\.text\(\)/);
});

test('both installers restrict game downloads to immutable releases from feed owner', () => {
  for (const file of ['bootstrap/main.ts', 'patches/update-gate.ts']) {
    const source = read(file);
    assert.match(source, /function trustedGameAsset\(/);
    assert.match(source, /releases\/download\/game-feed\/pokevoid-game-\$\{version\}\.zip/);
    assert.match(source, /trustedGameAsset\(/);
  }
});
