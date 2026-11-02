import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test('real JVM installer: hashes, ZIP safety, crash recovery, confirmation and bounded caches', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokevoid-jvm-'));
  try {
    const compile = spawnSync(process.env.JAVAC || 'javac', ['-d', dir, 'native/ExternalGameStorage.java', 'native/DownloadCache.java', 'native/TrustedGameOrigin.java', 'tests/java/ExternalGameStorageTest.java'], {encoding:'utf8'});
    assert.equal(compile.status, 0, compile.error?.message || compile.stderr);
    const run = spawnSync(process.env.JAVA || 'java', ['-cp', dir, 'com.zenni.pokevoid.ExternalGameStorageTest'], {encoding:'utf8'});
    assert.equal(run.status, 0, run.stderr);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
