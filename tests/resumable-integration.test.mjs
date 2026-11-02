import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync('native/ResumableDownloadPlugin.java', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');
const patcher = fs.readFileSync('patches/apply.mjs', 'utf8');
const bootstrap = fs.readFileSync('bootstrap/main.ts', 'utf8');
const gate = fs.readFileSync('patches/update-gate.ts', 'utf8');

test('both entrypoints use the resumable downloader before Capgo installation', () => {
  for (const source of [bootstrap, gate]) {
    assert.match(source, /ResumableDownload\.download\(/);
    assert.match(source, /CapacitorUpdater\.download\(\{\s*url: archive\.url/);
    assert.match(source, /ResumableDownload\.addListener\('progress'/);
  }
});

test('native bridge retains partial files and verifies archives before serving', () => {
  assert.match(native, /getFilesDir\(\)/);
  assert.match(native, /\.part/);
  assert.match(native, /setRequestProperty\("Range"/);
  assert.match(native, /Content-Range/);
  assert.match(native, /matches\(partial, key\)/);
  assert.match(native, /127\.0\.0\.1/);
});

test('Android build registers the plugin and bundles both TypeScript shims', () => {
  assert.match(workflow, /registerPlugin\(ResumableDownloadPlugin\.class\)/);
  assert.match(workflow, /ResumableDownloadPlugin\.java/);
  assert.match(patcher, /resumable-download\.ts/);
  assert.ok(fs.existsSync('bootstrap/resumable-download.ts'));
  assert.ok(fs.existsSync('patches/resumable-download.ts'));
});

test('resumed responses validate byte ranges and archive cleanup happens only after import', () => {
  assert.match(native, /declaredTotal = Long\.parseLong/);
  assert.match(native, /Inconsistent Content-Range and Content-Length/);
  for (const source of [bootstrap, gate]) {
    const imported = source.indexOf('CapacitorUpdater.download({');
    const released = source.indexOf('ResumableDownload.releaseArchive(');
    assert.ok(imported >= 0 && released > imported, 'archive cannot be deleted before import');
  }
});

test('build patches the generated activity rather than introducing a duplicate', () => {
  assert.match(workflow, /rglob\('MainActivity\.java'\)/);
  assert.doesNotMatch(workflow, /cat > android\/app\/src\/main\/java\/com\/zenni\/pokevoid\/MainActivity\.java/);
});

test('successful bundles remain recoverable when Capgo omits checksum metadata', () => {
  for (const source of [bootstrap, gate]) {
    assert.match(source, /bundle\.status === 'success'/);
    assert.match(source, /!\(bundle as typeof bundle & \{ checksum\?: string \}\)\.checksum/);
  }
});

test('publication validates public ZIP before deploying the update feed', () => {
  const publish = fs.readFileSync('.github/workflows/publish-game.yml', 'utf8');
  const zipCheck = publish.indexOf('Verify release ZIP is publicly downloadable');
  const feedDeployment = publish.indexOf('Prepare Pages update manifest');
  assert.ok(zipCheck >= 0 && feedDeployment > zipCheck);
  assert.match(publish, /curl --head --fail --location/);
});

test('loopback ZIP server rejects invalid ranges and caps request headers', () => {
  assert.match(native, /416 Range Not Satisfiable/);
  assert.match(native, /headerCount > 64/);
  assert.match(native, /start >= file\.length\(\)/);
});

test('bootstrap does not make redundant cross-origin HEAD requests', () => {
  assert.doesNotMatch(bootstrap, /fetchBundleSize\(/);
});

test('bootstrap retry reuses the interrupted download action directly', () => {
  assert.match(bootstrap, /const install = async \(\) => \{/);
  assert.match(bootstrap, /retry\('Retry download', install\)/);
  assert.doesNotMatch(bootstrap, /retry\('Retry download', async \(\) => \{ await main\(\); \}\)/);
});

test('HTTP 416 response uses CRLF escapes, not escaped backslash characters', () => {
  const line = native.split('\n').find(x => x.includes('416 Range Not Satisfiable'));
  assert.ok(line);
  assert.ok(line.includes(String.raw`\r\nContent-Range`));
  assert.ok(!line.includes(String.raw`\\r\\nContent-Range`));
});

test('network failures retain partial downloads for subsequent HTTP Range retries', () => {
  assert.match(native, /Download interrupted after retries; partial data preserved/);
  assert.match(native, /offset = partial\.exists\(\) \? partial\.length\(\) : 0/);
  assert.match(native, /if \(c != null\) c\.disconnect\(\)/);
  assert.match(native, /Response exceeded advertised size/);
  assert.match(native, /end != declaredTotal - 1/);
});

test('oversized HTTP range integers do not terminate the loopback response silently', () => {
  assert.match(native, /catch \(NumberFormatException invalidRange\)/);
  assert.match(native, /start = file\.length\(\)/);
  assert.match(native, /416 Range Not Satisfiable/);
});

test('game update progress listener cleanup cannot invalidate a successful import', () => {
  assert.match(gate, /listener\.remove\(\)\.catch\(/);
});

test('both download interfaces report measured speed, percent, remaining bytes and ETA', () => {
  assert.match(bootstrap, /percent\.toFixed\(1\)/);
  assert.match(bootstrap, /lastTotal - done/);
  assert.match(bootstrap, /remaining \/ smoothedSpeed/);
  assert.match(bootstrap, /showProgress\(event\.downloaded, event\.total\)/);
  assert.match(gate, /percent\.toFixed\(1\)/);
  assert.match(gate, /total - downloaded/);
  assert.match(gate, /remaining \/ speed/);
  assert.match(gate, /report\(downloaded, total\)/);
});

test('native progress reports resume offsets and verified cached archives immediately', () => {
  assert.match(native, /sendProgress\(offset, -1\)/);
  assert.match(native, /sendProgress\(done, total\)/);
  assert.match(native, /if \(verifiedComplete\) sendProgress\(complete\.length\(\), complete\.length\(\)\)/);
});

test('cached ZIP verification is reused rather than hashing the same large archive twice', () => {
  assert.match(native, /boolean verifiedComplete = complete\.exists\(\) && matches\(complete, key\)/);
  assert.match(native, /if \(!verifiedComplete\)/);
  assert.doesNotMatch(native, /if \(!complete\.exists\(\) \|\| !matches\(complete, key\)\)/);
});

test('native downloader checks each HTTPS redirect and limits redirect hops', () => {
  assert.match(native, /setInstanceFollowRedirects\(false\)/);
  assert.match(native, /for \(int hop = 0; hop <= 8; hop\+\+\)/);
  assert.match(native, /Non-HTTPS or credential-bearing redirect refused/);
  assert.match(native, /if \(!returned\) connection\.disconnect\(\)/);
});

test('loopback server uses bounded workers instead of spawning threads for every client', () => {
  assert.match(native, /new ThreadPoolExecutor\(2, 4, 30L, TimeUnit\.SECONDS, new ArrayBlockingQueue<Runnable>\(8\)\)/);
  assert.match(native, /clients\.execute\(/);
  assert.match(native, /catch \(RejectedExecutionException busy\)/);
  assert.doesNotMatch(native, /"pokevoid-archive-client"\)\.start\(\)/);
});

test('background downloads use an Android dataSync foreground service', () => {
  const service = fs.readFileSync('native/DownloadForegroundService.java', 'utf8');
  assert.match(service, /startForeground\(NOTIFICATION_ID/);
  assert.match(service, /FOREGROUND_SERVICE_TYPE_DATA_SYNC/);
  assert.match(service, /START_NOT_STICKY/);
  assert.match(native, /ContextCompat\.startForegroundService/);
  assert.match(native, /stopService\(new Intent\(getContext\(\), DownloadForegroundService\.class\)\)/);
  assert.match(workflow, /FOREGROUND_SERVICE_DATA_SYNC/);
  assert.match(workflow, /foregroundServiceType="dataSync"/);
  assert.match(workflow, /DownloadForegroundService\.java/);
});

test('HTTP headers are configured only before the redirect connection is established', () => {
  assert.match(native, /c = openVerifiedConnection\(url, offset\);\s*int code = c\.getResponseCode\(\)/);
  assert.doesNotMatch(native, /c = openVerifiedConnection\(url, offset\);\s*c\.setRequestProperty/);
});

test('loopback HTTP parser limits line lengths before buffering and cleanup tracks archive identity', () => {
  assert.match(native, /private String readLimitedLine\(BufferedReader reader\)/);
  assert.match(native, /reader\.read\(\)/);
  assert.match(native, /while \(\(line = readLimitedLine\(reader\)\)/);
  assert.match(native, /sha\.equalsIgnoreCase\(servedChecksum\)/);
});

test('root-level PokeVoid storage is explicitly permission-gated and preserves working files', () => {
  const shared = fs.readFileSync('native/SharedStoragePlugin.java', 'utf8');
  const bridge = fs.readFileSync('patches/shared-storage.ts', 'utf8');
  const apply = fs.readFileSync('patches/apply.mjs', 'utf8');
  assert.match(shared, /Environment\.isExternalStorageManager\(\)/);
  assert.match(shared, /ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION/);
  assert.match(shared, /new File\(Environment\.getExternalStorageDirectory\(\), "PokeVoid"\)/);
  assert.match(shared, /"Game"/);
  assert.match(shared, /"Saves"/);
  assert.match(shared, /if \(dest\.exists\(\)\) return/);
  assert.match(native, /SharedStoragePlugin\.mirrorArchive\(complete, key\)/);
  assert.match(workflow, /registerPlugin\(SharedStoragePlugin\.class\)/);
  assert.match(workflow, /MANAGE_EXTERNAL_STORAGE/);
  assert.match(bridge, /configureSharedStorage/);
  assert.match(apply, /patches\/shared-storage\.ts/);
});

test('direct external saves migrate before game boot and persist writes atomically', () => {
  const direct = fs.readFileSync('patches/direct-saves.ts', 'utf8');
  const shared = fs.readFileSync('native/SharedStoragePlugin.java', 'utf8');
  assert.match(patcher, /await initializeDirectSaves\(\)/);
  assert.match(patcher, /patches\/direct-saves\.ts/);
  assert.match(direct, /await Native\.readSaves\(\)/);
  assert.match(direct, /if \(!external\.has\(entry\.key\)\) await Native\.writeSave\(entry\)/);
  assert.match(direct, /Storage\.prototype\.setItem/);
  assert.match(direct, /Storage\.prototype\.removeItem/);
  assert.match(direct, /pokevoid_pre_external_/);
  assert.match(shared, /File\.createTempFile/);
  assert.match(shared, /out\.getFD\(\)\.sync\(\)/);
  assert.match(shared, /readSaves\(PluginCall call\)/);
  assert.match(shared, /deleteSave\(PluginCall call\)/);
});

test('native HTTP request parser uses valid Java character escapes', () => {
  assert.match(native, /if \(c == '\\n'\)/);
  assert.match(native, /if \(c != '\\r'\)/);
  assert.doesNotMatch(native, /if \(c == '\\\\n'\)/);
  assert.doesNotMatch(native, /if \(c != '\\\\r'\)/);
});

test('resumable response validates offsets without requiring an entire suffix', () => {
  assert.match(native, /end < offset \|\| declaredTotal <= end/);
  assert.doesNotMatch(native, /end != declaredTotal - 1/);
  assert.match(native, /if \(total >= 0 && done != total\)/);
});

test('foreground notification shows byte progress even when WebView is backgrounded', () => {
  const service = fs.readFileSync('native/DownloadForegroundService.java', 'utf8');
  assert.match(service, /static void updateProgress\(Context context, long downloaded, long total\)/);
  assert.match(service, /setProgress\(100, percent, false\)/);
  assert.match(service, /manager\.notify\(NOTIFICATION_ID/);
  assert.match(native, /DownloadForegroundService\.updateProgress\(getContext\(\), downloaded, total\)/);
});
