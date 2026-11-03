/** Only the external game files are authoritative; browser asset caches are disposable.
 * Never block game startup waiting for Android WebView cache APIs to settle.
 */
const CLEANUP_WAIT_MS = 1500;
async function bounded<T>(operation: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>(resolve => { timer = setTimeout(() => resolve(fallback), CLEANUP_WAIT_MS); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
export async function clearNativeAssetCaches(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if ('serviceWorker' in navigator) {
    const serviceWorker = navigator.serviceWorker;
    // Disable new asset caches before any asynchronous housekeeping begins.
    try {
      serviceWorker.register = async () => { throw new Error('Native asset caching is disabled'); };
    } catch (error) { console.warn('[NativeCache] Cannot disable service worker registration', error); }
    tasks.push((async () => {
      const registrations = await bounded(serviceWorker.getRegistrations(), []);
      await bounded(Promise.allSettled(registrations.map(registration => registration.unregister())), []);
    })().catch(error => console.warn('[NativeCache] Service worker cleanup deferred', error)));
  }
  if ('caches' in window) {
    const storage = caches;
    try {
      storage.open = async () => { throw new Error('Native asset caching is disabled'); };
    } catch (error) { console.warn('[NativeCache] Cannot disable cache creation', error); }
    tasks.push((async () => {
      const names = await bounded(storage.keys(), []);
      await bounded(Promise.allSettled(names.map(name => storage.delete(name))), []);
    })().catch(error => console.warn('[NativeCache] Browser cache cleanup deferred', error)));
  }
  await Promise.allSettled(tasks);
}
