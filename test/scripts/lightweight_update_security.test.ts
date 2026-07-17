import assert from 'node:assert/strict';
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const security = require('../../scripts/electron/lightweight-update-security.cjs') as {
  LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES: number;
  LIGHTWEIGHT_MAX_DOWNLOAD_BYTES: number;
  LIGHTWEIGHT_MAX_FILE_BYTES: number;
  LIGHTWEIGHT_MAX_PACKAGE_BYTES: number;
  assertSafeArchiveEntries(entries: Array<string | ArchiveEntry>): void;
  parseTrustedLightweightUpdatePublicKeys(value: unknown): Array<{ keyId: string; publicKey: unknown }>;
  assertLightweightManifestCompatibility(
    manifest: SignedManifest & { version: string; baseAppVersion: string; requires: { node: string } },
    options: {
      builtInVersion: string;
      currentVersion?: string;
      expectedVersion?: string;
      nodeVersion: string;
      requireNewer?: boolean;
    },
  ): void;
  assertTrustedLightweightUpdateUrl(value: string): URL;
  parseLightweightUpdatePublicKey(value: string): unknown;
  createSignedLightweightManifest(options: ManifestOptions): Promise<SignedManifest>;
  verifyLightweightPackage(
    rootDir: string,
    publicKey: unknown,
    options?: { allowInstalledFiles?: boolean; nodeModulesTarget?: string },
  ): Promise<SignedManifest>;
};

interface ArchiveEntry {
  path: string;
  size?: number;
  isDirectory?: boolean;
  isSymbolicLink?: boolean;
}

interface ManifestOptions {
  rootDir: string;
  privateKey: string;
  version: string;
  builtAt: string;
  baseAppVersion: string;
  entry: string;
  requires: { node: string };
}

interface SignedManifest {
  schemaVersion: number;
  kind: string;
  files: Array<{ path: string; size: number; sha256: string }>;
  signature: { algorithm: string; keyId: string; value: string };
  version: string;
  baseAppVersion: string;
  requires: { node: string };
}

test('signed lightweight manifests are deterministic and verify the complete package', async (t) => {
  const rootDir = createPackageFixture(t);
  const { privateKey, publicKey } = generateSigningKeys();
  const options = manifestOptions(rootDir, privateKey);

  const first = await security.createSignedLightweightManifest(options);
  const second = await security.createSignedLightweightManifest(options);

  assert.deepEqual(second, first);
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.kind, 'codexbridge-lightweight-update');
  assert.equal(first.signature.algorithm, 'ed25519');
  assert.match(first.signature.keyId, /^[a-f0-9]{64}$/u);
  assert.ok(first.signature.value.length > 0);
  assert.doesNotMatch(JSON.stringify(first), /BEGIN (?:ED25519 )?PRIVATE KEY/iu);
  assert.deepEqual(first.files.map((file) => file.path), [
    'package.json',
    'scripts/service/run-weixin-service.mjs',
    'src/cli.ts',
  ]);

  writeManifest(rootDir, first);
  const verified = await security.verifyLightweightPackage(rootDir, publicKey);
  assert.deepEqual(verified, first);
});

test('verification accepts any matching key from a trusted key ring', async (t) => {
  const rootDir = createPackageFixture(t);
  const firstKey = generateSigningKeys();
  const secondKey = generateSigningKeys();
  const manifest = await security.createSignedLightweightManifest(
    manifestOptions(rootDir, secondKey.privateKey),
  );
  writeManifest(rootDir, manifest);

  const keyRing = {
    schemaVersion: 1,
    keys: [
      { keyId: publicKeyId(firstKey.publicKey), publicKey: firstKey.publicKey },
      { keyId: publicKeyId(secondKey.publicKey), publicKey: secondKey.publicKey },
    ],
  };
  assert.equal(security.parseTrustedLightweightUpdatePublicKeys(keyRing).length, 2);
  await security.verifyLightweightPackage(rootDir, keyRing);

  await assert.rejects(
    security.verifyLightweightPackage(rootDir, [firstKey.publicKey]),
    /trusted key|signing key/iu,
  );
  assert.throws(
    () => security.parseTrustedLightweightUpdatePublicKeys({
      schemaVersion: 1,
      keys: [{ keyId: '0'.repeat(64), publicKey: secondKey.publicKey }],
    }),
    /key id|key|mismatch/iu,
  );
});

