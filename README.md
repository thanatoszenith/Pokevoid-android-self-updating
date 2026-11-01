# PokéVoid Android — experimental download-first wrapper

**Status: source-only prototype; NOT a tested playable APK.** The workflow fetches the official game, builds a downloadable game ZIP and a minimal Capacitor bootstrap APK. No game source or APK is included in this repository.

## Sources
- Official game: https://github.com/smittynugget/pokevoid
- Reference offline workflows: https://github.com/PokeVoid-Offline/android

## Build preparation
1. Obtain the official source, verify its license and any third-party asset rights.
2. Audit server calls, save persistence, service workers, asset URLs, and offline initialization.
3. Produce a complete offline Vite build, and copy the build output to `www/` (replacing the placeholder).
4. Run `npm install`, `npm run android:init`, and `npm run android:sync` on a machine with Android SDK installed.
5. Build and sign the APK in Android Studio or CI. Test in airplane mode before considering it playable.

## Update architecture (revised after source audit)
- Before launching Phaser, check a separately controlled HTTPS update manifest with a short timeout.
- If offline, the request times out, or the user declines, start the already installed game normally.
- If the user approves, **do not initialize the game**. Enter an exclusive update screen.
- Download the update, verify its release metadata and artifact integrity, activate it, then launch the updated game. Do not create additional save snapshots or retain update-specific backup files.
- Preserve the same Android package ID, signing key, and WebView origin across releases. Never clear app data or WebView storage during an update.
- For native-code changes use a signed APK installer; for web-only changes use a properly integrated, verified Capacitor updater. Both need testing before deployment.
- The official Capacitor configuration has `autoUpdate: true`, but the existing offline workflow explicitly disables it. This starter implements an experimental manual update route, which has not been validated in an APK.

## Verified upstream save facts (2026-11-01)
- `src/account.ts` migrates legacy `data` and `sessionData` keys into username-suffixed keys, with five run slots.
- `src/system/game-data.ts` uses encrypted `data_${username}` system saves and `sessionData..._${username}` run saves.
- `createVersionBackup` captures system plus five run slots, but can skip backup on storage quota/budget constraints.
- `createVersionChangeBackup` captures system data only, not all run slots; older backups may be cleaned up.
- `applyCombinedSaveToLocalStorage` removes run keys and rewrites them; updates must not erase existing WebView data.
- `src/main.ts` launches Phaser through `boot()` and calls `CapacitorUpdater.notifyAppReady()` separately.

Sources:
- https://github.com/smittynugget/pokevoid/blob/main/src/system/game-data.ts
- https://github.com/smittynugget/pokevoid/blob/main/src/account.ts
- https://github.com/smittynugget/pokevoid/blob/main/src/main.ts
- https://github.com/PokeVoid-Offline/android/blob/main/.github/workflows/buildAndroid.yaml

## Unresolved
- Whether all assets and gameplay work offline.
- Official save storage and any online-only account features.
- Actual version/release feed, Android signing, asset licensing.

## Implemented experimental source patch (2026-11-01)
- `patches/update-gate.ts`: startup HTTPS check (3-second timeout), user approval, blocking update overlay, Capgo download/set without an extra save backup. Game boot resumes when declined, offline, or update fails.
- `patches/apply.mjs`: injects the gate into the upstream `boot()` and configures `com.zenni.pokevoid` with `autoUpdate: false`. Requires `POKEVOID_UPDATE_FEED` to be set to a trusted HTTPS manifest.
- `.github/workflows/build.yml`: experimental GitHub Actions build that fetches upstream game and produces a debug APK artifact. **Not executed or validated yet.**

### Known limitations / must fix before release
- `@capgo/capacitor-updater` API signatures and checksum format must be confirmed against the exact installed plugin version.
- Update manifest and release publication/signing are not implemented; set GitHub Actions repository variable `POKEVOID_UPDATE_FEED` before building.
- `window.confirm` and `window.alert` are provisional UI; replace with styled native dialogs.
- Native package signing is not configured; debug APK is only for testing.
- Live update must never be used for untrusted feeds; checksum alone is not a signature. Require a trusted publisher and authenticated release metadata.
- Game offline assets and daily challenges remain unverified.

## Save-backups-allowed / no-old-game-bundles policy
- The updater does not make additional save backups; PokéVoid’s existing save backup and migration routines remain intact.
- Preserve existing saves in-place by keeping package ID and WebView origin stable; never clear application data.
- Upstream game code still contains its own version-backup logic, which this patch does not disable. These save backups are intentional and should remain enabled. No old game bundle should be kept merely for rollback.

## Audit notes (2026-11-01)

