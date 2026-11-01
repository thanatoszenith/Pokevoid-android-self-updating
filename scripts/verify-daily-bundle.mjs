import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Release invariant: no downloadable game update may ship without the Android
// offline daily choice. Check the COMPILED bundle, not merely the patch source.
export function verifyDailyBundle(zip) {
  if (!zip || !fs.existsSync(zip)) throw Error('Missing game ZIP');
  const files = execFileSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8' }).trim().split('\n');
  const js = files.filter(f => /^assets\/(?:[^/]+\/)*[^/]+\.js$/.test(f));
  if (!js.length) throw Error('Game bundle has no compiled JavaScript assets');
  let offline = false, online = false, localSeed = false, officialSeed = false, cachedDaily = false, selection = false, refresh = false;
  for (const file of js) {
    // Never extract an unbounded JS entry from an untrusted ZIP into memory.
    const code = execFileSync('unzip', ['-p', zip, file], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
    offline ||= code.includes('Offline Daily');
    online ||= code.includes('Official Online Daily');
    localSeed ||= code.includes('toISOString().substring(0,10)') || code.includes('toISOString().substring(0, 10)');
    officialSeed ||= code.includes('daily/seed');
    cachedDaily ||= code.includes('zenni.pokevoid.officialDaily.v1');
    // Labels alone are insufficient: require the actual native selection and refresh paths.
    selection ||= code.includes('Daily Run: enter 1 for Offline Daily or 2 for Official Online Daily');
    refresh ||= code.includes('Official daily unavailable online and no current-day cached seed exists');
  }
  if (!offline || !online || !localSeed || !officialSeed || !cachedDaily || !selection || !refresh) {
    throw Error(`Daily protection failed: offlineChoice=${offline}, onlineChoice=${online}, utcSeed=${localSeed}, officialEndpoint=${officialSeed}, officialCache=${cachedDaily}, nativeSelection=${selection}, onlineFallback=${refresh}. Refusing game release.`);
  }
  console.log('Compiled game bundle includes both daily choices, UTC seed and official seed endpoint');
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) verifyDailyBundle(process.argv[2]);
