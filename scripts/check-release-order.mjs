/** Prevent advertising a version older than the currently published game. */
const feed = process.env.POKEVOID_UPDATE_FEED;
const incoming = process.env.POKEVOID_VERSION;
const parts = (v) => {
  if (typeof v !== 'string' || !/^\d+(?:\.\d+)*$/.test(v)) throw Error(`Invalid version: ${v}`);
  return v.split('.').map(x => { const n = Number(x); if (!Number.isSafeInteger(n)) throw Error('Version component exceeds safe integer'); return n; });
};
export function compare(a,b) {
  const x=parts(a), y=parts(b);
  for(let i=0;i<Math.max(x.length,y.length);i++) {const delta=(x[i]??0)-(y[i]??0);if(delta) return Math.sign(delta);}
  return 0;
}
export async function check(feedUrl, next) {
  parts(next);
  const u=new URL(feedUrl);
  if(u.protocol!=='https:' || u.username || u.password || u.hash) throw Error('Invalid HTTPS update feed');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch(u,{signal:controller.signal,cache:'no-store'});
    if(response.status===404) {
      if (process.env.POKEVOID_ALLOW_FIRST_PUBLICATION !== 'true') throw Error('Update feed is missing (HTTP 404). Explicitly enable first publication after configuring GitHub Pages.');
      return 'first-publication';
    }
    if(!response.ok) throw Error(`Cannot verify existing feed (HTTP ${response.status})`);
    const size=Number(response.headers.get('content-length')||0);
    if(size>65536) throw Error('Existing feed too large');
    if (!response.body) throw Error('Existing feed body is missing');
    const reader=response.body.getReader();
    const chunks=[]; let total=0;
    while (true) {
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>65536) { await reader.cancel(); throw Error('Existing feed too large'); }
      chunks.push(Buffer.from(value));
    }
    const text=Buffer.concat(chunks,total).toString('utf8');
    const old=JSON.parse(text);
    if (!old || typeof old !== 'object' || !/^[a-f0-9]{64}$/i.test(old.checksum) || typeof old.url !== 'string' || !old.url.startsWith('https://')) throw Error('Existing release feed is malformed; refusing publication');
    if(compare(next,old.version)<=0) throw Error(`Refusing to publish ${next}: current public version is ${old.version}`);
    return old.version;
  } finally {clearTimeout(timer);}
}
if(process.argv[1]?.endsWith('check-release-order.mjs')) {
  check(feed,incoming).then(result=>console.log('Release order checked:',result)).catch(error=>{console.error(error);process.exitCode=1;});
}
