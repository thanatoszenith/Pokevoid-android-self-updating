import { Capacitor, registerPlugin } from '@capacitor/core';

type RecordEntry = { key: string; value: string };
const Native = registerPlugin<{
  status(): Promise<{ granted: boolean; path: string }>;
  readSaves(): Promise<{ entries: RecordEntry[] }>;
  writeSave(options: RecordEntry): Promise<void>;
  deleteSave(options: { key: string }): Promise<void>;
}>('SharedStorage');

// Only game-save records are redirected. Preferences and unrelated WebView state remain internal.
export const isGameSaveKey = (key: string): boolean =>
  /^(data_|sessionData(?:Battle)?[0-4]?_|data_backup_|runHistoryData_|starterPrefs_)/.test(key);

let pending: Promise<void> = Promise.resolve();
let active = false;
const enqueue = (operation: () => Promise<void>) => {
  pending = pending.then(operation).catch(error => {
    console.error('[DirectSaves] External write failed; internal recovery copy retained', error);
    window.alert('PokéVoid could not write a save to external storage. Your internal recovery copy is retained. Check storage access before continuing.');
    active = false; // stop treating external storage as available after a write failure
  });
};

export async function initializeDirectSaves(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const state = await Native.status();
  if (!state.granted) {
    console.warn('[DirectSaves] External storage permission missing; existing internal saves preserved');
    return;
  }
  const originalSet = Storage.prototype.setItem;
  const originalRemove = Storage.prototype.removeItem;
  // Read and validate the complete external snapshot before modifying any local data.
  const { entries } = await Native.readSaves();
  const external = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || typeof entry.value !== 'string' || !isGameSaveKey(entry.key) || external.has(entry.key))
      throw new Error('Invalid or duplicate external save record');
    external.set(entry.key, entry.value);
  }
  const local: RecordEntry[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && isGameSaveKey(key)) {
      const value = localStorage.getItem(key);
      if (value !== null) local.push({ key, value });
    }
  }
  // Import missing legacy saves before installing hooks; external records take precedence.
  // Do not delete internal records: they provide a recovery path if permission is revoked.
  for (const entry of local) {
    if (!external.has(entry.key)) await Native.writeSave(entry);
  }
  for (const [key, value] of external) {
    const current = localStorage.getItem(key);
    if (current !== null && current !== value) {
      // Preserve the original value outside the synchronized keyspace.
      originalSet.call(localStorage, 'pokevoid_pre_external_' + key, current);
    }
    originalSet.call(localStorage, key, value);
  }
  active = true;
  Storage.prototype.setItem = function(key: string, value: string): void {
    originalSet.call(this, key, value);
    if (this === localStorage && active && isGameSaveKey(key)) {
      enqueue(() => Native.writeSave({ key, value: String(value) }));
    }
  };
  Storage.prototype.removeItem = function(key: string): void {
    originalRemove.call(this, key);
    if (this === localStorage && active && isGameSaveKey(key)) {
      enqueue(() => Native.deleteSave({ key }));
    }
  };
  // Avoid losing external saves when a game clears WebView storage.
  window.addEventListener('pagehide', () => { void pending; });
}
