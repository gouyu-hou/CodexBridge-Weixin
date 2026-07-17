const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const LIGHTWEIGHT_MANIFEST_NAME = 'codexbridge-lightweight.json';
const LIGHTWEIGHT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES = 5_000;
const LIGHTWEIGHT_MAX_FILE_BYTES = 64 * 1024 * 1024;
const LIGHTWEIGHT_MAX_PACKAGE_BYTES = 256 * 1024 * 1024;
const LIGHTWEIGHT_MAX_REDIRECTS = 5;
const LIGHTWEIGHT_MAX_MANIFEST_BYTES = 1024 * 1024;
const LIGHTWEIGHT_KIND = 'codexbridge-lightweight-update';
const TRUSTED_UPDATE_HOSTS = new Set([
  'api.github.com',
  'github.com',
  'github-releases.githubusercontent.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/**
 * @typedef {{ path: string, size: number, sha256: string }} LightweightFile
 * @typedef {{
 *   schemaVersion: 2,
 *   kind: string,
 *   version: string,
 *   builtAt: string,
 *   baseAppVersion: string,
 *   entry: string,
 *   requires: { node: string },
 *   files: LightweightFile[],
 * }} LightweightManifestPayload
 * @typedef {{ keyId: string, publicKey: crypto.KeyObject }} TrustedLightweightUpdateKey
 * @typedef {LightweightManifestPayload & {
 *   signature: { algorithm: 'ed25519', keyId: string, value: string },
 * }} SignedLightweightManifest
 */

/**
 * @param {{
 *   rootDir: string,
 *   privateKey: string | Buffer | crypto.KeyObject,
 *   version: string,
 *   builtAt: string,
 *   baseAppVersion: string,
 *   entry: string,
 *   requires: { node: string },
 * }} options
 * @returns {Promise<SignedLightweightManifest>}
 */
async function createSignedLightweightManifest(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Lightweight manifest options are required.');
  }
  const rootDir = requireRootDirectory(options.rootDir);
  const privateKey = parsePrivateKey(options.privateKey);
  const publicKey = crypto.createPublicKey(privateKey);
  const entry = assertSafeRelativePath(options.entry, 'manifest entry');
  const files = await collectPackageFiles(rootDir);
  if (!files.some((file) => file.path === entry)) {
    throw new Error(`Manifest entry is missing from the package: ${entry}`);
  }

  const payload = normalizeManifestPayload({
    schemaVersion: 2,
    kind: LIGHTWEIGHT_KIND,
    version: options.version,
    builtAt: options.builtAt,
    baseAppVersion: options.baseAppVersion,
    entry,
    requires: options.requires,
    files,
  });
  const signature = crypto.sign(
    null,
    Buffer.from(canonicalJson(payload), 'utf8'),
    privateKey,
  );
  return {
    ...payload,
    signature: {
      algorithm: 'ed25519',
      keyId: getPublicKeyId(publicKey),
      value: signature.toString('base64'),
    },
  };
}

/**
 * @param {string} rootDir
 * @param {unknown} publicKeyValue
 * @param {{ allowInstalledFiles?: boolean, nodeModulesTarget?: string }} [options]
 * @returns {Promise<SignedLightweightManifest>}
 */
async function verifyLightweightPackage(rootDir, publicKeyValue, options = {}) {
  const resolvedRoot = requireRootDirectory(rootDir);
  const manifestPath = path.join(resolvedRoot, LIGHTWEIGHT_MANIFEST_NAME);
  const manifestStat = await safeLstat(manifestPath, 'Lightweight manifest is missing.');
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('Lightweight manifest must be a regular file.');
  }
  if (manifestStat.size > LIGHTWEIGHT_MAX_MANIFEST_BYTES) {
    throw new Error('Lightweight manifest exceeds the size limit.');
  }

  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('Lightweight manifest is not valid JSON.');
  }
  const manifest = normalizeSignedManifest(parsed);
  const trustedKeys = parseTrustedLightweightUpdatePublicKeys(publicKeyValue);
  const trustedKey = trustedKeys.find((entry) => entry.keyId === manifest.signature.keyId);
  if (!trustedKey) {
    throw new Error('Lightweight manifest signing key does not match a trusted key.');
  }

  const signature = decodeEd25519Signature(manifest.signature.value);
  const { signature: _signature, ...payload } = manifest;
  if (!crypto.verify(null, Buffer.from(canonicalJson(payload), 'utf8'), trustedKey.publicKey, signature)) {
    throw new Error('Lightweight manifest signature is invalid.');
  }

  const actualFiles = await collectPackageFiles(resolvedRoot, {
    allowInstalledFiles: options.allowInstalledFiles === true,
    nodeModulesTarget: options.nodeModulesTarget,
  });
  assertMatchingFileTrees(manifest.files, actualFiles);
  return manifest;
}

