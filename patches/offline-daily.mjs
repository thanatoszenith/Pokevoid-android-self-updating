import fs from 'node:fs';

const file = 'src/phases/title-phase.ts';
let source = fs.readFileSync(file, 'utf8');
const original = `            if (!Utils.isLocal) {
                fetchDailyRunSeed().then(seed => {
                    if (seed) {
                        generateDaily(seed);
                    } else {
                        throw new Error("Daily run seed is null!");
                    }
                }).catch(err => {
                    console.error("Failed to load daily run:\\n", err);
                });
            } else {
                generateDaily(btoa(new Date().toISOString().substring(0, 10)));
            }`;
const replacement = `            // Android: explicitly separate deterministic offline and official online daily runs.
            // Existing web/local behavior is unchanged.
            const androidDailyChoice = typeof window !== "undefined" &&
                Capacitor.isNativePlatform();
            const dailyChoice = androidDailyChoice
                ? window.prompt("Daily Run: enter 1 for Offline Daily or 2 for Official Online Daily. Cancel to return.", "1")
                : (Utils.isLocal ? "1" : "2");
            if (dailyChoice === null || (dailyChoice !== "1" && dailyChoice !== "2")) {
                this.scene.pushPhase(new TitlePhase(this.scene, false, true));
                super.end();
                return;
            }
            if (dailyChoice === "1") {
                // UTC date gives the same daily seed irrespective of local timezone.
                generateDaily(btoa(new Date().toISOString().substring(0, 10)));
            } else {
                (androidDailyChoice ? refreshOfficialDaily() : fetchDailyRunSeed()).then(seed => {
                    if (seed) {
                        generateDaily(seed);
                    } else {
                        throw new Error("Official daily unavailable online and no current-day cached seed exists");
                    }
                }).catch(err => {
                    console.error("Failed to load official daily run:\\n", err);
                    // Return to title instead of leaving the game stuck in the save-slot flow.
                    this.scene.pushPhase(new TitlePhase(this.scene, false, true));
                    super.end();
                });
            }`;
if (!source.includes(original)) throw new Error('Daily-run integration point changed upstream; review before patching');
if (source.split(original).length !== 2) throw new Error('Expected one daily-run integration point');
source = source.replace(original,replacement);
const cacheImport = 'import { refreshOfficialDaily } from "../daily-cache";';
const capacitorImport = 'import { Capacitor } from "@capacitor/core";';
source = `${capacitorImport}\n${cacheImport}\n${source}`;
// Start the sync from the title phase, rather than only when a daily is selected.
const anchor = '    initDailyRun(): void {';
if (source.split(anchor).length !== 2) throw new Error('Daily-run entrypoint changed upstream');
// The daily cache is initialized at application boot by apply.mjs, not here.
fs.writeFileSync(file,source);
fs.copyFileSync(new URL('./daily-cache.ts', import.meta.url), 'src/daily-cache.ts');
