import { ResumableDownload } from './resumable-download';
import { configureSharedStorage } from './shared-storage';
import { readUpdateFeed } from './read-update-feed';
import { Capacitor } from '@capacitor/core';
import { ExternalGame } from './external-game';

const FEED = '__POKEVOID_UPDATE_FEED__';
const BUNDLED_VERSION = '__POKEVOID_VERSION__';
const REQUEST_TIMEOUT_MS = 3000;
const RESUME_KEY = 'pokevoid_pending_update';
type Release = { version: string; url: string; checksum: string; features: string[] };

function compareVersions(a: string, b: string): number | null {
  if (!/^\d+(\.\d+)*$/.test(a) || !/^\d+(\.\d+)*$/.test(b)) return null;
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  if ([...left, ...right].some(n => !Number.isSafeInteger(n))) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return Math.sign((left[i] ?? 0) - (right[i] ?? 0));
  }
  return 0;
}

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

async function installedVersion(): Promise<string> {
  return (await ExternalGame.status()).version;
}

async function checkRelease(): Promise<Release | null> {
  try {
    const data = await readUpdateFeed(FEED, REQUEST_TIMEOUT_MS);
    if (!data || typeof data !== 'object') return null;
    const r = data as Partial<Release>;
    if (typeof r.version !== 'string' || typeof r.url !== 'string' || typeof r.checksum !== 'string') return null;
    if (!/^[a-fA-F0-9]{64}$/.test(r.checksum)) return null;
    // Fail closed: never activate an update without the offline daily contract.
    if (!Array.isArray(r.features) || !r.features.includes('offline-daily-v1') || !r.features.includes('official-daily-cache-v1') || !r.features.includes('external-game-v1')) return null;
    if (!trustedGameAsset(FEED, r.url, r.version)) return null;
    if ((await ExternalGame.status()).failedChecksum === r.checksum.toLowerCase()) return null;
    return compareVersions(r.version, await installedVersion()) === 1 ? r as Release : null;
  } catch (error) { console.warn('[UpdateGate] Offline or update check failed', error); return null; }
}

function showOverlay(): { message: (s: string) => void; remove: () => void } {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#10151f', color: '#fff', display: 'grid', placeItems: 'center', font: '18px system-ui', textAlign: 'center', padding: '24px' });
  document.body.append(el);
  return { message: (s) => { el.textContent = s; }, remove: () => el.remove() };
}

/** Returns false when activation has started and Phaser must NOT boot in this document. */
export async function updateBeforeGame(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;

  if ((await ExternalGame.status()).pending) return true;
  const release = await checkRelease();
  if (!release) return true;
  let resume = false;
  try {
    const pending = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    resume = pending?.version === release.version && pending?.checksum === release.checksum;
  } catch { localStorage.removeItem(RESUME_KEY); }
  if (!resume && !window.confirm(`PokéVoid ${release.version} is available. Download and install before playing?`)) return true;
  const overlay = showOverlay();
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify({ version: release.version, checksum: release.checksum }));
    overlay.message('Downloading update… Gameplay is paused.');
    const mb = (n: number) => (n / 1048576).toFixed(1) + ' MiB';
    let sampleTime = 0;
    let sampleBytes = 0;
    let speed = 0;
    const duration = (seconds: number) => {
      const n = Math.max(0, Math.ceil(seconds));
      return n >= 3600 ? `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m` : n >= 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n}s`;
    };
    const report = (downloaded: number, total: number) => {
      if (!Number.isFinite(downloaded) || downloaded < 0) return;
      const now = Date.now();
      if (sampleTime && downloaded < sampleBytes) { sampleTime = 0; speed = 0; }
      if (sampleTime && now - sampleTime >= 800) {
        const delta = downloaded - sampleBytes;
        const instant = delta > 0 ? delta * 1000 / (now - sampleTime) : 0;
        speed = speed > 0 ? speed * 0.7 + instant * 0.3 : instant;
        sampleTime = now;
        sampleBytes = downloaded;
      } else if (!sampleTime) { sampleTime = now; sampleBytes = downloaded; }
      if (Number.isFinite(total) && total > 0) {
        const remaining = Math.max(0, total - downloaded);
        const percent = Math.min(100, Math.max(0, 100 * downloaded / total));
        const eta = remaining === 0 ? 'Verifying…' : speed > 1024 ? `ETA ${duration(remaining / speed)}` : 'ETA calculating…';
        overlay.message(`Downloading update: ${percent.toFixed(1)}% • ${mb(downloaded)} / ${mb(total)} • ${mb(remaining)} left • ${speed > 1024 ? mb(speed) + '/s' : 'Speed calculating…'} • ${eta}`);
      } else {
        overlay.message(`Downloading update: ${mb(downloaded)} received • Total unknown • ${speed > 1024 ? mb(speed) + '/s' : 'Speed calculating…'}`);
      }
    };
    const listener = await ResumableDownload.addListener('progress', ({ downloaded, total }) => report(downloaded, total));
    try {
      await ResumableDownload.download({ url: release.url, checksum: release.checksum });
      overlay.message('Extracting update to PokeVoid/Game…');
      await ExternalGame.stage({ version: release.version, checksum: release.checksum });
      await ResumableDownload.releaseArchive({ checksum: release.checksum }).catch(error => console.warn('[UpdateGate] Archive cleanup deferred', error));
    } finally { await listener.remove().catch(error => console.warn('[UpdateGate] Progress listener cleanup failed', error)); }
    overlay.message('Installing update…');
    await ExternalGame.activate({ checksum: release.checksum });
    await ExternalGame.open();
    localStorage.removeItem(RESUME_KEY); // External file host reloads the WebView.
    // Never boot the old document while a bundle switch is underway.
    return false;
  } catch (error) {
    console.error('[UpdateGate] Update failed', error);
    // Keep the pending marker for automatic recovery on the next app launch.
    overlay.message('Update failed. You can still play the installed version.');
    window.alert('Update failed. The installed version will start.');
    overlay.remove();
    return true;
  }
}