/**
 * @param {string} value
 * @returns {URL}
 */
function assertTrustedLightweightUpdateUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error('Lightweight update URL is invalid.');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Lightweight update URL is invalid.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Lightweight update URL must use HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Lightweight update URL must not contain credentials.');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Lightweight update URL must use the default HTTPS port.');
  }
  if (!TRUSTED_UPDATE_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Lightweight update URL is not on a trusted GitHub host.');
  }
  return parsed;
}

/**
 * @param {SignedLightweightManifest} manifest
 * @param {{
 *   builtInVersion: string,
 *   currentVersion?: string,
 *   expectedVersion?: string,
 *   nodeVersion: string,
 *   requireNewer?: boolean,
 * }} options
 */
function assertLightweightManifestCompatibility(manifest, options) {
  if (!manifest || typeof manifest !== 'object' || !options || typeof options !== 'object') {
    throw new TypeError('Lightweight compatibility options are required.');
  }
  const manifestVersion = requireReleaseVersion(manifest.version, 'manifest version');
  const baseAppVersion = requireReleaseVersion(manifest.baseAppVersion, 'base app version');
  const builtInVersion = requireReleaseVersion(options.builtInVersion, 'built-in app version');
  if (baseAppVersion !== builtInVersion) {
    throw new Error(
      `Lightweight package requires base app ${baseAppVersion}, but ${builtInVersion} is installed.`,
    );
  }

  if (options.expectedVersion !== undefined) {
    const expectedVersion = requireReleaseVersion(options.expectedVersion, 'expected release version');
    if (manifestVersion !== expectedVersion) {
      throw new Error('Lightweight package version does not match the selected Release asset.');
    }
  }

  const currentVersion = options.currentVersion === undefined
    ? builtInVersion
    : requireReleaseVersion(options.currentVersion, 'current app version');
  const versionComparison = compareReleaseVersions(manifestVersion, currentVersion);
  if (options.requireNewer === true ? versionComparison <= 0 : versionComparison < 0) {
    throw new Error(
      options.requireNewer === true
        ? 'Lightweight package version must be newer than the current version.'
        : 'Lightweight package version must not be older than the current version.',
    );
  }

  const requiredNode = parseNodeRequirement(manifest.requires?.node);
  const currentNode = parseNodeVersion(options.nodeVersion);
  if (compareNumericVersions(currentNode, requiredNode) < 0) {
    throw new Error(`Lightweight package requires Node.js ${manifest.requires.node}.`);
  }
}

/**
 * @param {Array<string | {
 *   path: string,
 *   size?: number,
 *   isDirectory?: boolean,
 *   isSymbolicLink?: boolean,
 * }>} entries
 */
function assertSafeArchiveEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Archive entries must be an array.');
  }
  if (entries.length > LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES) {
    throw new Error('Lightweight archive has too many entries.');
  }

  const seen = new Set();
  let totalSize = 0;
  for (const entry of entries) {
    const descriptor = typeof entry === 'string' ? { path: entry } : entry;
    if (!descriptor || typeof descriptor !== 'object') {
      throw new Error('Lightweight archive entry is invalid.');
    }
    const rawPath = descriptor.path;
    const isDirectory = descriptor.isDirectory === true || String(rawPath || '').endsWith('/');
    const normalizedPath = assertSafeRelativePath(
      isDirectory ? String(rawPath || '').replace(/\/+$/u, '') : rawPath,
      'archive entry path',
    );
    const duplicateKey = normalizedPath.toLowerCase();
    if (seen.has(duplicateKey)) {
      throw new Error(`Lightweight archive contains a duplicate path: ${normalizedPath}`);
    }
    seen.add(duplicateKey);
    if (descriptor.isSymbolicLink === true) {
      throw new Error(`Lightweight archive contains a symbolic link: ${normalizedPath}`);
    }

    const size = descriptor.size ?? 0;
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error(`Lightweight archive entry has an invalid size: ${normalizedPath}`);
    }
    if (isDirectory && size !== 0) {
      throw new Error(`Lightweight archive directory contains data: ${normalizedPath}`);
    }
    if (size > LIGHTWEIGHT_MAX_FILE_BYTES) {
      throw new Error(`Lightweight archive file exceeds the size limit: ${normalizedPath}`);
    }
    totalSize += size;
    if (totalSize > LIGHTWEIGHT_MAX_PACKAGE_BYTES) {
      throw new Error('Lightweight archive exceeds the total package size limit.');
    }
  }
}

