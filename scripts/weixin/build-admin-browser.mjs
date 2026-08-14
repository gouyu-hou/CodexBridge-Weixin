import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const rootDir = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

export const ADMIN_BROWSER_ENTRY = 'src/platforms/weixin/admin_app/main.tsx';

export async function buildAdminBrowser({
  outputDir = path.join(rootDir, 'assets', 'weixin-admin'),
} = {}) {
  const resolvedOutputDir = path.resolve(outputDir);
  await build({
    configFile: path.join(rootDir, 'vite.admin.config.ts'),
    build: {
      outDir: resolvedOutputDir,
    },
  });

  const [js, css] = await Promise.all([
    fs.readFile(path.join(resolvedOutputDir, 'admin.js'), 'utf8'),
    fs.readFile(path.join(resolvedOutputDir, 'admin.css'), 'utf8'),
  ]);
  return { css: normalizeAsset(css), js: normalizeAsset(js) };
}

function normalizeAsset(source) {
  return source.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n');
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';
if (import.meta.url === invokedPath) {
  buildAdminBrowser()
    .then(() => {
      process.stdout.write('Built assets/weixin-admin/admin.js and admin.css\n');
    })
    .catch((error) => {
      process.stderr.write(`Weixin admin React build failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
