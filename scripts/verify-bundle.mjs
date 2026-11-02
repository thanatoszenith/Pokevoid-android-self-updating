import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const zip = process.argv[2];
if (!zip || !fs.existsSync(zip)) throw Error('Missing game ZIP');
const files = execFileSync('unzip', ['-Z','-1',zip], {encoding:'utf8'}).trim().split('\n');
if (new Set(files).size !== files.length) throw Error('Game ZIP contains duplicate paths');
if (files.some(f => f.includes('\0') || f.includes('\r') || f.includes('\n'))) throw Error('Game ZIP contains invalid entry names');
for (const required of ['index.html']) {
  if (!files.includes(required)) throw Error(`Game bundle missing ${required}`);
}
if (files.some(f => f.startsWith('/') || f.split('/').includes('..') || f.includes('\\'))) throw Error('Unsafe ZIP entry');
if (files.some(f => f.startsWith('pokesave/'))) throw Error('Game bundle contains pokesave');
console.log(`Game ZIP validated: ${files.length} entries`);

const found = new Set();
for (const file of files.filter(f => f.startsWith('assets/') && f.endsWith('.js'))) {
  const code = execFileSync('unzip', ['-p',zip,file], {encoding:'utf8',maxBuffer:128*1024*1024});
  if (code.includes('CapacitorUpdater')) throw Error('Game bundle still activates the private updater');
  for (const marker of ['ExternalGame','confirmLaunch','pokevoid-native-ready','PokeVoidSaves','Native asset caching is disabled']) {
    if (code.includes(marker)) found.add(marker);
  }
}
if (found.size !== 5) throw Error('Game bundle missing external loading, readiness, save or cache contract');
console.log('External game contract verified');
