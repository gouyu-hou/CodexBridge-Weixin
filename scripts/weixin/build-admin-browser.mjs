import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceDir = path.join(rootDir, 'src', 'platforms', 'weixin', 'admin_browser');

export const ADMIN_BROWSER_SOURCES = Object.freeze([
  '00_bootstrap.js',
]);

export async function buildAdminBrowser({
  outputPath = path.join(rootDir, 'assets', 'weixin-admin', 'admin.js'),
} = {}) {
  const parts = await Promise.all(ADMIN_BROWSER_SOURCES.map(async (filename) => {
    const source = await fs.readFile(path.join(sourceDir, filename), 'utf8');
    return normalizeSource(source);
  }));
  const output = `${parts.join('\n')}\n`;
  const resolvedOutputPath = path.resolve(outputPath);
  const tempPath = `${resolvedOutputPath}.tmp-${process.pid}`;
  await fs.mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  try {
    await fs.writeFile(tempPath, output, 'utf8');
    await fs.rename(tempPath, resolvedOutputPath);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
  return output;
}

function normalizeSource(source) {
  return source
    .replace(/^\uFEFF/u, '')
    .replace(/\r\n/gu, '\n')
    .replace(/\n+$/u, '');
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  buildAdminBrowser()
    .then(() => {
      process.stdout.write('Built assets/weixin-admin/admin.js\n');
    })
    .catch((error) => {
      process.stderr.write(`Weixin admin browser build failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
