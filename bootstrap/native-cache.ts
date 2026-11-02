/** Native assets already live on disk; never keep a second asset cache in the WebView. */
export async function clearNativeAssetCaches(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
    // This document and future game modules must not register another worker.
    navigator.serviceWorker.register = async () => { throw new Error('Native asset caching is disabled'); };
  }
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    caches.open = async () => { throw new Error('Native asset caching is disabled'); };
  }
}
