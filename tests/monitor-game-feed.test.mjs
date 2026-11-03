import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationReasons } from '../scripts/monitor-game-feed.mjs';

const upstream = 'a'.repeat(40);
const patches = 'b'.repeat(40);
const published = {
  version: '1.0.0',
  url: 'https://github.com/owner/repo/releases/download/game-feed/pokevoid-game-1.0.0.zip',
  checksum: 'c'.repeat(64),
  upstreamCommit: upstream,
  patchesRevision: patches,
  features: ['offline-daily-v1', 'official-daily-cache-v1', 'external-game-v1'],
};

test('legacy published game triggers a compatible new release even without upstream changes', () => {
  const legacy = { ...published, patchesRevision: undefined, features: published.features.slice(0, 2) };
  const reasons = publicationReasons(legacy, upstream, patches);
  assert.ok(reasons.some(reason => reason.includes('capabilities')));
  assert.ok(reasons.some(reason => reason.includes('patches')));
});

test('unchanged upstream and game patches never republish a matching release', () => {
  assert.deepEqual(publicationReasons(published, upstream, patches), []);
});

test('new upstream or changed Android patches independently triggers publication', () => {
  assert.ok(publicationReasons(published, 'd'.repeat(40), patches).some(reason => reason.includes('Upstream')));
  assert.ok(publicationReasons(published, upstream, 'e'.repeat(40)).some(reason => reason.includes('patches')));
});

test('missing public feed bootstraps and malformed metadata fails closed', () => {
  assert.ok(publicationReasons(null, upstream, patches).length);
  assert.throws(() => publicationReasons({ ...published, checksum: 'unsafe' }, upstream, patches));
  assert.throws(() => publicationReasons(published, 'bad-sha', patches));
});

test('scheduler and main-branch game patch pushes automatically dispatch publication', () => {
  const monitor = fs.readFileSync(new URL('../.github/workflows/monitor-upstream.yml', import.meta.url), 'utf8');
  const publish = fs.readFileSync(new URL('../.github/workflows/publish-game.yml', import.meta.url), 'utf8');
  const manifest = fs.readFileSync(new URL('../scripts/create-manifest.mjs', import.meta.url), 'utf8');
  assert.match(monitor, /schedule:/);
  assert.match(monitor, /push:/);
  assert.match(monitor, /'patches\/\*\*'/);
  assert.match(monitor, /scripts\/monitor-game-feed\.mjs/);
  assert.match(monitor, /gh workflow run publish-game\.yml/);
  assert.match(monitor, /\.status == "in_progress"/);
  assert.match(publish, /git -C wrapper rev-parse HEAD:patches/);
  assert.match(publish, /POKEVOID_PATCHES_REVISION: \$\{\{ steps\.patch_revision\.outputs\.revision \}\}/);
  assert.match(manifest, /patchesRevision/);
});
