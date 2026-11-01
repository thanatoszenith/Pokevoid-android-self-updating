import { readUpdateFeed } from './read-update-feed';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const feed = '__POKEVOID_UPDATE_FEED__';
const status = document.getElementById('status')!;
const button = document.getElementById('install') as HTMLButtonElement;
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
  if (!Array.isArray(x.features) || !x.features.includes('offline-daily-v1') || !x.features.includes('official-daily-cache-v1')) return false;
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
/** The native updater loads the active bundle before this bootstrap page runs.
 * If bootstrap is displayed despite an active bundle, repeatedly calling set()
 * can cause a reload loop. Offer one explicit recovery action instead.
 */
async function restoreInstalledGame(): Promise<boolean> {
  try {
    const state = await CapacitorUpdater.current();
    const bundle = state.bundle;
    if (!bundle || !bundle.id || bundle.id === 'builtin') return false;
    status.textContent = `PokéVoid ${bundle.version || ''} is installed but did not open. You can try reopening it without internet.`;
    retry('Reopen installed game', async () => {
      button.disabled = true;
      status.textContent = 'Reopening installed game…';
      try {
        await CapacitorUpdater.set(bundle);
        status.textContent = 'Reopen requested. If this screen remains, restart the app.';
        retry('Try again', async () => { await restoreInstalledGame(); });
      } catch (error) {
        console.error('Reopen failed', error);
        status.textContent = 'Unable to reopen installed game. Your saves have not been erased.';
        retry('Try again', async () => { await restoreInstalledGame(); });
      }
    });
    return true;
  } catch (error) {
    console.warn('Installed bundle lookup failed', error);
    status.textContent = 'Cannot verify installed game. Restart the app or retry; existing saves have not been changed.';
    retry('Retry installed game check', main);
    return true;
  }
}
async function main() {
  button.disabled = true;
  if (!Capacitor.isNativePlatform()) { status.textContent = 'Install this Android application to download the game.'; return; }
  try { await CapacitorUpdater.notifyAppReady(); } catch (error) { console.warn('Readiness failed', error); }
  if (await restoreInstalledGame()) return;
  let latest: Release;
  try { latest = await release(); }
  catch (error) {
    status.textContent = 'No installed game was detected. Connect to the internet to download PokéVoid.';
    retry('Retry connection', main);
    console.warn(error); return;
  }
  status.textContent = `Download PokéVoid ${latest.version}? The game is not included in the APK.`;
  retry('Download game', async () => {
    try {
      status.textContent = 'Downloading game… Keep this app open.';
      const bundle = await CapacitorUpdater.download({url: latest.url, version:latest.version, checksum:latest.checksum});
      status.textContent = 'Installing game…';
      await CapacitorUpdater.set(bundle);
      status.textContent = 'Activation requested. If the game does not open, restart the app.';
    } catch (error) {
      console.error(error);
      status.textContent = 'Download failed. Check your connection and available storage.';
      retry('Retry download', main);
    }
  });
}
void main();