test('verification trust rejects Ed25519 private keys supplied as public keys', async (t) => {
  const rootDir = createPackageFixture(t);
  const { privateKey } = generateSigningKeys();
  const manifest = await security.createSignedLightweightManifest(
    manifestOptions(rootDir, privateKey),
  );
  writeManifest(rootDir, manifest);

  assert.throws(
    () => security.parseLightweightUpdatePublicKey(privateKey),
    /public key|private key/iu,
  );
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, privateKey),
    /public key|private key/iu,
  );
});

test('manifest compatibility binds signed code to release, base app, and Node versions', async (t) => {
  const rootDir = createPackageFixture(t);
  const { privateKey } = generateSigningKeys();
  const options = manifestOptions(rootDir, privateKey);
  options.baseAppVersion = '0.1.6';
  const manifest = await security.createSignedLightweightManifest(options) as SignedManifest;

  security.assertLightweightManifestCompatibility(manifest, {
    builtInVersion: '0.1.6',
    currentVersion: '0.1.6',
    expectedVersion: '0.1.7',
    nodeVersion: '24.9.0',
    requireNewer: true,
  });
  for (const incompatible of [
    { expectedVersion: '0.1.8' },
    { builtInVersion: '0.1.5' },
    { currentVersion: '0.1.8' },
    { nodeVersion: '22.0.0' },
  ]) {
    assert.throws(
      () => security.assertLightweightManifestCompatibility(manifest, {
        builtInVersion: '0.1.6',
        currentVersion: '0.1.6',
        expectedVersion: '0.1.7',
        nodeVersion: '24.9.0',
        requireNewer: true,
        ...incompatible,
      }),
      /version|release|base|node|newer|compatible/iu,
    );
  }

  await assert.rejects(
    security.createSignedLightweightManifest({ ...options, version: 'version-seven' }),
    /version/iu,
  );
});

test('package verification rejects changed and missing signed files', async (t) => {
  const rootDir = createPackageFixture(t);
  const { privateKey, publicKey } = generateSigningKeys();
  const manifest = await security.createSignedLightweightManifest(
    manifestOptions(rootDir, privateKey),
  );
  writeManifest(rootDir, manifest);

  fs.writeFileSync(path.join(rootDir, 'src', 'cli.ts'), 'tampered\n', 'utf8');
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey),
    /digest|sha-?256|hash|changed|tamper/iu,
  );

  fs.rmSync(path.join(rootDir, 'src', 'cli.ts'));
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey),
    /missing|file tree|manifest/iu,
  );
});

test('package verification rejects unsigned manifests and unexpected files', async (t) => {
  const rootDir = createPackageFixture(t);
  const { privateKey, publicKey } = generateSigningKeys();
  const manifest = await security.createSignedLightweightManifest(
    manifestOptions(rootDir, privateKey),
  );

  writeManifest(rootDir, { ...manifest, signature: undefined });
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey),
    /signature|schema|unsigned/iu,
  );

  writeManifest(rootDir, manifest);
  fs.writeFileSync(path.join(rootDir, 'unexpected.ts'), 'export {};\n', 'utf8');
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey),
    /unexpected|extra|file tree/iu,
  );
});

