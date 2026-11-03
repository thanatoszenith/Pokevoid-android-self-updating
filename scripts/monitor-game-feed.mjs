import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha = /^[0-9a-f]{40}$/;
const requiredFeatures = ['offline-daily-v1', 'official-daily-cache-v1', 'external-game-v1'];

/**
 * Decide whether the published bundle needs rebuilding. A compatible bundle may
 * need republishing even when the upstream game commit has not changed, because
 * Android integration patches are part of the downloadable game.
 */
export function publicationReasons(published, upstreamCommit, patchesRevision) {
  if (!sha.test(upstreamCommit) || !sha.test(patchesRevision))
    throw new Error('Invalid upstream or game-patch revision');
  if (published === null) return ['Public update feed is missing'];
  if (!published || typeof published !== 'object' || Array.isArray(published)
      || typeof published.version !== 'string' || !/^\d+(?:\.\d+)*$/.test(published.version)
      || typeof published.url !== 'string' || !published.url.startsWith('https://')
      || !/^[0-9a-f]{64}$/i.test(published.checksum ?? ''))
    throw new Error('Existing update feed is malformed; refusing automatic publication');

  const reasons = [];
  if (!Array.isArray(published.features) || !requiredFeatures.every(feature => published.features.includes(feature)))
    reasons.push('Published bundle lacks required Android capabilities');
  if (published.upstreamCommit !== upstreamCommit)
    reasons.push('Upstream PokéVoid source changed');
  if (published.patchesRevision !== patchesRevision)
    reasons.push('Android game patches changed or were not tracked');
  return reasons;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [feedFile, upstreamCommit, patchesRevision] = process.argv.slice(2);
    if (!feedFile) throw new Error('Usage: monitor-game-feed.mjs <feed.json|-> <upstream sha> <patch tree sha>');
    const published = feedFile === '-' ? null : JSON.parse(fs.readFileSync(feedFile, 'utf8'));
    const reasons = publicationReasons(published, upstreamCommit, patchesRevision);
    console.error(reasons.length ? reasons.join('; ') : 'Published game is compatible and current');
    console.log(reasons.length ? 'publish' : 'skip');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