/**
 * @param {string} rootDir
 * @param {{ allowInstalledFiles?: boolean, nodeModulesTarget?: string }} [options]
 * @returns {Promise<LightweightFile[]>}
 */
async function collectPackageFiles(rootDir, options = {}) {
  /** @type {LightweightFile[]} */
  const files = [];
  let entryCount = 0;
  let totalSize = 0;

  async function visit(currentDir, relativeDir) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(currentDir, entry.name);
      const stat = await fsp.lstat(fullPath);

      if (relativePath === LIGHTWEIGHT_MANIFEST_NAME) {
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Lightweight manifest path must be a regular file.');
        }
        continue;
      }
      if (options.allowInstalledFiles && relativePath === '.installed.json') {
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new Error('Installed lightweight metadata must be a regular file.');
        }
        continue;
      }
      if (options.allowInstalledFiles && relativePath === 'node_modules') {
        if (!stat.isSymbolicLink()) {
          throw new Error('Installed lightweight node_modules must be a directory link.');
        }
        if (typeof options.nodeModulesTarget !== 'string' || !options.nodeModulesTarget) {
          throw new Error('Trusted lightweight node_modules target is required.');
        }
        const trustedTargetStat = await safeLstat(
          path.resolve(options.nodeModulesTarget),
          'Trusted lightweight node_modules target does not exist.',
        );
        if (!trustedTargetStat.isDirectory() || trustedTargetStat.isSymbolicLink()) {
          throw new Error('Trusted lightweight node_modules target must be a regular directory.');
        }
        const [actualTarget, trustedTarget] = await Promise.all([
          fsp.realpath(fullPath),
          fsp.realpath(path.resolve(options.nodeModulesTarget)),
        ]);
        if (!pathsEqual(actualTarget, trustedTarget)) {
          throw new Error('Installed lightweight node_modules link has an unexpected target.');
        }
        continue;
      }

      entryCount += 1;
      if (entryCount > LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES) {
        throw new Error('Lightweight package has too many entries.');
      }
      const normalizedPath = assertSafeRelativePath(relativePath, 'package path');
      if (stat.isSymbolicLink()) {
        throw new Error(`Lightweight package contains a symbolic link: ${normalizedPath}`);
      }
      if (stat.isDirectory()) {
        await visit(fullPath, normalizedPath);
        continue;
      }
      if (!stat.isFile()) {
        throw new Error(`Lightweight package contains an unsupported entry: ${normalizedPath}`);
      }
      if (stat.size > LIGHTWEIGHT_MAX_FILE_BYTES) {
        throw new Error(`Lightweight package file exceeds the size limit: ${normalizedPath}`);
      }
      totalSize += stat.size;
      if (totalSize > LIGHTWEIGHT_MAX_PACKAGE_BYTES) {
        throw new Error('Lightweight package exceeds the total size limit.');
      }
      files.push({
        path: normalizedPath,
        size: stat.size,
        sha256: await hashFile(fullPath),
      });
    }
  }

  await visit(rootDir, '');
  files.sort(compareManifestFiles);
  assertNoDuplicatePaths(files.map((file) => file.path), 'manifest file');
  return files;
}

/**
 * @param {unknown} value
 * @returns {SignedLightweightManifest}
 */
