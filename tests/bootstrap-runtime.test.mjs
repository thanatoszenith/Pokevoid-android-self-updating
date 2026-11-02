import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const checksum = 'a'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture({pending=true,failed=false,openFails=false}={}) {
  const calls=[];
  const values=new Map(pending?[['pokevoid_pending_bootstrap_download',JSON.stringify({version:'2',checksum})]]:[]);
  const localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const element=()=>({textContent:'',disabled:false,hidden:true,style:{},removeAttribute(){},value:0});
  const elements=new Map();
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,body:{append(){}}};
  const ExternalGame={
    recover:async()=>({installed:false}),status:async()=>({failedChecksum:failed?checksum:''}),
    stage:async()=>calls.push('stage'),activate:async()=>calls.push('activate'),
    open:async()=>{calls.push('open');if(openFails)throw new Error('host unavailable');},
    abortLaunch:async()=>calls.push('abort'),
  };
  const source=fs.readFileSync('bootstrap/main.ts','utf8').replace(/^import .*;$/gm,'').replace("'__POKEVOID_UPDATE_FEED__'","'https://owner.github.io/repo/capacitor-update.json'");
  const context=vm.createContext({console,URL,document,localStorage,Date,ExternalGame,Capacitor:{isNativePlatform:()=>true},
    SharedStorage:{status:async()=>({granted:true}),createFolders:async()=>{}},
    clearNativeAssetCaches:async()=>{},configureSharedStorage:async()=>{},
    readUpdateFeed:async()=>({version:'2',checksum,url:'https://github.com/owner/repo/releases/download/game-feed/pokevoid-game-2.zip',features:['offline-daily-v1','official-daily-cache-v1','external-game-v1']}),
    ResumableDownload:{addListener:async()=>({remove:async()=>{}}),download:async()=>calls.push('download'),releaseArchive:async()=>calls.push('release')},
  });
  vm.runInContext(stripTypeScriptTypes(source),context);
  await tick();
  return {calls,values,elements,click:async()=>{elements.get('install').onclick();await tick();}};
}
test('interrupted bootstrap download resumes inside the existing startup lock',async()=>{
  const x=await fixture();
  assert.deepEqual(x.calls,['download','stage','release','activate','open']);
  assert.equal(x.values.has('pokevoid_pending_bootstrap_download'),false);
});
test('a failed installation cannot enter an automatic download loop; explicit retry still works',async()=>{
  const x=await fixture({failed:true});
  assert.deepEqual(x.calls,[]);assert.equal(x.values.size,0);
  await x.click();assert.equal(x.calls[0],'download');
});
test('failed host switching invokes rollback after promotion',async()=>{
  const x=await fixture({openFails:true});
  assert.equal(x.calls.at(-1),'abort');
  assert.equal(x.calls.filter(call=>call==='activate').length,1);
});
test('a fresh installation waits for a user download action',async()=>{
  const x=await fixture({pending:false});assert.deepEqual(x.calls,[]);
  await x.click();assert.equal(x.calls[0],'download');
});
