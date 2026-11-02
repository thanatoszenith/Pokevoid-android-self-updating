import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const mainPath = 'src/main.ts';
// Fail before touching upstream files when release metadata is invalid.
const feed = process.env.POKEVOID_UPDATE_FEED;
if (!feed) throw new Error('POKEVOID_UPDATE_FEED is required');
const feedUrl = new URL(feed);
if (feedUrl.protocol !== 'https:' || feedUrl.username || feedUrl.password || feedUrl.hash) throw new Error('POKEVOID_UPDATE_FEED must be a plain HTTPS URL');
const version = process.env.POKEVOID_VERSION;
if (!version || !/^\d+(\.\d+)*$/.test(version) || version.split('.').some(x => !Number.isSafeInteger(Number(x)))) throw new Error('POKEVOID_VERSION must be a numeric dotted version');
let main = fs.readFileSync(mainPath, 'utf8');
main = 'import { clearNativeAssetCaches } from "./native-cache";\nimport { armNativeLaunch } from "./native-launch";\n' + main;
if (!main.includes('game = new Phaser.Game(config);')) throw new Error('Game construction hook changed');
main = main.replace('game = new Phaser.Game(config);', 'game = new Phaser.Game(config);\n    if (Capacitor.isNativePlatform()) armNativeLaunch(game);');
const importLine = 'import { updateBeforeGame } from "./update-gate";';
if (!main.includes(importLine)) main = `${importLine}\n${main}`;
const directSaveImport = 'import { initializeDirectSaves } from "./direct-saves";';
if (!main.includes(directSaveImport)) main = `${directSaveImport}\n${main}`;
const dailySyncImport = 'import { startOfficialDailySync } from "./daily-cache";';
const capacitorImport = 'import { Capacitor } from "@capacitor/core";';
if (!main.includes(capacitorImport)) main = `${capacitorImport}\n${main}`;
if (!main.includes(dailySyncImport)) main = `${dailySyncImport}\n${main}`;
const bootLine = 'const boot = async (): Promise<void> => {';
if (main.split(bootLine).length !== 2) throw new Error('Expected exactly one PokéVoid boot() entrypoint');
if (!main.includes('if (Capacitor.isNativePlatform()) await clearNativeAssetCaches(); if (!(await updateBeforeGame())) return;')) main = main.replace(bootLine, `${bootLine}\n  if (!(await updateBeforeGame())) return;\n  if (Capacitor.isNativePlatform()) { await initializeDirectSaves(); startOfficialDailySync(); }`);
if (!main.includes('await initializeDirectSaves(); startOfficialDailySync();')) throw new Error('Android daily sync startup hook missing');
// Upstream notifies readiness after boot. Our update gate now handles this before the game starts.
const legacyNotify = /if \(typeof \(window as any\)\.Capacitor !== "undefined"\) \{\s*import\("@capgo\/capacitor-updater"\)\.then\(\(\{ CapacitorUpdater \}\) => \{\s*CapacitorUpdater\.notifyAppReady\(\);\s*\}\)\.catch\(\(\) => \{\}\);\s*\}/;
if (!legacyNotify.test(main)) throw new Error('Upstream readiness hook changed; review patch before building');
main = main.replace(legacyNotify, '');
fs.writeFileSync(mainPath, main);
fs.copyFileSync('patches/external-game.ts', 'src/external-game.ts');
fs.copyFileSync('patches/native-cache.ts', 'src/native-cache.ts');
fs.copyFileSync('patches/native-launch.ts', 'src/native-launch.ts');
fs.copyFileSync('patches/update-gate.ts', 'src/update-gate.ts');
fs.copyFileSync('patches/resumable-download.ts', 'src/resumable-download.ts');
fs.copyFileSync('patches/shared-storage.ts', 'src/shared-storage.ts');
fs.copyFileSync('patches/direct-saves.ts', 'src/direct-saves.ts');
fs.copyFileSync('patches/read-update-feed.ts', 'src/read-update-feed.ts');
let gate = fs.readFileSync('src/update-gate.ts', 'utf8');
gate = gate.replace("'__POKEVOID_UPDATE_FEED__'", JSON.stringify(feed)).replace("'__POKEVOID_VERSION__'", JSON.stringify(version));
if (gate.includes('__POKEVOID_UPDATE_FEED__') || gate.includes('__POKEVOID_VERSION__')) throw new Error('Unreplaced updater configuration placeholder');
fs.writeFileSync('src/update-gate.ts', gate);
fs.writeFileSync('capacitor.config.ts', `import type { CapacitorConfig } from '@capacitor/cli';\nconst config: CapacitorConfig = { appId: 'com.zenni.pokevoid', appName: 'PokéVoid', webDir: 'dist', server: { androidScheme: 'https' }, android: { backgroundColor: '#000000', allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false, loggingBehavior: 'none', useLegacyBridge: false, initialFocus: true, orientation: 'landscape' }, plugins: { } };\nexport default config;\n`);

// Patch the existing daily-run path; do not add a second game mode or change saves.
execFileSync(process.execPath, ['patches/offline-daily.mjs'], { stdio: 'inherit' });