function normalizeSignedManifest(value) {
  if (!isPlainObject(value)) {
    throw new Error('Lightweight manifest must be a JSON object.');
  }
  if (!Object.hasOwn(value, 'signature')) {
    throw new Error('Lightweight manifest signature is required.');
  }
  assertExactKeys(value, [
    'baseAppVersion',
    'builtAt',
    'entry',
    'files',
    'kind',
    'requires',
    'schemaVersion',
    'signature',
    'version',
  ], 'manifest');
  const payload = normalizeManifestPayload(value);
  const signature = value.signature;
  if (!isPlainObject(signature)) {
    throw new Error('Lightweight manifest signature is required.');
  }
  assertExactKeys(signature, ['algorithm', 'keyId', 'value'], 'manifest signature');
  if (signature.algorithm !== 'ed25519') {
    throw new Error('Lightweight manifest signature algorithm must be ed25519.');
  }
  const keyId = requirePatternString(signature.keyId, /^[a-f0-9]{64}$/u, 'signature key ID');
  const encodedSignature = requireNonEmptyString(signature.value, 'signature value', 256);
  decodeEd25519Signature(encodedSignature);
  return {
    ...payload,
    signature: {
      algorithm: 'ed25519',
      keyId,
      value: encodedSignature,
    },
  };
}

/**
 * @param {Record<string, unknown>} value
 * @returns {LightweightManifestPayload}
 */
function normalizeManifestPayload(value) {
  if (value.schemaVersion !== 2) {
    throw new Error('Lightweight manifest schema version 2 is required.');
  }
  if (value.kind !== LIGHTWEIGHT_KIND) {
    throw new Error('Lightweight manifest kind is invalid.');
  }
  const version = requireReleaseVersion(value.version, 'manifest version');
  const builtAt = requireIsoTimestamp(value.builtAt);
  const baseAppVersion = requireReleaseVersion(value.baseAppVersion, 'base app version');
  const entry = assertSafeRelativePath(value.entry, 'manifest entry');
  if (!isPlainObject(value.requires)) {
    throw new Error('Lightweight manifest requirements are invalid.');
  }
  assertExactKeys(value.requires, ['node'], 'manifest requirements');
  const requires = {
    node: requireNodeRequirement(value.requires.node),
  };
  if (!Array.isArray(value.files) || value.files.length === 0) {
    throw new Error('Lightweight manifest files are required.');
  }
  if (value.files.length > LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES) {
    throw new Error('Lightweight manifest has too many files.');
  }

  let totalSize = 0;
  const files = value.files.map((file, index) => {
    if (!isPlainObject(file)) {
      throw new Error(`Lightweight manifest file ${index} is invalid.`);
    }
    assertExactKeys(file, ['path', 'sha256', 'size'], `manifest file ${index}`);
    const filePath = assertSafeRelativePath(file.path, `manifest file ${index} path`);
    const fileSize = file.size;
    if (typeof fileSize !== 'number' || !Number.isSafeInteger(fileSize) || fileSize < 0) {
      throw new Error(`Lightweight manifest file has an invalid size: ${filePath}`);
    }
    if (fileSize > LIGHTWEIGHT_MAX_FILE_BYTES) {
      throw new Error(`Lightweight manifest file exceeds the size limit: ${filePath}`);
    }
    totalSize += fileSize;
    if (totalSize > LIGHTWEIGHT_MAX_PACKAGE_BYTES) {
      throw new Error('Lightweight manifest exceeds the total package size limit.');
    }
    return {
      path: filePath,
      size: fileSize,
      sha256: requirePatternString(file.sha256, /^[a-f0-9]{64}$/u, `SHA-256 for ${filePath}`),
    };
  });
  assertNoDuplicatePaths(files.map((file) => file.path), 'manifest file');
  for (let index = 1; index < files.length; index += 1) {
    if (compareManifestFiles(files[index - 1], files[index]) > 0) {
      throw new Error('Lightweight manifest files must be sorted by path.');
    }
  }
  if (!files.some((file) => file.path === entry)) {
    throw new Error(`Manifest entry is missing from the file list: ${entry}`);
  }
  return {
    schemaVersion: 2,
    kind: LIGHTWEIGHT_KIND,
    version,
    builtAt,
    baseAppVersion,
    entry,
    requires,
    files,
  };
}

/**
 * @param {LightweightFile[]} expected
 * @param {LightweightFile[]} actual
 */
function assertMatchingFileTrees(expected, actual) {
  if (expected.length !== actual.length) {
    throw new Error('Lightweight package file tree contains missing or unexpected files.');
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedFile = expected[index];
    const actualFile = actual[index];
    if (expectedFile.path !== actualFile.path) {
      throw new Error('Lightweight package file tree contains missing or unexpected files.');
    }
    if (expectedFile.size !== actualFile.size) {
      throw new Error(`Lightweight package file size changed: ${expectedFile.path}`);
    }
    if (expectedFile.sha256 !== actualFile.sha256) {
      throw new Error(`Lightweight package file digest changed: ${expectedFile.path}`);
    }
  }
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    hash.on('error', reject);
    hash.on('finish', () => resolve(hash.digest('hex')));
    input.pipe(hash);
  });
}

