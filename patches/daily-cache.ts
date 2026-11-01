import { fetchDailyRunSeed } from './data/daily-run';

const CACHE_KEY = 'zenni.pokevoid.officialDaily.v1';
const utcDay = (): string => new Date().toISOString().slice(0, 10);
// Validate cached values too: app storage may contain malformed or legacy entries.
const validSeed = (seed: unknown): seed is string => typeof seed === 'string' && /^[A-Za-z0-9+/_=-]{1,256}$/.test(seed);
let pending: Promise<string | null> | undefined;
const DAILY_REQUEST_TIMEOUT_MS = 8_000;

// Upstream's daily seed request has no abort/timeout parameter. Bound our wait so
// a hung request cannot permanently block subsequent refresh attempts.
function timedOfficialSeed(): Promise<string | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = window.setTimeout(() => finish(null), DAILY_REQUEST_TIMEOUT_MS);
    void fetchDailyRunSeed().then(finish, () => finish(null));
  });
}


/** Official daily is never substituted with the independently generated offline daily. */
export function cachedOfficialDaily(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return value && value.day === utcDay() && validSeed(value.seed) ? value.seed : null;
  } catch { return null; }
}

export function refreshOfficialDaily(): Promise<string | null> {
  if (pending) return pending;
  pending = (async () => {
    const day = utcDay();
    try {
      const seed = await timedOfficialSeed();
      // A proxy or captive portal may return an HTML error page with HTTP 200.
      // Never cache it as a playable official daily seed.
      if (!validSeed(seed)) return cachedOfficialDaily();
      // Never associate yesterday's server response with today's challenge.
      if (utcDay() !== day) return cachedOfficialDaily();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ day, seed })); } catch { /* storage may be disabled */ }
      return seed;
    } catch { return cachedOfficialDaily(); }
  })().finally(() => { pending = undefined; });
  return pending;
}

/** Refresh when connected, at app resume, and after a UTC date rollover. */
export function startOfficialDailySync(): void {
  if ((window as any).__pokevoidDailySyncStarted) return;
  (window as any).__pokevoidDailySyncStarted = true;
  let lastDay = utcDay();
  // navigator.onLine is only a hint: some Android WebViews report false despite connectivity.
  // Attempt a refresh periodically so a missed 'online' event cannot leave a stale daily.
  const sync = () => { void refreshOfficialDaily(); };
  window.addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.setInterval(() => { const day = utcDay(); if (day !== lastDay) lastDay = day; sync(); }, 15 * 60_000);
  sync();
}
