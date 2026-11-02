import { spawnSync } from 'node:child_process';
export function zipFixture(args, options = {}) {
  const [flag, target, ...files] = args;
  if (flag !== '-q') throw new Error('Unexpected ZIP fixture arguments');
  return spawnSync(process.env.PYTHON || 'python', ['-c', 'import sys, zipfile; z=zipfile.ZipFile(sys.argv[1], "w"); [z.write(p,p) for p in sys.argv[2:]]; z.close()', target, ...files], options);
}
