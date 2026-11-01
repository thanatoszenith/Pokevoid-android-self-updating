import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const script = new URL('../scripts/inject-feed.mjs', import.meta.url).pathname;
function run(feed) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'feed-test-'));
 const file=path.join(dir,'main.ts');
 try {fs.writeFileSync(file,"const feed = '__POKEVOID_UPDATE_FEED__';");
  const result=spawnSync(process.execPath,[script,file],{env:{...process.env,POKEVOID_UPDATE_FEED:feed},encoding:'utf8'});
  return {status:result.status,source:fs.readFileSync(file,'utf8')};
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('feed with apostrophe is escaped safely in TS string',()=>{
 const r=run("https://example.com/a'b.json");
 assert.equal(r.status,0);
 assert.match(r.source,/"https:\/\/example.com\/a'b.json"/);
});
test('rejects non-HTTPS update feed',()=>assert.notEqual(run('http://example.com/feed.json').status,0));
