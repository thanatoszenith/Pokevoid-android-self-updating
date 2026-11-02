import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const native = fs.readFileSync('native/ResumableDownloadPlugin.java', 'utf8');
const workflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');
const patcher = fs.readFileSync('patches/apply.mjs', 'utf8');
const bootstrap = fs.readFileSync('bootstrap/main.ts', 'utf8');
const gate = fs.readFileSync('patches/update-gate.ts', 'utf8');





test('Android build registers the plugin and bundles both TypeScript shims', () => {
  assert.match(workflow, /registerPlugin\(ResumableDownloadPlugin\.class\)/);
  assert.match(workflow, /ResumableDownloadPlugin\.java/);
  assert.match(patcher, /resumable-download\.ts/);
  assert.ok(fs.existsSync('bootstrap/resumable-download.ts'));
  assert.ok(fs.existsSync('patches/resumable-download.ts'));
});



test('build patches the generated activity rather than introducing a duplicate', () => {
  assert.match(workflow, /rglob\('MainActivity\.java'\)/);
  assert.doesNotMatch(workflow, /cat > android\/app\/src\/main\/java\/com\/zenni\/pokevoid\/MainActivity\.java/);
});



test('publication validates public ZIP before deploying the update feed', () => {
  const publish = fs.readFileSync('.github/workflows/publish-game.yml', 'utf8');
  const zipCheck = publish.indexOf('Verify release ZIP is publicly downloadable');
  const feedDeployment = publish.indexOf('Prepare Pages update manifest');
  assert.ok(zipCheck >= 0 && feedDeployment > zipCheck);
  assert.match(publish, /curl --head --fail --location/);
});



test('bootstrap does not make redundant cross-origin HEAD requests', () => {
  assert.doesNotMatch(bootstrap, /fetchBundleSize\(/);
});

test('bootstrap retry reuses the interrupted download action directly', () => {
  assert.match(bootstrap, /const install = async \(\) => \{/);
  assert.match(bootstrap, /retry\('Retry download', install\)/);
  assert.doesNotMatch(bootstrap, /retry\('Retry download', async \(\) => \{ await main\(\); \}\)/);
});



test('network failures retain partial downloads for subsequent HTTP Range retries', () => {
  assert.match(native, /Download interrupted after retries; partial data preserved/);
  assert.match(native, /offset = partial\.exists\(\) \? partial\.length\(\) : 0/);
  assert.match(native, /if \(c != null\) c\.disconnect\(\)/);
  assert.match(native, /Response exceeded advertised size/);
  assert.match(native, /responseEnd = end/);
  assert.match(native, /Response exceeded declared Content-Range/);
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









test('resumable response validates offsets without requiring an entire suffix', () => {
  assert.match(native, /end < offset \|\| declaredTotal <= end/);
  assert.doesNotMatch(native, /end != declaredTotal - 1/);
  assert.match(native, /if \(total >= 0 && done != total\)/);
});

test('foreground notification shows byte progress even when WebView is backgrounded', () => {
  const service = fs.readFileSync('native/DownloadForegroundService.java', 'utf8');
  assert.match(service, /static synchronized void updateProgress\(Context context, long downloaded, long total\)/);
  assert.match(service, /setProgress\(100, percent, false\)/);
  assert.match(service, /manager\.notify\(NOTIFICATION_ID/);
  assert.match(native, /DownloadForegroundService\.updateProgress\(getContext\(\), downloaded, total\)/);
});

test('bounded HTTP 206 segments continue downloading until the full archive is assembled', () => {
  assert.match(native, /responseEnd = end/);
  assert.match(native, /done != responseEnd \+ 1/);
  assert.match(native, /offset = done;\s*if \(\+\+successfulSegments > 8192\) throw new IOException\("Too many bounded range responses"\);[\s\S]*?attempt--;\s*continue;/);
});

test('bootstrap resumes a previously initiated download after process restart', () => {
  assert.match(bootstrap, /pokevoid_pending_bootstrap_download/);
  assert.match(bootstrap, /localStorage\.setItem\(RESUME_KEY/);
  assert.match(bootstrap, /pending\?\.version === latest\.version && pending\?\.checksum === latest\.checksum/);
  assert.ok(bootstrap.includes("await install();"));
  assert.match(bootstrap, /localStorage\.removeItem\(RESUME_KEY\)/);
});

test('previously approved interrupted game updates resume on the next launch', () => {
  assert.match(gate, /pokevoid_pending_update/);
  assert.match(gate, /pending\?\.version === release\.version && pending\?\.checksum === release\.checksum/);
  assert.match(gate, /if \(!resume && !window\.confirm/);
  assert.match(gate, /localStorage\.setItem\(RESUME_KEY/);
  assert.match(gate, /localStorage\.removeItem\(RESUME_KEY\)/);
});

test('background progress notifications are throttled and permission failures are nonfatal', () => {
  const service = fs.readFileSync('native/DownloadForegroundService.java', 'utf8');
  assert.match(service, /SystemClock\.elapsedRealtime\(\)/);
  assert.match(service, /now - lastNotificationMs < 1000L/);
  assert.match(service, /catch \(SecurityException error\)/);

});

test('background downloads retain CPU access with bounded renewable wake lock', () => {
  const service = fs.readFileSync('native/DownloadForegroundService.java', 'utf8');
  assert.match(workflow, /android\.permission\.WAKE_LOCK/);
  assert.match(service, /PowerManager\.PARTIAL_WAKE_LOCK/);
  assert.match(service, /WAKE_LOCK_TIMEOUT_MS/);
  assert.match(service, /refreshWakeLock\(now\)/);
  assert.match(service, /downloadWakeLock\.release\(\)/);
  assert.match(service, /START_NOT_STICKY/);
});

test('HTTP resume rejects truncated full responses and range overruns', () => {
  assert.match(native, /Response exceeded declared Content-Range/);
  assert.match(native, /Incomplete full HTTP response/);
  assert.match(native, /Too many bounded range responses/);
  assert.match(native, /if \(code == 416 && offset > 0\)/);
});



test('foreground service stays alive until all queued download requests finish', () => {
  assert.match(native, /AtomicInteger activeDownloads/);
  assert.match(native, /activeDownloads\.incrementAndGet\(\)/);
  assert.match(native, /activeDownloads\.decrementAndGet\(\) == 0/);
});

test('repeated HTTP 416 responses cannot cause an endless retry loop', () => {
  assert.match(native, /boolean rangeReset = false/);
  assert.match(native, /if \(rangeReset\) throw new IOException\("Server repeatedly rejected resume range"\)/);
});
test('executor rejection releases foreground download accounting', () => {
  assert.match(native, /catch \(RejectedExecutionException error\)/);
  assert.match(native, /call\.reject\("Download queue unavailable", error\)/);
});

test('network retry hashing skips known-short archives and reuses verified complete partials',()=>{
  assert.ok(native.includes('DownloadCache.mayBeComplete(offset, expectedTotal)'));
  assert.ok(native.includes('!fetch(source, partial, key) && !matches(partial, key)'));
});
