import { Capacitor, registerPlugin } from '@capacitor/core';
type Entry = { key: string; value: string };
const Native = registerPlugin<{
  status(): Promise<{ granted: boolean }>;
  readSaves(): Promise<{ entries: Entry[] }>;
  writeSave(options: Entry): Promise<void>;
}>('SharedStorage');

export const isGameSaveKey = (key: string): boolean =>
  /^(data_|sessionData(?:Battle)?[0-4]?_|data_backup_|runHistoryData_|starterPrefs_)/.test(key);

let initialization: Promise<void> | undefined;
export function initializeDirectSaves(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return initialization ??= installDirectSaves().catch(error => { initialization = undefined; throw error; });
}

async function installDirectSaves(): Promise<void> {
  if (!(await Native.status()).granted) throw new Error('External save access is required');
  // New APKs inject a plain JS shim with origin-checked prompt transport.
  // Already-installed APKs retain their legacy native object until the APK itself is upgraded.
  const bridge = (window as any).PokeVoidSaves as {
    write(key: string, value: string): string; remove(key: string): string; status?(): string;
  };
  if (!bridge || typeof bridge.write !== 'function' || typeof bridge.remove !== 'function')
    throw new Error('Direct external save bridge unavailable');
  const accessError = bridge.status?.();
  if (accessError) throw new Error(accessError);
  const proto = Storage.prototype;
  const get = proto.getItem, set = proto.setItem, remove = proto.removeItem, clear = proto.clear, keyAt = proto.key;
  const lengthGetter = Object.getOwnPropertyDescriptor(proto, 'length')!.get!;
  const { entries } = await Native.readSaves();
  const saves = new Map<string, string>();
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || typeof entry.value !== 'string' || !isGameSaveKey(entry.key) || saves.has(entry.key))
      throw new Error('Invalid external save snapshot');
    saves.set(entry.key, entry.value);
  }
  const legacy: (Entry & { sourceKey: string })[] = [];
  for (let i = 0; i < lengthGetter.call(localStorage); i++) {
    const key = keyAt.call(localStorage, i);
    if (key && isGameSaveKey(key)) legacy.push({ key, sourceKey: key, value: get.call(localStorage, key)! });
    else if (key?.startsWith('pokevoid_pre_external_') && isGameSaveKey(key.slice('pokevoid_pre_external_'.length))) {
      legacy.push({ key: 'data_backup_pre_external_' + key.slice('pokevoid_pre_external_'.length), sourceKey: key, value: get.call(localStorage, key)! });
    }
  }
  // External records win. Migrate all missing records successfully before removing legacy keys.
  for (const entry of legacy) {
    if (!saves.has(entry.key)) { await Native.writeSave(entry); saves.set(entry.key, entry.value); }
    else if (saves.get(entry.key) !== entry.value) {
      const recovery = { key: 'data_backup_pre_external_' + entry.key, value: entry.value };
      if (!saves.has(recovery.key)) { await Native.writeSave(recovery); saves.set(recovery.key, recovery.value); }
    }
  }
  for (const entry of legacy) remove.call(localStorage, entry.sourceKey);
  const persist = (error: string) => { if (error) throw new DOMException(error, 'QuotaExceededError'); };
  const keys = () => {
    const result: string[] = [];
    for (let i = 0; i < lengthGetter.call(localStorage); i++) result.push(keyAt.call(localStorage, i)!);
    return [...new Set([...result, ...saves.keys()])];
  };
  const hasOwn = Object.prototype.hasOwnProperty;
  proto.hasOwnProperty = function(key: PropertyKey): boolean {
    return this === localStorage && typeof key === 'string' && isGameSaveKey(key)
      ? saves.has(key) : hasOwn.call(this, key);
  };
  proto.getItem = function(key: string): string | null {
    key = String(key);
    return this === localStorage && isGameSaveKey(key) ? saves.get(key) ?? null : get.call(this, key);
  };
  proto.setItem = function(key: string, value: string): void {
    key = String(key); value = String(value);
    if (this !== localStorage || !isGameSaveKey(key)) { set.call(this, key, value); return; }
    persist(bridge.write(key, value)); saves.set(key, value);
  };
  proto.removeItem = function(key: string): void {
    key = String(key);
    if (this !== localStorage || !isGameSaveKey(key)) { remove.call(this, key); return; }
    persist(bridge.remove(key)); saves.delete(key);
  };
  proto.clear = function(): void {
    if (this !== localStorage) { clear.call(this); return; }
    for (const key of [...saves.keys()]) { persist(bridge.remove(key)); saves.delete(key); }
    clear.call(this);
  };
  proto.key = function(index: number): string | null {
    return this === localStorage ? keys()[Number(index) >>> 0] ?? null : keyAt.call(this, index);
  };
  Object.defineProperty(proto, 'length', { configurable: true, get() {
    return this === localStorage ? keys().length : lengthGetter.call(this);
  } });
}