- **Archive inspected:** four source files only; no game assets, SDK project, or compiled APK.
- **Keep:** upstream `src/system/game-data.ts` versioned save backups, five run slots, and migration routines. These use localStorage and are not copies of the game.
- **Avoid:** retaining prior web bundles in the updater. `maxVersions: 1` requests a single retained bundle, but exact plugin semantics and temporary download cleanup must be confirmed in a device test.
- **Do not clear:** Android app data, WebView localStorage, or user save backups.
- **Unverified:** the plugin's `download`, `set`, and checksum contract; feed trust/signature; production signing; APK build; online and offline gameplay.
- **Risk:** checksum supplied by the same feed as the update URL does not authenticate a compromised feed. Production deployment needs publisher-authenticated metadata or a pinned trusted release source.
- **Risk:** a web-only update cannot change native Android dependencies. Those require a separately signed APK upgrade.
- **Risk:** an update can still temporarily consume disk space while downloading/unpacking, even when no previous bundle is retained.
- **Risk:** upstream cache handling may temporarily retain browser caches; these are not updater rollback versions.

## Audit corrections (November 2026)
- The build workflow now requires an explicit numeric `version` input; never reuse a version for different builds. This replaces the fixed `0.1.0` build version.
- The patcher validates the feed URL and version **before** modifying upstream source.
- The update manifest rejects malformed HTTPS download URLs, credentials, fragments, and invalid SHA-256 hex checksums.
- The upstream dependency lockfile is installed frozen; additional native dependencies are saved at resolved exact versions, but a separately committed lockfile for those additions is still needed for fully reproducible builds.
- Remaining release blockers: real HTTPS feed, verified Capgo plugin API, consistent release signing, actual Android build, device update/offline/save tests, and confirmed obsolete-bundle cleanup.
- **Save backups remain permitted; no new game-file backups are introduced.**


## Baseline comparison / build safeguards (2026-11-01)

The native Android configuration now follows the published PokeVoid-Offline Android build
settings (black background, landscape orientation, mixed content disabled, input capture,
WebView debugging disabled, no legacy bridge). The source remains pinned rather than
tracking upstream `main`. The build checks that the upstream boot hook and updater readiness
block still match before applying the patch, verifies `dist/index.html`, and verifies the
produced debug APK is nonempty. `dist/pokesave` removal matches the existing offline workflow.

**Not yet validated:** successful GitHub Actions run, Capgo API behavior, Android runtime,
existing save migration from a different package ID, or removal of all obsolete bundles.
The APK remains debug-signed and should not be represented as a release-ready upgrade.
No additional game-file backup mechanism is included; original save backup behavior is retained.

## Download-only game assets (2026-11-01 revision)

The build workflow now produces TWO artifacts: (1) a minimal bootstrap Android APK with no bundled PokéVoid gameplay assets, and (2) a separately downloadable `pokevoid-game-bundle.zip` containing the full game. The APK shows a first-run download button and requires internet for initial installation. Once activated, the game bundle is stored by CapacitorUpdater for offline use. A real HTTPS manifest must be published with `{ "version": "1.0.0", "url": "https://.../pokevoid-game-bundle.zip", "checksum": "<64-char SHA256>" }`. The feed is set through the repository variable `POKEVOID_UPDATE_FEED`. Publish the bundle and feed before testing first launch. On subsequent builds, publish a new versioned bundle and manifest.

No game image/audio/content assets are intentionally packaged in the bootstrap APK. This is not a zero-file APK: native libraries and the tiny HTML/JS installer must be bundled. The game ZIP is necessarily stored temporarily while installing, and updater rollback/cleanup behavior still needs device validation. Existing PokéVoid save backups are retained. IMPORTANT: This architecture and updater API are not yet build- or device-tested; test first-install, restart, offline restart, failed downloads, and save persistence before production use.

## Update-controller architecture (2026-11 audit)

There is **one native bundle installer**, Capgo CapacitorUpdater. The bootstrap
screen is only the first-install/recovery entrypoint when the builtin bundle
is active. After a downloaded game bundle becomes active, the game-side gate
handles subsequent update prompts. They do not run simultaneously: Capacitor
loads either the builtin bootstrap or the active downloaded game document.
This separation is intentional; merging them into one page would make offline
recovery less reliable. Neither entrypoint stores backup copies of game assets.

The build now checks the compiled APK's `assets/public/` directory for forbidden
media/data extensions, in addition to the bootstrap `dist` allowlist. This is
an inspection test, not proof of working downloads or save persistence.

**Release blockers:** A real HTTPS feed and hosting for the game ZIP, signing
with a persistent key, a successful GitHub Actions run, and Android tests for
first install, offline relaunch, updating, and save persistence. The release
manifest is currently generated as a workflow artifact, not deployed.