test('package verification only permits activation metadata and the trusted dependency link', async (t) => {
  const rootDir = createPackageFixture(t);
  const trustedNodeModules = fs.mkdtempSync(
    path.join(os.tmpdir(), 'codexbridge-lightweight-node-modules-'),
  );
  t.after(() => fs.rmSync(trustedNodeModules, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateSigningKeys();
  const manifest = await security.createSignedLightweightManifest(
    manifestOptions(rootDir, privateKey),
  );
  writeManifest(rootDir, manifest);
  fs.writeFileSync(path.join(rootDir, '.installed.json'), '{}\n', 'utf8');
  fs.mkdirSync(path.join(rootDir, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'node_modules', 'runtime.txt'), 'linked runtime\n', 'utf8');

  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey),
    /unexpected|extra|file tree/iu,
  );
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey, { allowInstalledFiles: true }),
    /node_modules|directory link|symbolic/iu,
  );
  fs.rmSync(path.join(rootDir, 'node_modules'), { recursive: true, force: true });
  fs.symlinkSync(
    rootDir,
    path.join(rootDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    security.verifyLightweightPackage(rootDir, publicKey, {
      allowInstalledFiles: true,
      nodeModulesTarget: trustedNodeModules,
    }),
    /node_modules|target|directory link/iu,
  );
  removeDirectoryLink(path.join(rootDir, 'node_modules'));
  fs.symlinkSync(
    trustedNodeModules,
    path.join(rootDir, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await security.verifyLightweightPackage(rootDir, publicKey, {
    allowInstalledFiles: true,
    nodeModulesTarget: trustedNodeModules,
  });
});

test('archive validation rejects traversal, absolute, duplicate, and symbolic-link entries', () => {
  for (const unsafePath of [
    '../escape.ts',
    'src/../escape.ts',
    '/absolute.ts',
    'C:/absolute.ts',
    'src\\windows-path.ts',
    'src/./dot.ts',
    'src/\0nul.ts',
  ]) {
    assert.throws(
      () => security.assertSafeArchiveEntries([unsafePath]),
      /archive|path|unsafe|invalid/iu,
      unsafePath,
    );
  }

  assert.throws(
    () => security.assertSafeArchiveEntries(['src/cli.ts', 'SRC/CLI.TS']),
    /duplicate/iu,
  );
  assert.throws(
    () => security.assertSafeArchiveEntries([
      { path: 'src/link.ts', size: 10, isSymbolicLink: true },
    ]),
    /symbolic|symlink|link/iu,
  );
});

test('archive validation enforces entry and uncompressed-size limits', () => {
  assert.throws(
    () => security.assertSafeArchiveEntries(
      Array.from(
        { length: security.LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES + 1 },
        (_, index) => `src/file-${index}.ts`,
      ),
    ),
    /entries|entry count|too many/iu,
  );
  assert.throws(
    () => security.assertSafeArchiveEntries([
      { path: 'src/large.ts', size: security.LIGHTWEIGHT_MAX_FILE_BYTES + 1 },
    ]),
    /file|size|large|limit/iu,
  );
  assert.throws(
    () => security.assertSafeArchiveEntries([
      { path: 'a.bin', size: security.LIGHTWEIGHT_MAX_FILE_BYTES },
      { path: 'b.bin', size: security.LIGHTWEIGHT_MAX_FILE_BYTES },
      { path: 'c.bin', size: security.LIGHTWEIGHT_MAX_FILE_BYTES },
      { path: 'd.bin', size: security.LIGHTWEIGHT_MAX_FILE_BYTES },
      { path: 'e.bin', size: 1 },
    ]),
    /package|total|size|limit/iu,
  );
  assert.equal(security.LIGHTWEIGHT_MAX_DOWNLOAD_BYTES, 64 * 1024 * 1024);
  assert.equal(security.LIGHTWEIGHT_MAX_PACKAGE_BYTES, 256 * 1024 * 1024);
});

test('trusted lightweight URLs require HTTPS and an approved GitHub host', () => {
  for (const trustedUrl of [
    'https://api.github.com/repos/gouyu-hou/CodexBridge-Weixin/releases/latest',
    'https://github.com/gouyu-hou/CodexBridge-Weixin/releases/download/v1/update.zip',
    'https://release-assets.githubusercontent.com/github-production-release-asset/update.zip',
    'https://objects.githubusercontent.com/github-production-release-asset/update.zip',
  ]) {
    assert.equal(
      security.assertTrustedLightweightUpdateUrl(trustedUrl).toString(),
      trustedUrl,
    );
  }

  for (const untrustedUrl of [
    'http://github.com/gouyu-hou/CodexBridge-Weixin/update.zip',
    'https://example.com/update.zip',
    'https://github.com.evil.example/update.zip',
    'https://user:secret@github.com/update.zip',
    'https://github.com:444/update.zip',
  ]) {
    assert.throws(
      () => security.assertTrustedLightweightUpdateUrl(untrustedUrl),
      /trusted|https|github|url|host|port|credentials/iu,
      untrustedUrl,
    );
  }
});

test('lightweight package builder requires an external signing key and emits a signed manifest', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'electron', 'build-lightweight-update.cjs'),
    'utf8',
  );

  assert.match(source, /CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE/u);
  assert.match(source, /CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION/u);
  assert.match(source, /createSignedLightweightManifest/u);
  assert.match(source, /fsp\.readFile\(signingPrivateKeyFile,\s*['"]utf8['"]\)/u);
  assert.match(source, /fsp\.realpath\(/u);
  assert.match(source, /isPathInside\(rootDir,\s*signingPrivateKeyFile\)/u);
  assert.match(source, /privateKey:\s*signingPrivateKey/u);
  assert.match(source, /fsp\.rm\(manifestPath,\s*\{\s*force:\s*true\s*\}\)/u);
  assert.match(source, /ZipFileExtensions\]::CreateEntryFromFile/u);
  assert.match(source, /Replace\(\[char\]92,\s*\[char\]47\)/u);
  assert.doesNotMatch(source, /Compress-Archive/u);
  assert.match(source, /fsp\.lstat\(source\)/u);
  assert.match(source, /isSymbolicLink\(\)/u);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:signingPrivateKey|signingPrivateKeyFile)/u);
});