/** @param {unknown} value @returns {crypto.KeyObject} */
function parsePrivateKey(value) {
  try {
    if (!(value instanceof crypto.KeyObject) && typeof value !== 'string' && !Buffer.isBuffer(value)) {
      throw new Error('unsupported key value');
    }
    const key = value instanceof crypto.KeyObject ? value : crypto.createPrivateKey(value);
    if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('not ed25519');
    }
    return key;
  } catch {
    throw new Error('Lightweight signing key must be a valid Ed25519 private key.');
  }
}

/** @param {unknown} value @returns {crypto.KeyObject} */
function parsePublicKey(value) {
  try {
    if (!(value instanceof crypto.KeyObject) && typeof value !== 'string' && !Buffer.isBuffer(value)) {
      throw new Error('unsupported key value');
    }
    if (value instanceof crypto.KeyObject && value.type !== 'public') {
      throw new Error('private keys are not verification keys');
    }
    if (!(value instanceof crypto.KeyObject) && isPrivateKeyMaterial(value)) {
      throw new Error('private keys are not verification keys');
    }
    const key = value instanceof crypto.KeyObject ? value : crypto.createPublicKey(value);
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('not ed25519');
    }
    return key;
  } catch {
    throw new Error('Trusted lightweight update key must be a valid Ed25519 public key.');
  }
}

/** @param {string | Buffer} value @returns {boolean} */
function isPrivateKeyMaterial(value) {
  try {
    crypto.createPrivateKey(value);
    return true;
  } catch {
    return false;
  }
}

/** @param {unknown} value @returns {crypto.KeyObject} */
function parseLightweightUpdatePublicKey(value) {
  return parsePublicKey(value);
}

/**
 * @param {unknown} value
 * @returns {TrustedLightweightUpdateKey[]}
 */
function parseTrustedLightweightUpdatePublicKeys(value) {
  /** @type {unknown[]} */
  let entries;
  if (isPlainObject(value) && Object.hasOwn(value, 'keys')) {
    assertExactKeys(value, ['keys', 'schemaVersion'], 'trusted lightweight update key ring');
    if (value.schemaVersion !== 1 || !Array.isArray(value.keys)) {
      throw new Error('Trusted lightweight update key ring schema version 1 is required.');
    }
    entries = value.keys;
  } else if (Array.isArray(value)) {
    entries = value;
  } else {
    entries = [value];
  }
  if (entries.length === 0) {
    throw new Error('Trusted lightweight update key ring must contain at least one key.');
  }

  const seen = new Set();
  return entries.map((entry) => {
    const declaredKeyId = isPlainObject(entry) && Object.hasOwn(entry, 'keyId')
      ? requirePatternString(entry.keyId, /^[a-f0-9]{64}$/u, 'trusted lightweight update key ID')
      : null;
    const material = isPlainObject(entry) && Object.hasOwn(entry, 'publicKey')
      ? entry.publicKey
      : entry;
    const publicKey = parsePublicKey(material);
    const keyId = getPublicKeyId(publicKey);
    if (declaredKeyId && declaredKeyId !== keyId) {
      throw new Error('Trusted lightweight update key ID does not match its public key.');
    }
    if (seen.has(keyId)) {
      throw new Error('Trusted lightweight update key ring contains a duplicate key.');
    }
    seen.add(keyId);
    return { keyId, publicKey };
  });
}

/** @param {crypto.KeyObject} publicKey @returns {string} */
function getPublicKeyId(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(spki).digest('hex');
}

/** @param {string} value @returns {Buffer} */
function decodeEd25519Signature(value) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/u.test(value)) {
    throw new Error('Lightweight manifest signature is not valid base64.');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== value) {
    throw new Error('Lightweight manifest signature is invalid.');
  }
  return decoded;
}

/** @param {unknown} value @param {string} label @returns {string} */
function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} is invalid.`);
  }
  if (value.length > 1024 || value.includes('\\') || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} is unsafe.`);
  }
  if (value.startsWith('/') || /^[A-Za-z]:/u.test(value) || /[<>:"|?*]/u.test(value)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const segments = value.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.length > 255) {
      throw new Error(`${label} contains an unsafe path segment.`);
    }
    if (/[ .]$/u.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment)) {
      throw new Error(`${label} is not safe on Windows.`);
    }
  }
  return segments.join('/');
}

