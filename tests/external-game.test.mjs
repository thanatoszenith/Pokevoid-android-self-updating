import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('both installation flows stage, release the single archive, activate, then open externally', () => {
  for (const file of ['bootstrap/main.ts', 'patches/update-gate.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    const calls = ['ResumableDownload.download(', 'ExternalGame.stage(', 'ResumableDownload.releaseArchive(', 'ExternalGame.activate(', 'ExternalGame.open('];
    let previous = -1;
    for (const call of calls) {
      const index = source.indexOf(call, source.indexOf('ResumableDownload.download('));
      assert.ok(index > previous, file + ': ' + call); previous = index;
    }
    assert.doesNotMatch(source, /CapacitorUpdater/);
  }
});
test('WebView uses external HTTPS file hosting, a launch watchdog and scoped confirmation', () => {
  const source = fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  for (const marker of ['setServerBasePath(base.getPath())', 'setServerAssetPath("public")', 'WebSettings.LOAD_NO_CACHE', '180000', 'launchId.equals', 'storage().recover()', 'storage().confirm()']) assert.ok(source.includes(marker), marker);
  const ready = fs.readFileSync('patches/native-launch.ts','utf8');
  assert.ok(ready.includes("game.events.once('pokevoid-native-ready'"));
  assert.ok(fs.readFileSync('patches/apply.mjs','utf8').includes('signalTitleComposed(): void {'));
});
test('build copies every native class and does not install the private updater', () => {
  const workflow = fs.readFileSync('.github/workflows/build.yml','utf8');
  assert.ok(workflow.includes('../wrapper/native/*.java'));
  assert.ok(workflow.includes("! grep -Rq 'capacitor-updater'"));
  assert.ok(workflow.includes('registerPlugin(ExternalGamePlugin.class)'));
  assert.doesNotMatch(workflow, /permission+'\\\\n/);
});

test('native save transport is frame-origin checked and does not expose a raw JavaScript interface',()=>{
  const loader=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  const chrome=fs.readFileSync('native/NativeSaveChromeClient.java','utf8');
  const direct=fs.readFileSync('native/DirectSaveBridge.java','utf8');
  assert.doesNotMatch(loader,/addJavascriptInterface/);assert.doesNotMatch(direct,/@JavascriptInterface/);
  assert.ok(chrome.includes('TrustedGameOrigin.accepts(url)'));
  assert.ok(chrome.includes('NativeSaveQueue.execute('));assert.ok(chrome.includes('result.confirm(error)'));
  const workflow=fs.readFileSync('.github/workflows/build.yml','utf8');
  assert.ok(workflow.indexOf('super.onCreate(savedInstanceState)')<workflow.indexOf('saveClient = new NativeSaveChromeClient'));
  assert.ok(workflow.includes('saveClient.close()'));
});
test('all launches have a readiness timeout and reuse the validated base directory for asset requests',()=>{
  const loader=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  assert.ok(loader.includes('waiting = true'));
  assert.ok(loader.includes('if (waiting) rollback()'));
  assert.ok(loader.includes('File base = activeBase'));
});

test('save compatibility is injected before either old or new game scripts run',()=>{
  const loader=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  assert.ok(loader.includes('getBridge().injectScriptBeforeLoad("save-compat.js")'));
});

test('activity recreation shares installer queues and cleanup protects in-use archives',()=>{
  const loader=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  const downloader=fs.readFileSync('native/ResumableDownloadPlugin.java','utf8');
  assert.ok(loader.includes('static final ExecutorService worker'));
  assert.ok(loader.includes('if (!destroyed) action.run()'));
  assert.ok(loader.includes('DownloadCache.hold(archive)'));
  assert.ok(downloader.includes('static final AtomicInteger activeDownloads'));
  assert.doesNotMatch(loader,/worker.shutdown/);assert.doesNotMatch(downloader,/executor.shutdown/);
});

test('save snapshots and migrations share the same queue as prompt writes across activity recreation',()=>{
  const chrome=fs.readFileSync('native/NativeSaveChromeClient.java','utf8');
  const shared=fs.readFileSync('native/SharedStoragePlugin.java','utf8');
  assert.ok(chrome.includes('NativeSaveQueue.execute('));
  assert.equal((shared.match(/NativeSaveQueue.execute/g)||[]).length,3);
});

test('startup cleans orphaned save transactions on the shared writer queue',()=>{
  const shared=fs.readFileSync('native/SharedStoragePlugin.java','utf8');
  assert.ok(shared.includes('NativeSaveQueue.cleanTemporarySaves(dir)'));
  assert.ok(shared.indexOf('NativeSaveQueue.execute')<shared.indexOf('NativeSaveQueue.cleanTemporarySaves'));
});

test('download and install paths use external archives exclusively',()=>{
  const downloader=fs.readFileSync('native/ResumableDownloadPlugin.java','utf8');
  const installer=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  assert.ok(downloader.includes('ExternalGamePaths.downloads()'));
  assert.doesNotMatch(downloader,/getFilesDir|resumable-bundles/);
  assert.ok(installer.includes('storage().downloads()'));
  assert.doesNotMatch(installer,/new File\(getContext\(\).getFilesDir/);
  assert.ok(installer.includes('DownloadCache.release(downloads, sha)'));
});
test('internal cleanup excludes profiles and runs even before a first external installation',()=>{
  const installer=fs.readFileSync('native/ExternalGamePlugin.java','utf8');
  const cleanup=fs.readFileSync('native/StorageMaintenance.java','utf8');
  assert.ok(installer.includes('worker.execute(this::cleanInternalStorage)'));
  assert.doesNotMatch(cleanup,/deleteAllData|app_webview/);
  assert.ok(installer.includes('handleOnPause()'));
  assert.ok((installer.match(/clearCache\(true\)/g)||[]).length>=4);
});
test('native HTTPS downloads do not use an internal response cache',()=>{
  const downloader=fs.readFileSync('native/ResumableDownloadPlugin.java','utf8');
  assert.ok(downloader.includes('connection.setUseCaches(false)'));
});
