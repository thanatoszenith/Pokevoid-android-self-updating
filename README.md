# PokéVoid Android external game launcher

The APK contains a small installer and uses the supplied PNG artwork for both
legacy and adaptive Android launcher icons. Playable game files live only at
`/storage/emulated/0/PokeVoid/Game/current`. The native ExternalGame plugin points
Capacitor's HTTPS WebView file host at that directory, keeping `https://localhost`
and native plugins available without importing game assets into private bundles.
Android 11 or newer and the user's All files access grant are required. On first
launch the app opens Android's special-access settings automatically, without a
folder-access button. It checks access again when you return and continues after
the grant. Denial does not trigger a repeated settings loop.

## Installation and updates

The bootstrap checks permission, recovers interrupted filesystem transactions,
opens the installed external game offline, or offers a first download. For an
installed game, the online update manifest is fetched in parallel with essential
save/game initialization, **without delaying Phaser or the title screen**.
After the native title-readiness signal is confirmed, the app evaluates the
prefetched manifest and offers a newer version when available. An accepted update
blocks game input until installation finishes. Offline play never waits for the
network; interrupted updates still resume safely on a subsequent launch.
Both installation paths use the same native downloader, SHA-256 validation,
external extraction, activation and WebView loading.

One resumable archive exists at `PokeVoid/Game/.downloads`, alongside the external
game. Large downloads never use app-private storage.
It is renamed from `.part` to `.zip`, never copied or served through HTTP.
Extraction uses the external `.staging` directory, rejects traversal and duplicate
paths, limits entries to 200,000 and extracted bytes to 4 GiB, and syncs file contents.
Native extraction removes its ZIP and partial file when the extraction attempt
finishes, even if JavaScript is interrupted. A completed archive can be reused after
an interrupted download, before extraction starts.

Activation writes a journal before renaming `current` to `.previous` and staging
to `current`. Every startup recovers unfinished transactions. The deferred title-screen
composition signal confirms a launch using the native launch ID; an HTML load alone does
not count. Confirmation commits the journal before removing the previous directory.
Every launch has a readiness watchdog. A failed WebView load or a three-minute foreground launch timeout restores the old
game and returns to the bootstrap. A process killed before confirmation rolls back
on next launch. Failed checksums are excluded from automatic update offers.

Steady state has **one external playable copy**. During an update, the old game,
new staging/current directory and one compressed archive temporarily require space
so rollback remains possible. There is no retained rollback copy after a successful
launch. Rename recovery covers process interruption; filesystem or hardware failure
during a power loss still depends on Android's underlying storage.

## Saves and caches

Save records are written directly to `PokeVoid/Saves` using a synchronous native
transport, flushed and atomically renamed before JavaScript returns. The native
handler checks the requesting frame origin and runs disk operations on a dedicated
writer thread. A small injected JavaScript shim preserves older installed games
without exposing a raw Java interface to every WebView frame. Reads use a memory
snapshot. Failed writes throw without changing that snapshot. Preferences and
sessionStorage retain normal browser behavior. Existing internal saves are migrated
before gameplay, and only then removed from internal storage. Conflicting legacy
values are preserved once under external `data_backup_pre_external_*` records.
External permission loss blocks saves instead of silently writing an internal copy.

External downloader cleanup retains at most one owned archive/partial, no more than 4 GiB
and no older than 48 hours at cleanup. In-use download or extraction files are
protected until their operations finish. It runs at startup, before downloads and after
confirmed launch. Unrelated files are preserved. WebView HTTP caching is disabled;
CacheStorage and service worker registrations are cleared before native gameplay,
and new asset-cache registration is disabled. The official daily cache remains one
small current-day record.

After a confirmed title-screen launch, retired internal asset directories
(`files/versions`, `files/public`, `files/resumable-bundles`,
`cache/capgo_downloads`) are removed on a separate low-priority maintenance
executor, rather than blocking the next startup. Download archive pruning and
large committed rollback cleanup are likewise deferred until after reopening the
active external game. Old private downloads
are discarded and restart externally instead of creating a migration ZIP copy.
After a successful launch, checksum-named external staging, releases and mirrored
ZIP leftovers are removed. Saves and arbitrary user files are excluded.

WebView resource caches are cleared at startup, on game switches and when the app
is paused. Native HTTP downloads also disable response caching. Android still
requires internal storage for the installed APK, runtime files, small preferences
and WebView profile metadata; these are not duplicate game installations.

## Build and release

The Android workflow fetches the pinned upstream source, applies these patches,
builds and verifies the game ZIP, replaces web assets with the minimal bootstrap,
removes CapacitorUpdater, registers the native plugins and builds a debug APK.
It checks that no game content slipped into that APK and uploads both the APK and
the matching external game ZIP as separate build artifacts.

The game publication workflow builds an immutable versioned ZIP and then publishes
the GitHub Pages feed. New feeds must declare `external-game-v1` along with both
protected daily capabilities; older bundles using the private updater are rejected.
The **Monitor and automatically publish PokéVoid game updates** workflow runs daily
and whenever Android game patches or publisher configuration change on `main`.
It checks upstream PokéVoid HEAD, the published manifest's compatibility features,
and the Git tree revision of `patches/`. When any of these change (or a compatible
feed has never been published), it automatically dispatches the game publisher
with a fresh immutable numeric version. No GitHub interaction is required after
installing the launcher: on each game launch, it checks the published feed and
offers to download/install a new external game bundle. Offline play continues
without checking GitHub.

**Publish PokéVoid game bundle (no APK)** can also be run manually to force a
specific version or upstream commit. Updating Android-native wrapper code still
requires installing an updated APK; downloadable game updates cannot replace
native APK code. GitHub's scheduled workflows must remain enabled for daily
upstream monitoring to continue.

Run `node --test tests/*.test.mjs` with Node 22+, a JDK, Python with Pillow and unzip installed.
Tests execute the real Java installer with malformed archives and simulated crashes,
exercise external save migration/write failures, and verify publication and packaging.
The generated Android build is verified by GitHub Actions. A physical-device check
of first install, offline relaunch, permission revocation, backgrounding and actual
game rendering remains necessary before distributing a release-signed APK.

## Audit improvements

Interrupted first downloads now resume within the existing startup action, and a
failed game checksum requires an explicit retry instead of automatically looping.
All installed-game launches have a readiness timeout. External version, checksum
and recovery metadata have strict read limits; invalid journals preserve the game
for recovery. Each update check reads native state once, asset requests reuse their
validated base directory, and known-short download retries avoid rereading the
entire partial ZIP for SHA-256. A checksum already verified on a completed partial
is reused through finalization.

Installer and downloader queues are shared across Android Activity recreation.
Old UI callbacks are discarded after destruction, while filesystem operations
finish in order. Reference-counted archive leases keep cache cleanup from deleting
a download or extraction still in progress.

Startup also removes unfinished app-owned save transaction files on the shared
writer queue. Committed save records and unrelated user files are preserved.

If the published feed lacks the external-game capability, the installer now reports
an outdated published game release instead of incorrectly blaming connectivity.
Publish a new version (for example 1.1.0) through the game publication workflow;
never overwrite the immutable 1.0.0 ZIP.
