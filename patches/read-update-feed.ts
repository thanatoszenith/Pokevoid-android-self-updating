/** Read a small JSON feed without trusting Content-Length. */
export async function readUpdateFeed(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const limit = 65536;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error(`Update feed HTTP ${response.status}`);
    const advertised = response.headers.get('content-length');
    if (advertised !== null && (!/^\d+$/.test(advertised) || Number(advertised) > limit)) throw new Error('Update feed too large');
    if (!response.body) throw new Error('Update feed has no readable body');
    const type = response.headers.get('content-type');
    if (type && !/\bapplication\/(?:json|[a-z0-9.+-]+\+json)\b/i.test(type)) throw new Error('Update feed is not JSON');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Update feed exceeds 64 KiB');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
  } finally { clearTimeout(timer); }
}
