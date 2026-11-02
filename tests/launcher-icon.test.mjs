import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

test('supplied PNG creates legacy and adaptive icons without stale default art',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pokevoid-icon-'));
  try {
    const res=path.join(root,'res');fs.mkdirSync(path.join(res,'mipmap-anydpi-v26'),{recursive:true});
    fs.writeFileSync(path.join(res,'mipmap-anydpi-v26/ic_launcher.xml'),'old icon');
    fs.writeFileSync(path.join(root,'AndroidManifest.xml'),'<manifest><application android:icon="@mipmap/old" android:roundIcon="@mipmap/old"/></manifest>');
    const args=['scripts/install-launcher-icon.py','assets/pokevoid-launcher.png',res];
    const run=spawnSync(process.env.PYTHON||'python',args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
    const inspect=spawnSync(process.env.PYTHON||'python',['-c','import sys,json; from PIL import Image; from pathlib import Path; p=Path(sys.argv[1]); print(json.dumps({f.relative_to(p).as_posix():list(Image.open(f).size) for f in p.rglob("*.png")}))',res],{encoding:'utf8'});
    assert.equal(inspect.status,0,inspect.stderr);const sizes=JSON.parse(inspect.stdout);
    for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192}))
      for(const name of ['ic_launcher.png','ic_launcher_round.png'])assert.deepEqual(sizes['mipmap-'+density+'/'+name],[size,size]);
    assert.deepEqual(sizes['drawable/pokevoid_icon_foreground.png'],[432,432]);
    assert.match(fs.readFileSync(path.join(res,'mipmap-anydpi-v26/ic_launcher.xml'),'utf8'),/pokevoid_icon_foreground/);
    const icon=path.join(res,'mipmap-xxxhdpi/ic_launcher.png');
    const before=crypto.createHash('sha256').update(fs.readFileSync(icon)).digest('hex');
    assert.equal(spawnSync(process.env.PYTHON||'python',args,{encoding:'utf8'}).status,0);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(icon)).digest('hex'),before);
    assert.ok(fs.readFileSync(path.join(root,'AndroidManifest.xml'),'utf8').includes('@mipmap/ic_launcher'));
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
