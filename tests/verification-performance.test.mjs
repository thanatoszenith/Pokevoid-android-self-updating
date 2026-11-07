import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('archive verification uses larger streaming buffers and efficient hex conversion', () => {
  const source = read('native/ExternalGameStorage.java');
  assert.match(source, /byte\[\] b = new byte\[262144\]/);
  assert.match(source, /char\[\] hex = new char\[digest\.length \* 2\]/);
  assert.doesNotMatch(source, /String\.format\(Locale\.ROOT, "%02x"/);
});

test('staged assets do not individually force flash writes; metadata remains synced', () => {
  const source = read('native/ExternalGameStorage.java');
  const stage = source.slice(source.indexOf('public synchronized void stage('), source.indexOf('public synchronized void activate('));
  assert.doesNotMatch(stage, /out\.getFD\(\)\.sync\(\)/);
  const metadata = source.slice(source.indexOf('private static void write('), source.indexOf('public static boolean matches('));
  assert.match(metadata, /out\.getFD\(\)\.sync\(\)/);
});

test('resumable download uses larger streaming buffers', () => {
  assert.match(read('native/ResumableDownloadPlugin.java'), /byte\[\] buf = new byte\[262144\]/);
});
