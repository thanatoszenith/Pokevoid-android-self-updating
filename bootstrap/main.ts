import { clearNativeAssetCaches } from './native-cache';
import { ResumableDownload } from './resumable-download';
import { configureSharedStorage } from './shared-storage';
import { readUpdateFeed } from './read-update-feed';
import { Capacitor } from '@capacitor/core';
import { ExternalGame } from './external-game';
import { SharedStorage } from './shared-storage';

const feed = '__POKEVOID_UPDATE_FEED__';
const RESUME_KEY = 'pokevoid_pending_bootstrap_download';
const status = document.getElementById('status')!;
const button = document.getElementById('install') as HTMLButtonElement;
const progressArea = document.getElementById('progress-area') as HTMLDivElement;
const progressBar = document.getElementById('download-progress') as HTMLProgressElement;
const progressDetails = document.getElementById('download-details') as HTMLDivElement;
let lastSampleTime = 0;
let lastSampleBytes = 0;
let smoothedSpeed = 0;
let lastTotal = 0;
const formatBytes = (bytes: number) => bytes >= 1073741824 ? `${(bytes / 1073741824).toFixed(2)} GiB` : `${(bytes / 1048576).toFixed(1)} MiB`;
function formatDuration(seconds: number): string {
  const n = Math.max(0, Math.ceil(seconds));
  return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
}
function resetProgress() {
  lastSampleTime = 0;
  lastSampleBytes = 0;
  smoothedSpeed = 0;
  lastTotal = 0;
  progressArea.hidden = false;
  progressBar.removeAttribute('value');
  progressDetails.textContent = 'Connecting…';
}
function showProgress(downloaded: number, total: number) {
  if (!Number.isFinite(downloaded) || downloaded < 0) return;
  const now = Date.now();
  const done = Math.max(0, downloaded);
  if (lastSampleTime && done < lastSampleBytes) {
    smoothedSpeed = 0;
    lastSampleTime = 0;
  }
  if (lastSampleTime && now - lastSampleTime >= 800) {
    const delta = done - lastSampleBytes;
    const instant = delta > 0 ? delta * 1000 / (now - lastSampleTime) : 0;
    smoothedSpeed = smoothedSpeed > 0 ? 0.3 * instant + 0.7 * smoothedSpeed : instant;
    lastSampleTime = now;
    lastSampleBytes = done;
  } else if (!lastSampleTime) {
    lastSampleTime = now;
    lastSampleBytes = done;
  }
  if (Number.isFinite(total) && total > 0) lastTotal = total;
  progressArea.hidden = false;
  if (lastTotal > 0) {
    const percent = Math.min(100, 100 * done / lastTotal);
    progressBar.value = percent;
    const remaining = Math.max(0, lastTotal - done);
    const eta = remaining === 0 ? 'Verifying…' : smoothedSpeed > 1024 ? `ETA ${formatDuration(remaining / smoothedSpeed)}` : 'ETA calculating…';
    progressDetails.textContent = `${percent.toFixed(1)}% • ${formatBytes(done)} / ${formatBytes(lastTotal)} • ${formatBytes(remaining)} left • ${smoothedSpeed > 1024 ? formatBytes(smoothedSpeed) + '/s' : 'Speed calculating…'} • ${eta}`;
  } else {
    progressBar.removeAttribute('value');
    progressDetails.textContent = `${formatBytes(done)} downloaded • Total unknown • ${smoothedSpeed > 1024 ? formatBytes(smoothedSpeed) + '/s' : 'Speed calculating…'}`;
  }
}
let busy = false;
async function exclusive(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  button.disabled = true;
  try { await action(); } catch (error) { console.error('Bootstrap action failed', error); status.textContent = 'An unexpected error occurred. Please retry.'; retry('Retry', main); } finally { busy = false; }
}
type Release = {version: string; url: string; checksum: string; features: string[]};
/** Only accept immutable ZIPs from the repository that owns our HTTPS update feed. */
function trustedGameAsset(feedUrl: string, assetUrl: string, version: string): boolean {
  try {
    const feed = new URL(feedUrl);
    const asset = new URL(assetUrl);
    const match = /^\/([A-Za-z0-9_.-]+)\/capacitor-update\.json$/.exec(feed.pathname);
    if (feed.protocol !== 'https:' || !match || !feed.hostname.endsWith('.github.io')) return false;
    const owner = feed.hostname.slice(0, -'.github.io'.length);
    if (!/^[A-Za-z0-9-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(match[1])) return false;
    const expected = `https://github.com/${owner}/${match[1]}/releases/download/game-feed/pokevoid-game-${version}.zip`;
    return asset.href === expected;
  } catch { return false; }
}

const valid = (v: unknown): v is Release => {
  if (!v || typeof v !== 'object') return false;
  const x = v as Partial<Release>;
  if (typeof x.version !== 'string' || !/^\d+(\.\d+)*$/.test(x.version) || x.version.split('.').some(n => !Number.isSafeInteger(Number(n)))) return false;
  if (typeof x.checksum !== 'string' || !/^[a-fA-F0-9]{64}$/.test(x.checksum)) return false;
  if (typeof x.url !== 'string') return false;
  if (!Array.isArray(x.features) || !x.features.includes('offline-daily-v1') || !x.features.includes('official-daily-cache-v1') || !x.features.includes('external-game-v1')) return false;
  return trustedGameAsset(feed, x.url, x.version);
};
function retry(label: string, action: () => Promise<void>) {
  button.textContent = label;
  button.disabled = false;
  button.onclick = () => { void exclusive(action); };
}
async function release(): Promise<Release> {
  const result = await readUpdateFeed(feed, 12000);
  if (!valid(result)) throw new Error('Invalid game release metadata');
  return result;
}
async function restoreInstalledGame(): Promise<boolean> {
  const state = await ExternalGame.recover();
  if (!state.installed) return false;
  if (state.loadFailed) {
    status.textContent = 'The installed game did not finish loading. Your saves are preserved.';
    retry('Reopen installed game', () => ExternalGame.open());
  } else {
    status.textContent = 'Opening external game…';
    await ExternalGame.open();
  }
  return true;
}
async function main() {
  button.disabled = true;
  if (!Capacitor.isNativePlatform()) { status.textContent = 'Install this Android application to download the game.'; return; }
  const access = await SharedStorage.status();
  if (!access.granted) {
    status.textContent = 'Enable PokeVoid folder access below, then return to install or play.';
    retry('Check folder access', main);
    return;
  }
  await SharedStorage.createFolders();
  await clearNativeAssetCaches();
  if (await restoreInstalledGame()) {
    localStorage.removeItem(RESUME_KEY);
    return;
  }
  let latest: Release;
  try { latest = await release(); }
  catch (error) {
    status.textContent = 'No installed game was detected. Connect to the internet to download PokéVoid.';
    retry('Retry connection', main);
    console.warn(error); return;
  }
  status.textContent = `Download PokéVoid ${latest.version}? The game is not included in the APK.`;
  const install = async () => {
    let promoted = false;
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ version: latest.version, checksum: latest.checksum }));
      status.textContent = 'Downloading game… Keep this app open.';
      resetProgress();
      const progressListener = await ResumableDownload.addListener('progress', event => {
        showProgress(event.downloaded, event.total);
      });
      try {
        await ResumableDownload.download({ url: latest.url, checksum: latest.checksum });
        status.textContent = 'Extracting game to PokeVoid/Game…';
        await ExternalGame.stage({ version: latest.version, checksum: latest.checksum });
        await ResumableDownload.releaseArchive({ checksum: latest.checksum }).catch(error => console.warn('Archive cleanup deferred', error));
      } finally {
        await progressListener.remove().catch(error => console.warn('Progress listener cleanup failed', error));
      }
      if (lastTotal > 0) showProgress(lastTotal, lastTotal);
      status.textContent = 'Installing game…';
      await ExternalGame.activate({ checksum: latest.checksum });
      promoted = true;
      await ExternalGame.open();
      localStorage.removeItem(RESUME_KEY);
      status.textContent = 'Activation requested. If the game does not open, restart the app.';
    } catch (error) {
      console.error(error);
      if (promoted) { await ExternalGame.abortLaunch(); return; }
      progressArea.hidden = true;
      status.textContent = 'Download failed. Check your connection and available storage.';
      retry('Retry download', install);
    }
  };
  retry('Download game', install);
  const failedChecksum = (await ExternalGame.status()).failedChecksum;
  if (failedChecksum === latest.checksum.toLowerCase()) {
    localStorage.removeItem(RESUME_KEY);
    status.textContent = 'The last installation did not finish loading. You can retry the download manually.';
    return;
  }
  try {
    const pending = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (pending?.version === latest.version && pending?.checksum === latest.checksum) {
      status.textContent = 'Resuming interrupted game download…';
      await install();
    }
  } catch (error) { console.warn('Invalid pending download marker', error); localStorage.removeItem(RESUME_KEY); }
}
const storageButton = document.createElement('button');
storageButton.textContent = 'Enable PokeVoid folder';
storageButton.style.cssText = 'display:block;margin:12px auto;padding:10px';
storageButton.onclick = () => {
  void configureSharedStorage().then(() => { storageButton.textContent = 'Check PokeVoid folder access'; })
    .catch(error => { console.warn('Shared storage unavailable', error); status.textContent = 'Storage permission was not granted. Existing game data is unchanged.'; });
};
document.body.append(storageButton);
void exclusive(main);
