import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const script = fileURLToPath(new URL('../scripts/verify-bootstrap.mjs',import.meta.url));
function check(files) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pokevoid-bootstrap-'));
  try {
    for(const [name,content] of Object.entries(files)) {const target=path.join(dir,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);}
    return {ok:true,output:execFileSync(process.execPath,[script,dir],{encoding:'utf8'})};
  } catch(error) {return {ok:false,output:String(error.stderr||error.message)};}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const html='<title>PokéVoid</title><script type="module" src="/assets/index-abc.js"></script>';
test('accepts bootstrap HTML and JavaScript',()=>assert.equal(check({'index.html':html,'assets/index-abc.js':'console.log(1)'}).ok,true));
test('rejects HTML without JavaScript bundle',()=>assert.equal(check({'index.html':html}).ok,false));
test('rejects embedded game asset',()=>assert.equal(check({'index.html':html,'assets/index-abc.js':'','images/sprite.png':''}).ok,false));
test('rejects externally hosted bootstrap scripts',()=>assert.equal(check({'index.html':'<title>PokéVoid</title><script src="https://example.com/x.js"></script>','assets/index-abc.js':''}).ok,false));
