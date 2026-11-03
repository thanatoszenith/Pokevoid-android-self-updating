import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const checksum = 'a'.repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture({pending=true,failed=false,openFails=false,granted=true,grantOnRequest=true,externalFeature=true,installed=false,cacheHangs=false}={}) {
  const calls=[];
  let storageGranted=granted, accessRequests=0, addedButtons=0;
  const nativeListeners=new Map();
  const values=new Map(pending?[['pokevoid_pending_bootstrap_download',JSON.stringify({version:'2',checksum})]]:[]);
  const localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const element=()=>({textContent:'',disabled:false,hidden:true,style:{},removeAttribute(){},value:0});
  const elements=new Map();
  const document={hidden:false,addEventListener(){},getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,body:{append(){addedButtons++;}}};
  const ExternalGame={
    recover:async()=>({installed}),status:async()=>({failedChecksum:failed?checksum:''}),
    stage:async()=>calls.push('stage'),activate:async()=>calls.push('activate'),
    open:async()=>{calls.push('open');if(openFails)throw new Error('host unavailable');},
    abortLaunch:async()=>calls.push('abort'),
  };
  const source=fs.readFileSync('bootstrap/main.ts','utf8').replace(/^import .*;$/gm,'').replace("'__POKEVOID_UPDATE_FEED__'","'https://owner.github.io/repo/capacitor-update.json'");
  const context=vm.createContext({console,URL,document,localStorage,Date,setTimeout,clearTimeout,ExternalGame,window:{addEventListener(){}},Capacitor:{isNativePlatform:()=>true},
    SharedStorage:{
      status:async()=>({granted:storageGranted}),createFolders:async()=>{},
      requestAccess:async()=>{accessRequests++;storageGranted=grantOnRequest;return {granted:storageGranted};},
      addListener:async(name,callback)=>{nativeListeners.set(name,callback);return {remove:async()=>{}};}
    },
    clearNativeAssetCaches:async()=>cacheHangs?new Promise(()=>{}):undefined,configureSharedStorage:async()=>{},
    readUpdateFeed:async()=>({version:'2',checksum,url:'https://github.com/owner/repo/releases/download/game-feed/pokevoid-game-2.zip',features:['offline-daily-v1','official-daily-cache-v1',...(externalFeature?['external-game-v1']:[])]}),
    ResumableDownload:{addListener:async()=>({remove:async()=>{}}),download:async()=>calls.push('download'),releaseArchive:async()=>calls.push('release')},
  });
  vm.runInContext(stripTypeScriptTypes(source),context);
  await tick();
  return {calls,values,elements,accessRequests:()=>accessRequests,addedButtons:()=>addedButtons,resumeAccess:async()=>{storageGranted=true;nativeListeners.get('accessChanged')?.({granted:true});await tick();},click:async()=>{elements.get('install').onclick();await tick();}};
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

test('first launch opens Android access settings automatically and continues after the grant',async()=>{
  const x=await fixture({pending:false,granted:false});
  assert.equal(x.accessRequests(),1);
  assert.equal(x.addedButtons(),0);
  assert.equal(x.elements.get('install').hidden,false);
  await x.click();assert.equal(x.calls[0],'download');
});
test('denied access neither shows an access button nor repeatedly reopens settings; resume continues automatically',async()=>{
  const x=await fixture({pending:false,granted:false,grantOnRequest:false});
  assert.equal(x.accessRequests(),1);assert.equal(x.addedButtons(),0);
  assert.equal(x.elements.get('install').hidden,true);assert.deepEqual(x.calls,[]);
  await x.resumeAccess();
  assert.equal(x.accessRequests(),1);assert.equal(x.elements.get('install').hidden,false);
  await x.click();assert.equal(x.calls[0],'download');
});
test('the currently published legacy feed is diagnosed as outdated rather than a connection failure',async()=>{
  const x=await fixture({pending:false,externalFeature:false});
  assert.match(x.elements.get('status').textContent,/published game download is outdated/);
  assert.deepEqual(x.calls,[]);
});

test('an already-installed game reopens without waiting for a hung browser cache cleanup', async () => {
  const x = await fixture({ pending: false, installed: true, cacheHangs: true });
  assert.deepEqual(x.calls, ['open']);
  assert.match(x.elements.get('status').textContent, /Opening external game/);
  assert.equal(x.elements.get('install').disabled, true);
});

test('startup reports its current phase instead of leaving the initial download placeholder', async () => {
  const x = await fixture({ pending: false, installed: true });
  assert.notEqual(x.elements.get('status').textContent, 'Checking for game download…');
});