## Release hosting and first build (2026-11 audit)

The workflow can now publish the downloadable game ZIP and `capacitor-update.json` together to the `game-feed` GitHub Release when `publish=true`. Configure repository Actions variables:

- `POKEVOID_UPDATE_FEED`: `https://github.com/OWNER/REPOSITORY/releases/download/game-feed/capacitor-update.json`
- `POKEVOID_RELEASE_BASE_URL`: `https://github.com/OWNER/REPOSITORY/releases/download/game-feed/` (trailing slash required)

Replace OWNER/REPOSITORY with the **public** wrapper repository. Run the workflow with a numeric dotted version and `publish=true`. This release feed is a project-specific feed, not the upstream developer's feed. GitHub Release assets can redirect; test WebView fetch/CORS and the Capgo downloader on-device before shipping. Publishing a new game ZIP before updating the manifest avoids pointing to a missing file, but the release upload step is not transactional.

**Known limitations:** The APK is still debug-signed, first-install and offline relaunch are untested, and Capacitor native bundle retention/cleanup behavior is not verified. Never distribute the debug APK as a production release. Game backups are not created by this workflow; upstream save backups are preserved. The bundled bootstrap JavaScript remains necessary and is not a game asset.

## 2026-11-01 release pipeline correction

The previous release-asset manifest URL was unsuitable for direct WebView `fetch()` because GitHub release downloads may not provide browser CORS access. The workflow now publishes **the versioned ZIP first**, then deploys `capacitor-update.json` to **GitHub Pages** through `actions/deploy-pages`. Set repository Settings → Pages → Build and deployment → **GitHub Actions**. Set `POKEVOID_UPDATE_FEED=https://OWNER.github.io/REPOSITORY/capacitor-update.json` and `POKEVOID_RELEASE_BASE_URL=https://github.com/OWNER/REPOSITORY/releases/download/game-feed/`. The workflow checks these URLs match its repository. Do not distribute until the manifest is accessible and the APK passes on-device testing. The two upload operations are not atomic; the manifest is published only after the ZIP upload succeeds.

The build remains debug-signed and native runtime/update compatibility has not been verified. Save backups remain allowed; no additional game-file backup code was introduced.

## Latest audit corrections
- Publishing now refuses to overwrite a previously published versioned game ZIP. Reuse of a version with different bytes would invalidate prior checksums and undermine reproducibility. Increment the version instead.
- Publication endpoints are validated **before** publishing a release asset; the generated manifest is verified against the actual ZIP SHA-256.
- The manifest is deployed after uploading the ZIP, but GitHub Pages/CDN propagation and Android runtime activation remain untested.
- The first launch requires internet; subsequent launches are intended to load Capgo's active downloaded bundle offline. Native behavior has not been demonstrated on a device.
- A debug APK is **not** a production release. Stable release signing and installation/update tests are still required.
- Only one downloaded game version is requested in Capacitor configuration. This is not proof that temporary files or all obsolete bundles are removed.


## Audit corrections (2026-11-01)

- Added serialized release workflow runs per game version to reduce simultaneous publication races.
- Added a ZIP integrity/content gate: the downloadable game must contain `index.html` and `manifest.json`, must exclude `pokesave`, and cannot contain unsafe traversal paths.
- Added a basic metadata response size guard for the bootstrap.
- **Unresolved:** Native Capgo behavior, stable release signing, bundle cleanup, and actual offline installation require an Android build and device testing. A source-only audit cannot certify these.

## Audit corrections (2026-11-01)
- Update manifest reads are now limited to 64 KiB of actual streamed bytes, even if Content-Length is missing or dishonest. Both first-install bootstrap and in-game update checks share this implementation.
- GitHub Actions release builds now serialize across **all** versions to prevent simultaneous publication of conflicting update feeds.
- Manifest generation rejects unsafe numeric version components.
- These are source-level fixes; Android compilation, Capgo runtime compatibility, offline relaunch, and release signing remain unverified.

## Audit update (2026-11-01)

Added publication downgrade prevention: the workflow refuses to advertise a release at or below the currently published feed version, and validates numeric version components before the expensive build. The feed check deliberately fails closed on network errors other than HTTP 404. This is a preflight safety check, not an atomic compare-and-swap; GitHub Pages caching and external publication races remain possible. Native updater and Android behavior are still untested.


