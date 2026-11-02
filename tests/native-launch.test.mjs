import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { stripTypeScriptTypes } from 'node:module';
test('title readiness, rather than page or scene creation, confirms the captured launch ID',async()=>{
  const calls=[]; let id='original';
  const context=vm.createContext({console,ExternalGame:{status:async()=>({launchId:id}),confirmLaunch:async value=>calls.push(value)}});
  vm.runInContext(stripTypeScriptTypes(fs.readFileSync('patches/native-launch.ts','utf8').replace(/^import .*;$/m,'').replace('export ','')),context);
  const game={events:new EventEmitter()};context.game=game;
  vm.runInContext('armNativeLaunch(game)',context);
  game.events.emit('ready'); game.events.emit('create'); await Promise.resolve();
  assert.equal(calls.length,0);
  id='newer'; game.events.emit('pokevoid-native-ready'); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,1);assert.equal(calls[0].launchId,'original');
  game.events.emit('pokevoid-native-ready'); await Promise.resolve();assert.equal(calls.length,1);
});