/** @param {string[]} paths @param {string} label */
function assertNoDuplicatePaths(paths, label) {
  const seen = new Set();
  for (const filePath of paths) {
    const key = filePath.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Lightweight ${label} path is duplicated: ${filePath}`);
    }
    seen.add(key);
  }
}

/** @param {unknown} value @returns {string} */
function canonicalJson(value) {
  return JSON.stringify(sortCanonicalValue(value));
}

/** @param {unknown} value @returns {unknown} */
function sortCanonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortCanonicalValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortCanonicalValue(value[key])]),
    );
  }
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** @param {Record<string, unknown>} value @param {string[]} expected @param {string} label */
function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error(`Lightweight ${label} contains unsupported or missing fields.`);
  }
}

/** @param {unknown} value @param {string} label @param {number} maxLength @returns {string} */
function requireNonEmptyString(value, label, maxLength) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maxLength) {
    throw new Error(`Lightweight ${label} is invalid.`);
  }
  return value;
}

/** @param {unknown} value @param {RegExp} pattern @param {string} label @returns {string} */
function requirePatternString(value, pattern, label) {
  const text = requireNonEmptyString(value, label, 1024);
  if (!pattern.test(text)) {
    throw new Error(`Lightweight ${label} is invalid.`);
  }
  return text;
}

/** @param {unknown} value @returns {string} */
function requireIsoTimestamp(value) {
  const text = requireNonEmptyString(value, 'build timestamp', 64);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new Error('Lightweight build timestamp must be an ISO timestamp.');
  }
  return text;
}

/** @param {unknown} value @param {string} label @returns {string} */
function requireReleaseVersion(value, label) {
  return requirePatternString(value, /^\d+\.\d+\.\d+$/u, label);
}

/** @param {unknown} value @returns {string} */
function requireNodeRequirement(value) {
  return requirePatternString(value, /^>=\d+(?:\.\d+){0,2}$/u, 'Node.js requirement');
}

/** @param {unknown} value @returns {number[]} */
function parseNodeRequirement(value) {
  return requireNodeRequirement(value).slice(2).split('.').map(Number);
}

/** @param {unknown} value @returns {number[]} */
function parseNodeVersion(value) {
  const text = requirePatternString(value, /^\d+(?:\.\d+){0,2}$/u, 'current Node.js version');
  return text.split('.').map(Number);
}

/** @param {string} left @param {string} right @returns {number} */
function compareReleaseVersions(left, right) {
  return compareNumericVersions(left.split('.').map(Number), right.split('.').map(Number));
}

/** @param {number[]} left @param {number[]} right @returns {number} */
function compareNumericVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

/** @param {string} rootDir @returns {string} */
function requireRootDirectory(rootDir) {
  if (typeof rootDir !== 'string' || !rootDir) {
    throw new TypeError('Lightweight package root directory is required.');
  }
  const resolved = path.resolve(rootDir);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new Error('Lightweight package root directory does not exist.');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Lightweight package root must be a regular directory.');
  }
  return resolved;
}

/** @param {string} filePath @param {string} message @returns {Promise<fs.Stats>} */
async function safeLstat(filePath, message) {
  try {
    return await fsp.lstat(filePath);
  } catch {
    throw new Error(message);
  }
}

/** @param {LightweightFile} left @param {LightweightFile} right @returns {number} */
function compareManifestFiles(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

/** @param {string} left @param {string} right @returns {boolean} */
function pathsEqual(left, right) {
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

module.exports = {
  LIGHTWEIGHT_MANIFEST_NAME,
  LIGHTWEIGHT_MAX_DOWNLOAD_BYTES,
  LIGHTWEIGHT_MAX_ARCHIVE_ENTRIES,
  LIGHTWEIGHT_MAX_FILE_BYTES,
  LIGHTWEIGHT_MAX_PACKAGE_BYTES,
  LIGHTWEIGHT_MAX_REDIRECTS,
  createSignedLightweightManifest,
  verifyLightweightPackage,
  parseLightweightUpdatePublicKey,
  parseTrustedLightweightUpdatePublicKeys,
  assertTrustedLightweightUpdateUrl,
  assertLightweightManifestCompatibility,
  assertSafeArchiveEntries,
};
