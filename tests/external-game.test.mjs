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
  for (const marker of ['setServerBasePath(base)', 'setServerAssetPath("public")', 'WebSettings.LOAD_NO_CACHE', '180000', 'launchId.equals', 'storage().recover()', 'storage().confirm()']) assert.ok(source.includes(marker), marker);
  const ready = fs.readFileSync('patches/native-launch.ts','utf8');
  assert.ok(ready.includes("battle.events.once('create'"));
});
test('build copies every native class and does not install the private updater', () => {
  const workflow = fs.readFileSync('.github/workflows/build.yml','utf8');
  assert.ok(workflow.includes('../wrapper/native/*.java'));
  assert.ok(workflow.includes('pnpm remove @capgo/capacitor-updater'));
  assert.ok(workflow.includes('registerPlugin(ExternalGamePlugin.class)'));
  assert.doesNotMatch(workflow, /permission+'\\\\n/);
});