## November 2026 source audit fixes
- The downloadable game build now sets `VITE_NATIVE_WRAPPER=1`, matching upstream's native web-update build and avoiding unintended PWA/service-worker behavior.
- Update metadata rejects explicitly non-JSON response content types (while tolerating missing headers), in addition to the 64 KiB streaming cap.
- Publishing fails closed when an existing release manifest lacks a valid HTTPS bundle URL or SHA-256 checksum.
- GitHub Actions runs version-comparison regression tests before building. Run locally with `node --test tests/*.test.mjs`.
- **Still unverified:** actual Android compilation, Capgo API compatibility, first-run/offline activation, APK signing, and bundle cleanup. No device-tested claims are made.

## Audit notes (November 2026)

- Release build is **not** production signed; debug APKs must not be distributed as production updates.
- Bundle and APK validators now reject duplicate archive paths; this does not substitute for a full Android security review.
- Offline relaunch depends on the native updater selecting its active bundle before the bootstrap WebView starts. This has **not** been tested on Android.
- GitHub Pages and release hosting must be configured and verified before the first download can work.
- Game assets are excluded from the APK by allowlist checks, which require a real compiled APK to run.

## Audit note (2026-11-01)

- Bootstrap no longer automatically calls `CapacitorUpdater.set()` on every launch when a non-builtin bundle is reported; it offers an explicit manual recovery action to avoid activation loops.
- A native installed-bundle lookup failure now shows a retry rather than assuming the game is absent and prompting a full download.
- Remaining blocking checks: a real Android APK build, Capgo plugin API compatibility and native lifecycle testing, persistent signing identity, HTTPS release publication, offline relaunch and save persistence, and obsolete bundle storage behavior.
- This project is source scaffolding, not a tested APK. Existing game save backups are retained; no game bundle backup is added.

### Audit note (2026-11-01)
The GitHub Actions workflow now passes `workflow_dispatch.inputs.version` through the
`POKEVOID_VERSION` environment variable in shell commands rather than interpolating
untrusted workflow input into shell source. The generated bundle filename is quoted.
A regression test checks for reintroduction of direct version interpolation.
This does not replace an Android build, production signing, or on-device validation.


### 2026-11-01 audit changes
- First publication now requires repository variable `POKEVOID_ALLOW_FIRST_PUBLICATION=true` when the public feed is not yet deployed. Remove or set it to `false` after the first release. This prevents silently treating a missing feed as an empty release history.
- The APK validator rejects recognizable native game-content directories as well as unexpected packaged web files. This is a heuristic, not a full asset inventory.
- Unexpected bootstrap button-action exceptions now surface a retry option instead of leaving the UI in a failed state.
- **Still unverified:** native updater version compatibility, first-install activation, offline startup, native signing, and cleanup of downloaded bundles.

### Audit update — bootstrap entrypoint validation (2026-11-01)
Both `verify-bootstrap.mjs` and `verify-apk.mjs` now require a compiled bootstrap JavaScript entrypoint, in addition to the minimal HTML and asset allowlist. The APK validator inspects the packaged HTML for a script tag and disallows external script/asset URLs. Four regression tests cover a valid bootstrap, missing JS, accidental game asset, and external script URL. These are static packaging tests; they do not substitute for an actual Android build, signing, or offline installation test.

### Audit correction — configuration string injection (2026-11-01)
The build previously inserted the update-feed URL into single-quoted TypeScript by raw text replacement. An HTTPS URL containing an apostrophe could break compilation, and certain input could alter generated source. Both the bootstrap and installed-game update gate now insert configuration using JSON-escaped string literals. `scripts/inject-feed.mjs` performs strict single-placeholder validation; two regression tests cover escaping and rejecting HTTP feeds. This is a source-level fix only; Android runtime remains untested.

## Android daily-run split (source patch)

The pinned PokéVoid source already implements a daily run with two seed sources:
`fetchDailyRunSeed()` for the official server and a deterministic base64-encoded
UTC date for local runs. The wrapper now patches `src/phases/title-phase.ts` to
prompt Android users when selecting Daily Run: **OK = Offline Daily**, **Cancel =
Official Online Daily**. This is a selection between two seed sources for the
existing Daily game mode, not two new independent game modes or leaderboards.
Offline Daily makes no daily-seed network request; other optional game services
may still attempt network activity. Official Online Daily needs a reachable
upstream daily endpoint and is not verified to work with the standalone APK.
The existing save slots and built-in save backups are not modified. If the
upstream title-phase changes, the patch fails the build instead of guessing.

The new daily patch has local regression tests, but gameplay and online daily
service availability have **not** been tested on an Android device.

