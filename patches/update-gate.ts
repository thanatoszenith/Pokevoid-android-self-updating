import { readUpdateFeed } from './read-update-feed';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const FEED = '__POKEVOID_UPDATE_FEED__';
const BUNDLED_VERSION = '__POKEVOID_VERSION__';
const REQUEST_TIMEOUT_MS = 3000;
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
  try {
    const state = await CapacitorUpdater.current();
    const version = state.bundle?.version;
    if (version && compareVersions(version, version) === 0) return version;
  } catch (error) { console.warn('[UpdateGate] Cannot read active bundle version', error); }
  return BUNDLED_VERSION;
}

async function checkRelease(): Promise<Release | null> {
  try {
    const data = await readUpdateFeed(FEED, REQUEST_TIMEOUT_MS);
    if (!data || typeof data !== 'object') return null;
    const r = data as Partial<Release>;
    if (typeof r.version !== 'string' || typeof r.url !== 'string' || typeof r.checksum !== 'string') return null;
    if (!/^[a-fA-F0-9]{64}$/.test(r.checksum)) return null;
    // Fail closed: never activate an update without the offline daily contract.
    if (!Array.isArray(r.features) || !r.features.includes('offline-daily-v1') || !r.features.includes('official-daily-cache-v1')) return null;
    if (!trustedGameAsset(FEED, r.url, r.version)) return null;
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

/** Manually remove only inactive updater bundles. Never touch game saves or the active bundle. */
async function cleanUnusedBundles(): Promise<void> {
  const current = await CapacitorUpdater.current();
  const activeId = current.bundle?.id;
  if (!activeId || activeId === 'builtin') throw new Error('Active game bundle could not be verified');
  const result = await CapacitorUpdater.list();
  const unused = result.bundles.filter(b => b.id && b.id !== activeId && b.id !== 'builtin');
  if (!unused.length) { window.alert('No unused game bundles found.'); return; }
  if (!window.confirm(`Delete ${unused.length} unused game bundle(s)? The active game and saves will be kept.`)) return;
  let removed = 0;
  for (const bundle of unused) {
    try { await CapacitorUpdater.delete({ id: bundle.id }); removed++; }
    catch (error) { console.warn('[UpdateGate] Failed to delete inactive bundle', bundle.id, error); }
  }
  window.alert(`Removed ${removed} of ${unused.length} unused game bundles. Saves were not touched.`);
}
function installStorageControl(): void {
  if (document.getElementById('pokevoid-storage-cleanup')) return;
  const button = document.createElement('button');
  button.id = 'pokevoid-storage-cleanup';
  button.textContent = 'Clean unused bundles';
  button.title = 'Delete old inactive game versions without deleting saves';
  Object.assign(button.style, { position: 'fixed', right: '8px', bottom: '8px', zIndex: '2147483646', padding: '8px', font: '12px system-ui', opacity: '0.8' });
  button.addEventListener('click', () => { void cleanUnusedBundles().catch(error => { console.error(error); window.alert('Cleanup unavailable: unable to verify installed bundles. No files were deleted.'); }); });
  document.body.append(button);
}

/** Returns false when activation has started and Phaser must NOT boot in this document. */
export async function updateBeforeGame(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  installStorageControl();
  // Capgo needs a readiness acknowledgement on every launch, including offline launches.
  try { await CapacitorUpdater.notifyAppReady(); } catch (error) { console.warn('[UpdateGate] notifyAppReady failed', error); }
  const release = await checkRelease();
  if (!release || !window.confirm(`PokéVoid ${release.version} is available. Download and install before playing?`)) return true;
  const overlay = showOverlay();
  try {
    overlay.message('Downloading update… Gameplay is paused.');
    const bundle = await CapacitorUpdater.download({ url: release.url, version: release.version, checksum: release.checksum });
    overlay.message('Installing update…');
    await CapacitorUpdater.set(bundle); // Capgo switches/reloads the web bundle.
    // Never boot the old document while a bundle switch is underway.
    return false;
  } catch (error) {
    console.error('[UpdateGate] Update failed', error);
    overlay.message('Update failed. You can still play the installed version.');
    window.alert('Update failed. The installed version will start.');
    overlay.remove();
    return true;
  }
}
