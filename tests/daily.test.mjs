import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const patch = new URL('../patches/offline-daily.mjs', import.meta.url).pathname;
const original = `            if (!Utils.isLocal) {
                fetchDailyRunSeed().then(seed => {
                    if (seed) {
                        generateDaily(seed);
                    } else {
                        throw new Error("Daily run seed is null!");
                    }
                }).catch(err => {
                    console.error("Failed to load daily run:\\n", err);
                });
            } else {
                generateDaily(btoa(new Date().toISOString().substring(0, 10)));
            }`;
test('patch adds independent offline and online daily selection',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-'));
 try {
  fs.mkdirSync(path.join(dir,'src/phases'),{recursive:true});
  const file=path.join(dir,'src/phases/title-phase.ts');fs.writeFileSync(file,'    initDailyRun(): void {\n' + original);
  const run=spawnSync(process.execPath,[patch],{cwd:dir,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const updated=fs.readFileSync(file,'utf8');
  assert.match(updated,/Offline Daily/);
  assert.match(updated,/Official Online Daily/);
  assert.match(updated,/generateDaily\(btoa\(new Date\(\)\.toISOString\(\)\.substring\(0, 10\)\)\)/);
  assert.match(updated,/refreshOfficialDaily\(\)/);
  assert.match(fs.readFileSync(path.join(dir,'src/daily-cache.ts'),'utf8'),/localStorage.setItem/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('patch fails closed on unknown upstream source',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-'));
 try {fs.mkdirSync(path.join(dir,'src/phases'),{recursive:true});fs.writeFileSync(path.join(dir,'src/phases/title-phase.ts'),'unexpected');
 const run=spawnSync(process.execPath,[patch],{cwd:dir,encoding:'utf8'});assert.notEqual(run.status,0);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('release workflow checks compiled daily features before distributing updates', () => {
 const workflow = fs.readFileSync(new URL('../.github/workflows/build.yml', import.meta.url), 'utf8');
 assert.equal((workflow.match(/node (?:\.\.\/)?wrapper\/scripts\/verify-daily-bundle\.mjs/g) || []).length, 2);
});

test('compiled daily verifier rejects missing offline daily from game ZIP', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-zip-'));
 try {
  fs.mkdirSync(path.join(dir,'assets'));
  fs.writeFileSync(path.join(dir,'assets','main.js'), 'console.log("Official Online Daily", "daily/seed")');
  const zip=path.join(dir,'game.zip');
  const packed=spawnSync('zip',['-q',zip,'assets/main.js'],{cwd:dir,encoding:'utf8'});
  assert.equal(packed.status,0,packed.stderr);
  const verifier=new URL('../scripts/verify-daily-bundle.mjs',import.meta.url).pathname;
  const checked=spawnSync(process.execPath,[verifier,zip],{encoding:'utf8'});
  assert.notEqual(checked.status,0);
  assert.match(checked.stderr,/Daily protection failed/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('compiled daily verifier accepts a game ZIP containing both daily implementations', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-zip-ok-'));
 try {
  fs.mkdirSync(path.join(dir,'assets'));
  fs.writeFileSync(path.join(dir,'assets','main.js'), 'function daily(){return "Offline Daily"+"Official Online Daily"+new Date().toISOString().substring(0,10)+"daily/seed"+"zenni.pokevoid.officialDaily.v1"+"Daily Run: enter 1 for Offline Daily or 2 for Official Online Daily"+"Official daily unavailable online and no current-day cached seed exists"}');
  const zip=path.join(dir,'game.zip');
  assert.equal(spawnSync('zip',['-q',zip,'assets/main.js'],{cwd:dir}).status,0);
  const verifier=new URL('../scripts/verify-daily-bundle.mjs',import.meta.url).pathname;
  const checked=spawnSync(process.execPath,[verifier,zip],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('daily selection has a real cancellation path and does not confuse cancel with online', () => {
 const patchSource = fs.readFileSync(new URL('../patches/offline-daily.mjs', import.meta.url), 'utf8');
 assert.match(patchSource, /dailyChoice === null/);
 assert.match(patchSource, /dailyChoice !== "1" && dailyChoice !== "2"/);
 assert.match(patchSource, /dailyChoice === "1"/);
 assert.doesNotMatch(patchSource, /window\.confirm/);
});


test('Android boot imports daily sync function before invoking it', () => {
 const source = fs.readFileSync(new URL('../patches/apply.mjs', import.meta.url), 'utf8');
 assert.match(source, /import \{ startOfficialDailySync \} from/);
 assert.match(source, /startOfficialDailySync\(\)/);
 assert.match(source, /Android daily sync startup hook missing/);
});


test('official daily sync retries without trusting navigator.onLine and preserves offline mode', () => {
 const cache = fs.readFileSync(new URL('../patches/daily-cache.ts', import.meta.url), 'utf8');
 const daily = fs.readFileSync(new URL('../patches/offline-daily.mjs', import.meta.url), 'utf8');
 assert.match(cache, /window\.setInterval\(/);
 assert.doesNotMatch(cache, /if \(navigator\.onLine\)/);
 assert.match(cache, /if \(utcDay\(\) !== day\)/);
 assert.match(daily, /if \(dailyChoice === "1"\)/);
 assert.match(daily, /generateDaily\(btoa\(new Date\(\)\.toISOString\(\)\.substring\(0, 10\)\)\)/);
});

test('official daily fetch has a bounded wait so hung requests do not lock future refreshes', () => {
 const cache = fs.readFileSync(new URL('../patches/daily-cache.ts', import.meta.url), 'utf8');
 assert.match(cache, /DAILY_REQUEST_TIMEOUT_MS = 8_000/);
 assert.match(cache, /window\.setTimeout\(\(\) => finish\(null\), DAILY_REQUEST_TIMEOUT_MS\)/);
 assert.match(cache, /const seed = await timedOfficialSeed\(\)/);
 assert.match(cache, /\.finally\(\(\) => \{ pending = undefined; \}\)/);
});

test('compiled daily verifier rejects bundles with labels but no daily selection path', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-labels-'));
 try {
  fs.mkdirSync(path.join(dir,'assets'));
  fs.writeFileSync(path.join(dir,'assets/main.js'), '"Offline Daily"+"Official Online Daily"+"daily/seed"+"zenni.pokevoid.officialDaily.v1"+new Date().toISOString().substring(0,10)');
  const zip=path.join(dir,'game.zip');
  assert.equal(spawnSync('zip',['-q',zip,'assets/main.js'],{cwd:dir}).status,0);
  const result=spawnSync(process.execPath,[new URL('../scripts/verify-daily-bundle.mjs',import.meta.url).pathname,zip],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/nativeSelection=false/);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('compiled daily verifier finds Vite JavaScript chunks in nested asset folders', () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'daily-nested-'));
 try {
  fs.mkdirSync(path.join(dir,'assets','chunks'),{recursive:true});
  fs.writeFileSync(path.join(dir,'assets','chunks','daily.js'), 'function daily(){return "Offline Daily"+"Official Online Daily"+new Date().toISOString().substring(0,10)+"daily/seed"+"zenni.pokevoid.officialDaily.v1"+"Daily Run: enter 1 for Offline Daily or 2 for Official Online Daily"+"Official daily unavailable online and no current-day cached seed exists"}');
  const zip=path.join(dir,'game.zip');
  assert.equal(spawnSync('zip',['-q',zip,'assets/chunks/daily.js'],{cwd:dir}).status,0);
  const checked=spawnSync(process.execPath,[new URL('../scripts/verify-daily-bundle.mjs',import.meta.url).pathname,zip],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stderr);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});


test('Android daily selection uses the imported Capacitor API, not an optional global bridge', () => {
 const patch = fs.readFileSync(new URL('../patches/offline-daily.mjs', import.meta.url), 'utf8');
 assert.match(patch, /import \{ Capacitor \} from \"@capacitor\/core\"/);
 assert.match(patch, /Capacitor\.isNativePlatform\(\)/);
 assert.doesNotMatch(patch, /window as any\)\.Capacitor/);
});


test('official daily cache rejects malformed server responses instead of persisting them', () => {
 const cache = fs.readFileSync(new URL('../patches/daily-cache.ts', import.meta.url), 'utf8');
 assert.match(cache, /\^\[A-Za-z0-9\+\/_=-\]\{1,256\}\$/);
 assert.match(cache, /return cachedOfficialDaily\(\)/);
});
