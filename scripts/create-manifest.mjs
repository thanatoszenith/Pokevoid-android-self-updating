import fs from 'node:fs';
import crypto from 'node:crypto';
const version=process.env.POKEVOID_VERSION;
const base=process.env.POKEVOID_RELEASE_BASE_URL;
if (!/^\d+(\.\d+)*$/.test(version||'') || version.split('.').some(x => !Number.isSafeInteger(Number(x)))) throw Error('Invalid version');
const url=new URL(`pokevoid-game-${version}.zip`,base);
if(url.protocol!=='https:' || !url.hostname) throw Error('HTTPS release base required');
const patchesRevision=process.env.POKEVOID_PATCHES_REVISION;
if (patchesRevision && !/^[0-9a-f]{40}$/.test(patchesRevision)) throw Error('Invalid game patch revision');
const filename=`pokevoid-game-${version}.zip`;
const checksum=crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
const manifest={version,url:url.href,checksum,upstreamCommit:process.env.POKEVOID_UPSTREAM_COMMIT,patchesRevision,features:['offline-daily-v1','official-daily-cache-v1','external-game-v1']};
if (fs.existsSync('delta-metadata.json')) {
  const delta=JSON.parse(fs.readFileSync('delta-metadata.json','utf8'));
  if (delta) {
    if (!/^\d+(?:\.\d+)*$/.test(delta.from) || !/^[a-f0-9]{64}$/.test(delta.checksum) || !delta.files || typeof delta.files !== 'object') throw Error('Invalid delta metadata');
    const deltaName=`pokevoid-delta-${delta.from}-to-${version}.zip`;
    if (!fs.existsSync(deltaName)) throw Error('Missing delta archive');
    manifest.delta={from:delta.from,url:new URL(deltaName,base).href,checksum:delta.checksum,files:delta.files};
  }
}
fs.writeFileSync('capacitor-update.json',JSON.stringify(manifest,null,2)+'\n');
console.log('Created capacitor-update.json for',filename);
