const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  LIGHTWEIGHT_MANIFEST_NAME,
  createSignedLightweightManifest,
} = require('./lightweight-update-security.cjs');

const rootDir = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const version = String(packageJson.version || '0.0.0');
const baseAppVersion = String(
  process.env.CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION || version,
).trim();
const outputRoot = path.join(rootDir, 'release', 'lightweight');
const packageName = `CodexBridge-Lightweight-${version}`;
const packageDir = path.join(outputRoot, packageName);
const zipPath = `${packageDir}.zip`;

const includeRoots = [
  'assets',
  'config',
  'packages',
  'scripts',
  'src',
  'package.json',
  'tsconfig.json',
  'tsconfig.checkjs.json',
  'README.md',
  'LICENSE',
];

const ignoredSegments = new Set([
  '.git',
  '.github',
  'node_modules',
  'release',
  'CodexBridgeData',
  'test',
  'reports',
  'reference',
  'BuildTemp',
]);

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

async function main() {
  const signingPrivateKeyFileValue = String(
    process.env.CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE || '',
  ).trim();
  if (!signingPrivateKeyFileValue) {
    throw new Error(
      'CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE is required to build a lightweight update.',
    );
  }
  let signingPrivateKeyFile;
  let signingPrivateKey;
  try {
    signingPrivateKeyFile = await fsp.realpath(path.resolve(signingPrivateKeyFileValue));
    if (isPathInside(rootDir, signingPrivateKeyFile)) {
      throw new Error('signing key is inside the repository');
    }
    signingPrivateKey = await fsp.readFile(signingPrivateKeyFile, 'utf8');
  } catch {
    throw new Error('Unable to read the configured lightweight update signing key.');
  }

  await fsp.rm(packageDir, { recursive: true, force: true });
  await fsp.rm(zipPath, { force: true });
  await fsp.mkdir(packageDir, { recursive: true });

  for (const relativePath of includeRoots) {
    const source = path.join(rootDir, relativePath);
    if (!fs.existsSync(source)) {
      continue;
    }
    await copyEntry(source, path.join(packageDir, relativePath));
  }

  const manifestPath = path.join(packageDir, LIGHTWEIGHT_MANIFEST_NAME);
  await fsp.rm(manifestPath, { force: true });
  const manifest = await createSignedLightweightManifest({
    rootDir: packageDir,
    privateKey: signingPrivateKey,
    version,
    builtAt: new Date().toISOString(),
    baseAppVersion,
    entry: 'src/cli.ts',
    requires: {
      node: packageJson.engines?.node || '>=24',
    },
  });
  await fsp.writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  await createZip(packageDir, zipPath);
  console.log(`Lightweight package directory: ${packageDir}`);
  if (fs.existsSync(zipPath)) {
    console.log(`Lightweight package zip: ${zipPath}`);
  }
}

async function copyEntry(source, target) {
  const stat = await fsp.lstat(source);
  if (stat.isSymbolicLink()) {
    throw new Error('Lightweight package source must not contain symbolic links.');
  }
  if (stat.isDirectory()) {
    await fsp.mkdir(target, { recursive: true });
    const entries = await fsp.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const childSource = path.join(source, entry.name);
      const relative = path.relative(rootDir, childSource);
      if (shouldIgnore(relative)) {
        continue;
      }
      await copyEntry(childSource, path.join(target, entry.name));
    }
    return;
  }
  if (stat.isFile()) {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source, target);
  }
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === ''
    || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function shouldIgnore(relativePath) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.some((part) => ignoredSegments.has(part))) {
    return true;
  }
  const normalized = relativePath.replace(/\\/gu, '/');
  return /(?:^|\/)(?:.*\.log|.*\.tmp|.*\.map)$/iu.test(normalized);
}

async function createZip(sourceDir, targetZip) {
  if (process.platform === 'win32') {
    const command = [
      '$ErrorActionPreference = "Stop"',
      'Add-Type -AssemblyName System.IO.Compression',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$sourceRoot = [System.IO.Path]::GetFullPath(${quotePowerShell(sourceDir)})`,
      `$archive = [System.IO.Compression.ZipFile]::Open(${quotePowerShell(targetZip)}, [System.IO.Compression.ZipArchiveMode]::Create)`,
      'try {',
      '  Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | ForEach-Object {',
      '    $relative = $_.FullName.Substring($sourceRoot.Length).TrimStart([char]92, [char]47).Replace([char]92, [char]47)',
      '    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null',
      '  }',
      '} finally { $archive.Dispose() }',
    ].join('\n');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: rootDir,
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout || 'Failed to create lightweight zip.');
    }
    return;
  }
  const result = spawnSync('zip', ['-qr', targetZip, '.'], {
    cwd: sourceDir,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create lightweight zip.');
  }
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/gu, "''")}'`;
}