test('Electron lightweight updater enforces trust, bounds, archive safety, and package verification', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'electron', 'weixin-admin-main.cjs'),
    'utf8',
  );

  assert.match(source, /const http = require\(['"]node:http['"]\)/u);
  assert.match(source, /function requestJson[\s\S]+http\.request\(/u);

  for (const requiredSymbol of [
    'LIGHTWEIGHT_MAX_DOWNLOAD_BYTES',
    'LIGHTWEIGHT_MAX_REDIRECTS',
    'assertSafeArchiveEntries',
    'assertTrustedLightweightUpdateUrl',
    'verifyLightweightPackage',
  ]) {
    assert.match(source, new RegExp(`\\b${requiredSymbol}\\b`, 'u'));
  }
  for (const trustSource of [
    'CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEYS',
    'CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY',
    'CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEY_FILE',
    "assets', 'update', 'lightweight-public-keys.json",
    "assets', 'update', 'lightweight-public-key.pem",
  ]) {
    assert.ok(source.includes(trustSource), trustSource);
  }
  const publicKeyResolverSource = source.slice(
    source.indexOf('function resolveLightweightUpdatePublicKey()'),
    source.indexOf('async function installLightweightUpdateFromPath('),
  );
  assert.match(publicKeyResolverSource, /parseTrustedLightweightUpdatePublicKeys\(/u);
  assert.match(publicKeyResolverSource, /parseConfiguredLightweightUpdateKeys\(/u);

  const checkUpdateSource = source.slice(
    source.indexOf('async function checkLightweightUpdate()'),
    source.indexOf('async function downloadAndInstallLightweightUpdate()'),
  );
  assert.ok(
    checkUpdateSource.indexOf('resolveLightweightUpdatePublicKey()')
      < checkUpdateSource.indexOf('fetchJson('),
    'public-key trust must be resolved before the first network request',
  );

  const requestSource = source.slice(
    source.indexOf('function requestBuffer('),
    source.indexOf('function findLightweightPackageRoot('),
  );
  assert.match(requestSource, /assertTrustedLightweightUpdateUrl\(/u);
  assert.match(requestSource, /redirectCount\s*>=\s*LIGHTWEIGHT_MAX_REDIRECTS/u);
  assert.match(requestSource, /transferred\s*>\s*maxBytes/u);
  assert.match(
    requestSource,
    /response\.headers\[['"]content-length['"]\][\s\S]{0,120}total\s*>\s*maxBytes/iu,
  );
  assert.match(requestSource, /total\s*>\s*maxBytes[\s\S]{0,180}response\.destroy\(/u);

  const downloadSource = source.slice(
    source.indexOf('async function downloadAndInstallLightweightUpdate()'),
    source.indexOf('function extractLightweightVersion('),
  );
  assert.ok(
    downloadSource.indexOf('resolveLightweightUpdatePublicKey()')
      < downloadSource.indexOf('downloadFile('),
    'public-key trust must be resolved again before downloading an update',
  );
  assert.match(downloadSource, /expectedVersion:\s*lightweightUpdateState\.latestVersion/u);

  const extractionSource = source.slice(
    source.indexOf('async function extractZipArchive('),
    source.indexOf('function quotePowerShell('),
  );
  assert.ok(
    extractionSource.indexOf('assertSafeArchiveEntries(')
      < extractionSource.indexOf('$input = $entry.Open()'),
    'archive entries must be validated before extraction',
  );
  assert.doesNotMatch(extractionSource, /Expand-Archive|spawnSync\(['"]unzip['"]/u);
  assert.match(extractionSource, /\.Open\(\)/u);
  assert.match(extractionSource, /fileBytes\s*-gt\s*\$maxFileBytes/u);
  assert.match(extractionSource, /totalBytes\s*-gt\s*\$maxPackageBytes/u);
  assert.match(
    extractionSource,
    /ConvertTo-Json[\s\S]+\.join\(['"]\\n['"]\)/u,
    'PowerShell archive-inspection blocks must preserve newlines',
  );

  assert.match(source, /await verifyLightweightPackage\(packageRoot,\s*publicKey\)/u);
  assert.match(source, /await verifyLightweightPackage\(nextDir,\s*publicKey\)/u);
  for (const historySymbol of [
    'LightweightUpdateHistoryStore',
    "history.json",
    "action: 'verify'",
    "action: 'install'",
    "action: 'failure'",
    "action: 'rollback'",
  ]) {
    assert.ok(source.includes(historySymbol), historySymbol);
  }
  assert.match(
    source,
    /verifyLightweightPackage\(lightweightCurrentDir,\s*publicKey,\s*\{[\s\S]{0,160}allowInstalledFiles:\s*true,[\s\S]{0,160}nodeModulesTarget:\s*path\.join\(ROOT_DIR,\s*['"]node_modules['"]\)/u,
  );
  assert.match(source, /maxBytes:\s*LIGHTWEIGHT_MAX_DOWNLOAD_BYTES/u);
  assert.match(source, /assertLightweightManifestCompatibility\(/u);
  assert.match(source, /nodeVersion:\s*process\.versions\.node/u);
  assert.doesNotMatch(source, /if \(activeLightweightRootChecked\)\s*\{\s*return;/u);
  assert.match(
    source,
    /已安装的轻量更新验证失败[\s\S]{0,500}stopExistingProjectNodeServices\(\)[\s\S]{0,500}rollbackLightweightCurrent/u,
  );
  const activeRootVerificationSource = source.slice(
    source.indexOf('async function ensureActiveLightweightRootVerified()'),
    source.indexOf('function isValidLightweightRoot('),
  );
  assert.match(
    activeRootVerificationSource,
    /catch \(error\)[\s\S]{0,350}stopService\(['"]lightweight-trust-invalid['"]\)[\s\S]{0,350}stopExistingProjectNodeServices\(\)/u,
  );
  assert.match(
    activeRootVerificationSource,
    /assertLightweightManifestCompatibility[\s\S]{0,500}stopService\(['"]lightweight-runtime-revalidation['"]\)[\s\S]{0,350}activeRuntimeRootDir\s*=\s*lightweightCurrentDir/u,
  );
  const startupSource = source.slice(
    source.indexOf('async function startOrAttachService('),
    source.indexOf('function createMainWindow('),
  );
  assert.match(
    startupSource,
    /resolveActiveRootDir\(\)\s*!==\s*ROOT_DIR[\s\S]{0,400}stopService\(['"]lightweight-startup-failed['"]\)[\s\S]{0,400}rollbackLightweightCurrent/u,
  );
});

function createPackageFixture(t: { after(callback: () => void): void }): string {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-lightweight-security-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(rootDir, 'scripts', 'service'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'cli.ts'), 'export const cli = true;\n', 'utf8');
  fs.writeFileSync(
    path.join(rootDir, 'scripts', 'service', 'run-weixin-service.mjs'),
    'export {};\n',
    'utf8',
  );
  fs.writeFileSync(path.join(rootDir, 'package.json'), '{"name":"fixture"}\n', 'utf8');
  return rootDir;
}

function generateSigningKeys(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function publicKeyId(publicKey: string): string {
  return createHash('sha256')
    .update(createPublicKey(publicKey).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}

function manifestOptions(rootDir: string, privateKey: string): ManifestOptions {
  return {
    rootDir,
    privateKey,
    version: '0.1.7',
    builtAt: '2026-07-16T00:00:00.000Z',
    baseAppVersion: '0.1.7',
    entry: 'src/cli.ts',
    requires: { node: '>=24' },
  };
}

function writeManifest(rootDir: string, manifest: unknown): void {
  fs.writeFileSync(
    path.join(rootDir, 'codexbridge-lightweight.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
}

function removeDirectoryLink(linkPath: string): void {
  if (process.platform === 'win32') {
    fs.rmdirSync(linkPath);
    return;
  }
  fs.unlinkSync(linkPath);
}
