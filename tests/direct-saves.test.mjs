import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

async function fixture({entries = [], legacy = {}, fail = false, unavailable = false, legacyBridge = false} = {}) {
  class Storage {
    constructor() { this.items = new Map(); }
    get length() { return this.items.size; }
    key(i) { return [...this.items.keys()][i] ?? null; }
    getItem(k) { return this.items.get(String(k)) ?? null; }
    setItem(k,v) { this.items.set(String(k),String(v)); }
    removeItem(k) { this.items.delete(String(k)); }
    clear() { this.items.clear(); }
  }
  const localStorage = new Storage(), sessionStorage = new Storage();
  for (const [k,v] of Object.entries(legacy)) localStorage.setItem(k,v);
  const disk = new Map(entries.map(e=>[e.key,e.value]));
  let failWrite = fail;
  let reads = 0;
  const ctx = vm.createContext({Storage,localStorage, sessionStorage, DOMException, console,
    Capacitor: {isNativePlatform:()=>true},
    registerPlugin:()=>({status:async()=>({granted:true}), readSaves:async()=>{reads++;return {entries};}, writeSave:async({key,value})=>disk.set(key,value)}),
    window:{location:{origin:'https://localhost'},prompt:(message,payload)=>{
      assert.equal(message,'PokeVoidSaves/v1');
      if(unavailable)return null;
      const {operation,key,value}=JSON.parse(payload);
      if(operation==='status')return '';
      if(failWrite)return operation==='write'?'disk full':'access revoked';
      if(operation==='write')disk.set(key,value);
      else if(operation==='remove')disk.delete(key);
      else throw new Error('Unexpected command');
      return '';
    }}

  });
  if (legacyBridge) ctx.window.PokeVoidSaves = {
    write:(key,value)=>{disk.set(key,value);return '';},
    remove:key=>{disk.delete(key);return '';}
  };
  const source = fs.readFileSync('patches/direct-saves.ts','utf8').replace(/^import .*;$/m,'').replaceAll('export ','');
  vm.runInContext(fs.readFileSync('bootstrap/public/save-compat.js','utf8'),ctx);
  vm.runInContext(stripTypeScriptTypes(source),ctx);
  await vm.runInContext('initializeDirectSaves()',ctx);
  return {disk, localStorage, sessionStorage, setFailure:v=>{failWrite=v;}, reads:()=>reads, initialize:()=>vm.runInContext('initializeDirectSaves()',ctx)};
}
test('external saves win migration and game writes leave no internal disk copy',async()=>{
  const x=await fixture({entries:[{key:'data_slot',value:'external'}],legacy:{data_slot:'old',sessionData_1:'legacy',preference:'keep'}});
  assert.equal(x.localStorage.getItem('data_slot'),'external');
  assert.equal(x.localStorage.hasOwnProperty('data_slot'),true);
  assert.equal(x.disk.get('sessionData_1'),'legacy');
  assert.equal(x.localStorage.items.has('data_slot'),false);
  assert.equal(x.localStorage.items.has('sessionData_1'),false);
  x.localStorage.setItem('data_slot','new');
  assert.equal(x.disk.get('data_slot'),'new');
  assert.equal(x.localStorage.items.has('data_slot'),false);
  assert.equal(x.localStorage.length,4);
  assert.equal(x.disk.get('data_backup_pre_external_data_slot'),'old');
  x.sessionStorage.setItem('data_slot','session');
  assert.equal(x.disk.get('data_slot'),'new');
  assert.equal(x.localStorage.getItem('preference'),'keep');
});
test('failed synchronous write or delete throws before memory changes',async()=>{
  const x=await fixture({entries:[{key:'data_slot',value:'safe'}]});x.setFailure(true);
  assert.throws(()=>x.localStorage.setItem('data_slot','lost'),/disk full/);
  assert.equal(x.localStorage.getItem('data_slot'),'safe');
  assert.throws(()=>x.localStorage.removeItem('data_slot'),/access revoked/);
  assert.equal(x.disk.get('data_slot'),'safe');
});
test('remove and clear persist external deletion; session storage is independent',async()=>{
  const x=await fixture({entries:[{key:'data_slot',value:'x'},{key:'sessionData_1',value:'y'}],legacy:{preference:'keep'}});
  x.localStorage.removeItem('data_slot');assert.equal(x.disk.has('data_slot'),false);
  x.sessionStorage.setItem('data_slot','session');x.sessionStorage.clear();assert.equal(x.disk.size,1);
  x.localStorage.clear();assert.equal(x.disk.size,0);assert.equal(x.localStorage.length,0);
});

test('legacy internal recovery copies migrate externally before being removed',async()=>{
  const x=await fixture({legacy:{pokevoid_pre_external_data_slot:'recover'}});
  assert.equal(x.disk.get('data_backup_pre_external_data_slot'),'recover');
  assert.equal(x.localStorage.items.has('pokevoid_pre_external_data_slot'),false);
});

test('repeated initialization reuses one snapshot instead of stacking Storage hooks',async()=>{
  const x=await fixture({entries:[{key:'data_slot',value:'safe'}]});
  await Promise.all([x.initialize(),x.initialize()]);
  assert.equal(x.reads(),1);x.localStorage.setItem('data_slot','updated');
  assert.equal(x.disk.get('data_slot'),'updated');
});
test('missing native prompt transport fails before migrating or erasing legacy records',async()=>{
  await assert.rejects(()=>fixture({legacy:{data_slot:'safe'},unavailable:true}),/bridge unavailable/);
});

test('game updates remain compatible with an already-installed legacy APK',async()=>{
  const x=await fixture({legacyBridge:true,entries:[{key:'data_slot',value:'safe'}]});
  x.localStorage.setItem('data_slot','updated');assert.equal(x.disk.get('data_slot'),'updated');
});
test('compatibility shim never installs save access into an unrelated origin',()=>{
  let called=false;
  const context=vm.createContext({window:{location:{origin:'https://unrelated.example'},prompt:()=>{called=true;}}});
  vm.runInContext(fs.readFileSync('bootstrap/public/save-compat.js','utf8'),context);
  assert.equal(context.window.PokeVoidSaves,undefined);assert.equal(called,false);
});