### Daily feature release invariant
Every newly built downloadable game ZIP is checked with
`scripts/verify-daily-bundle.mjs` before artifact upload and again before
publication. The check rejects bundles without the compiled Offline Daily
choice, Official Online Daily choice, UTC-date seed path, and server seed
endpoint. `patches/offline-daily.mjs` also fails the build if the upstream daily
integration point changes. Therefore a normal release through this workflow
cannot silently omit Offline Daily. This does **not** protect against a release
published outside this workflow, or establish runtime correctness without a
real Android test. The previously requested automatic refresh/cache of official
daily data is **not yet implemented**; the current online daily requests its
seed when selected.

## Official daily caching audit (2026-11-01)

The Android daily patch now installs `src/daily-cache.ts`. On entering the daily-run selection, it starts an official daily seed sync: refreshes on connection restoration, when the app becomes visible, and after UTC date rollover (minute-granularity check). The official daily choice fetches the server seed and falls back **only** to a cached official seed tagged with the current UTC day. Offline Daily remains independent and always uses its deterministic UTC date seed, with no network dependency. Web daily selection retains its original server-fetch behavior. Cache storage uses a dedicated localStorage key, not game save slots or game bundles. Sync starts on first daily selection, not app startup; a future integration should start it on the title screen if proactive prefetch before daily selection is required. The build release guard checks that the compiled bundle contains both daily choices and the official cache identifier. This is source-level implementation, not an Android runtime validation.

### Daily selection cancellation fix (2026-11-01)
Android daily selection now uses an explicit `1` (Offline Daily) / `2` (Official Online Daily) prompt. Cancelling or entering another value returns to the title flow rather than implicitly starting an online daily. The release verifier requires both daily labels in each compiled game ZIP. This is a source/build-time guard, not a cryptographic or runtime guarantee against an externally hosted replacement bundle.

### Daily synchronization audit (2026-11-01)
Official daily background synchronization now initializes at game boot on Android rather than waiting for the Daily Run menu. Offline Daily remains independent, using the UTC-date seed, and release-bundle checks still require both daily paths. Native behavior has not been device-tested.

### Audit: stalled official daily requests

The official daily seed endpoint uses an upstream fetch without a caller-supplied timeout.
The Android daily cache now limits each wait to eight seconds. If the server stalls,
the app falls back to a current-day cached official seed (if any), clears the
in-flight refresh lock, and can retry later. This does not alter the separately
seeded Offline Daily mode. The upstream HTTP request itself may still complete
later; its late result is ignored by the timed wrapper.

### Daily update protection audit (2026-11-01)
The compiled release verifier now checks for the native daily-selection prompt and the
online daily fallback/error path, in addition to the two labels, UTC seed,
official endpoint and cache key. A bundle containing only superficial daily labels
is rejected. This is a **static build-time safeguard**, not a guarantee that the
runtime UI works or that an out-of-band release is safe. Native testing is pending.

### Daily capability contract (release safeguard)
The published `capacitor-update.json` declares `features: ["offline-daily-v1", "official-daily-cache-v1"]`.
Both the bootstrap installer and the in-game updater reject feeds missing either declaration.
The release workflow separately checks the compiled game ZIP for daily implementation markers.
This is **not cryptographic proof** of working daily functionality: a falsely declared or externally published bundle can still pass the manifest check. Android runtime testing is required.
Older feeds without the capability declaration will not be installed by this wrapper until republished with the contract.

### Audit note: nested JavaScript chunks (2026-11-01)
The compiled daily feature verifier now examines JavaScript under nested `assets/` directories as well as top-level Vite chunks. This avoids falsely rejecting releases when the bundler moves the daily code into a nested chunk. A regression test covers this packaging layout. This remains a static release check, not a runtime proof that Offline Daily works.

### Update origin validation
The bootstrap and in-game updater accept downloadable ZIP URLs only from the immutable `game-feed` release of the same GitHub repository as the configured GitHub Pages feed, with the expected versioned ZIP filename. This reduces the risk of redirecting installs to arbitrary HTTPS hosts. This is **not** a cryptographic signature on the feed; compromised publishing credentials remain a risk.

## Source and compilation audit (2026-11-01)
- Rechecked every added executable source file in `bootstrap/`, `patches/`, `scripts/` and the GitHub Actions workflow. The project contains no checked-out upstream game source or generated Android Gradle project.
- Fixed official daily cache validation: malformed cached seeds are now rejected using the same predicate as downloaded seeds. This does not change the independent Offline Daily generator.
- Local TypeScript transpilation checks and JavaScript regression tests are not equivalent to a full PokéVoid/Vite/Gradle build.
- An APK cannot be compiled in the current isolated environment without the pinned upstream source, package dependencies, and Android SDK. The GitHub Actions workflow remains the intended full build path and must be run and inspected before claiming a working APK.
