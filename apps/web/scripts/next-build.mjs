import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = path.join(webRoot, 'node_modules', 'next', 'dist', 'bin', 'next');
const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: webRoot,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
});

process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
if (
  output.includes('whole project was traced unintentionally')
  || output.includes('Encountered unexpected file in NFT list')
) {
  console.error('Next.js output tracing boundary check failed.');
  process.exit(1);
}
