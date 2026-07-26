const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  collectProductionPackagePaths,
  shouldCopyRuntimePath,
} = require('./runtime-stage.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const outputDir = path.join(rootDir, 'build', 'runtime', 'node');
const outputNode = path.join(outputDir, 'node.exe');
const runtimeAppDir = path.join(rootDir, 'build', 'runtime', 'app');
const runtimeSourceEntries = [
  'assets',
  'config',
  'packages',
  path.join('scripts', 'service', 'run-weixin-service.mjs'),
  'src',
  'package.json',
  'tsconfig.json',
];

async function main() {
  if (process.platform !== 'win32') {
    console.log('Windows runtime preparation skipped on non-Windows host.');
    return;
  }
  const sourceNode = process.execPath;
  if (!fs.existsSync(sourceNode)) {
    throw new Error(`Current node.exe was not found: ${sourceNode}`);
  }
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.copyFile(sourceNode, outputNode);
  await fsp.writeFile(
    path.join(outputDir, 'README.txt'),
    [
      'Bundled Node.js runtime for CodexBridge Weixin Admin.',
      `Source: ${sourceNode}`,
      `Prepared: ${new Date().toISOString()}`,
      '',
    ].join('\r\n'),
    'utf8',
  );
  await stageRuntimeApp();
  console.log(`Prepared runtime: ${outputNode}`);
  console.log(`Prepared service app: ${runtimeAppDir}`);
}

async function stageRuntimeApp() {
  await fsp.rm(runtimeAppDir, { recursive: true, force: true });
  for (const relativePath of runtimeSourceEntries) {
    const source = path.join(rootDir, relativePath);
    const target = path.join(runtimeAppDir, relativePath);
    await fsp.cp(source, target, {
      recursive: true,
      filter: shouldCopyRuntimeSource,
    });
  }

  const packageLock = JSON.parse(
    await fsp.readFile(path.join(rootDir, 'package-lock.json'), 'utf8'),
  );
  const packagePaths = collectProductionPackagePaths(packageLock);
  for (const relativePath of packagePaths) {
    if (!shouldCopyRuntimePath(relativePath)) {
      continue;
    }
    const source = path.join(rootDir, relativePath);
    const target = path.join(runtimeAppDir, relativePath);
    await fsp.cp(source, target, {
      recursive: true,
      filter: (entry) => shouldCopyPackageEntry(source, entry),
    });
  }
}

function shouldCopyRuntimeSource(sourcePath) {
  const relative = path.relative(rootDir, sourcePath).replace(/\\/gu, '/');
  return !/(?:^|\/)(?:dist|test)(?:\/|$)/u.test(relative)
    && !/\.(?:map|tsbuildinfo)$/iu.test(relative);
}

function shouldCopyPackageEntry(packageRoot, sourcePath) {
  const packageRelative = path.relative(packageRoot, sourcePath).replace(/\\/gu, '/');
  if (packageRelative && /(?:^|\/)node_modules(?:\/|$)/u.test(packageRelative)) {
    return false;
  }
  const rootRelative = path.relative(rootDir, sourcePath);
  return shouldCopyRuntimePath(rootRelative);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
