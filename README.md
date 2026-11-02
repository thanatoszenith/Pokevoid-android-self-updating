# PokéVoid Android external game launcher

The APK contains a small installer. Playable game files live only at
`/storage/emulated/0/PokeVoid/Game/current`. The native ExternalGame plugin points
Capacitor's HTTPS WebView file host at that directory, keeping `https://localhost`
and native plugins available without importing game assets into private bundles.
Android 11 or newer and the user's All files access grant are required.

## Installation and updates

The bootstrap checks permission, recovers interrupted filesystem transactions,
opens the installed external game offline, or offers a first download. The game
checks for newer versions before Phaser starts. Both paths use the same native
downloader, SHA-256 validation, external extraction, activation and WebView loading.

One resumable archive exists under app-private `files/resumable-bundles`.
It is renamed from `.part` to `.zip`, never copied or served through HTTP.
Extraction uses the external `.staging` directory, rejects traversal and duplicate
paths, limits entries to 200,000 and extracted bytes to 4 GiB, and syncs file contents.
The archive is removed after extraction. A completed archive can be reused after an
interrupted download.

Activation writes a journal before renaming `current` to `.previous` and staging
to `current`. Every startup recovers unfinished transactions. The battle scene's
create event confirms a launch using the native launch ID; an HTML load alone does
not count. Confirmation commits the journal before removing the previous directory.
A failed WebView load or a three-minute foreground launch timeout restores the old
game and returns to the bootstrap. A process killed before confirmation rolls back
on next launch. Failed checksums are excluded from automatic update offers.

Steady state has **one external playable copy**. During an update, the old game,
new staging/current directory and one compressed archive temporarily require space
so rollback remains possible. There is no retained rollback copy after a successful
launch. Rename recovery covers process interruption; filesystem or hardware failure
during a power loss still depends on Android's underlying storage.

## Saves and caches

Save records are written directly to `PokeVoid/Saves` using a synchronous native
bridge, flushed and atomically renamed before JavaScript returns. Reads use a memory
snapshot. Failed writes throw without changing that snapshot. Preferences and
sessionStorage retain normal browser behavior. Existing internal saves are migrated
before gameplay, and only then removed from internal storage. Conflicting legacy
values are preserved once under external `data_backup_pre_external_*` records.
External permission loss blocks saves instead of silently writing an internal copy.

Downloader cleanup retains at most one owned archive/partial, no more than 4 GiB
and no older than 48 hours at cleanup. It runs at startup, before downloads and after
confirmed launch. Unrelated files are preserved. WebView HTTP caching is disabled;
CacheStorage and service worker registrations are cleared before native gameplay,
and new asset-cache registration is disabled. The official daily cache remains one
small current-day record.

After successful external launch, exact retired updater directories
(`files/versions`, `cache/capgo_downloads`) and checksum-named external staging,
release and mirrored ZIP leftovers are removed. Saves and arbitrary user files are
excluded.

## Build and release

The Android workflow fetches the pinned upstream source, applies these patches,
builds and verifies the game ZIP, replaces web assets with the minimal bootstrap,
removes CapacitorUpdater, registers the native plugins and builds a debug APK.
It checks that no game content slipped into that APK.

The game publication workflow builds an immutable versioned ZIP and then publishes
the GitHub Pages feed. New feeds must declare `external-game-v1` along with both
protected daily capabilities; older bundles using the private updater are rejected.
Run **Publish PokéVoid game bundle (no APK)** with a new numeric dotted version and
`publish=true` to make a matching bundle available to this launcher. Updating
native loading requires installing the new APK as well as publishing the game ZIP.

Run `node --test tests/*.test.mjs` with Node 22+, a JDK, Python and unzip installed.
Tests execute the real Java installer with malformed archives and simulated crashes,
exercise external save migration/write failures, and verify publication and packaging.
The generated Android build is verified by GitHub Actions. A physical-device check
of first install, offline relaunch, permission revocation, backgrounding and actual
game rendering remains necessary before distributing a release-signed APK.
