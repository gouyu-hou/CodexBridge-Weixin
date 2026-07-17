import fs from 'node:fs';
import path from 'node:path';

const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RECOVERY_PHASES = Object.freeze([
  'push-pending',
  'refs-pushed',
  'draft-created',
  'draft-verified',
]);
const RECOVERY_KEYS = new Set([
  'schemaVersion',
  'version',
  'tag',
  'branch',
  'remote',
  'commit',
  'notesFile',
  'phase',
  'artifacts',
  'latestYmlSha256',
  'createdAt',
  'updatedAt',
]);

/**
 * @typedef {{ name: string, size: number, sha256: string }} RecoveryArtifact
 * @typedef {{
 *   schemaVersion: 1,
 *   version: string,
 *   tag: string,
 *   branch: 'main',
 *   remote: 'gouyu',
 *   commit: string,
 *   notesFile: string,
 *   phase: 'push-pending' | 'refs-pushed' | 'draft-created' | 'draft-verified',
 *   artifacts: RecoveryArtifact[],
 *   latestYmlSha256: string,
 *   createdAt: string,
 *   updatedAt: string,
 * }} RecoveryState
 */

/**
 * @param {Record<string, any>} input
 * @param {{ now?: () => Date }} [options]
 * @returns {RecoveryState}
 */
export function createRecoveryState(input, { now = () => new Date() } = {}) {
  const timestamp = now().toISOString();
  return assertRecoveryState({
    schemaVersion: 1,
    version: input.version,
    tag: input.tag,
    branch: input.branch,
    remote: input.remote,
    commit: input.commit,
    notesFile: input.notesFile,
    phase: input.phase,
    artifacts: input.artifacts,
    latestYmlSha256: input.latestYmlSha256,
    createdAt: input.createdAt ?? timestamp,
    updatedAt: input.updatedAt ?? timestamp,
  }, String(input.version ?? ''));
}

/**
 * @param {unknown} value
 * @param {string} [expectedVersion]
 * @returns {RecoveryState}
 */
export function assertRecoveryState(value, expectedVersion = '') {
  if (!isRecord(value)) {
    throw new Error('recovery state must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!RECOVERY_KEYS.has(key)) {
      throw new Error('recovery state contains an unsupported field');
    }
  }
  if (value.schemaVersion !== 1) {
    throw new Error('unsupported recovery state schema version');
  }
  const version = String(value.version ?? '');
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error('recovery state contains an invalid version');
  }
  if (expectedVersion && version !== expectedVersion) {
    throw new Error('recovery state version does not match the requested version');
  }
  if (value.tag !== `v${version}`) {
    throw new Error('recovery state Tag does not match its version');
  }
  if (value.branch !== 'main' || value.remote !== 'gouyu') {
    throw new Error('recovery state targets an unsupported Git branch or remote');
  }
  if (typeof value.commit !== 'string' || !COMMIT_PATTERN.test(value.commit)) {
    throw new Error('recovery state contains an invalid commit');
  }
  const notesFile = normalizeRelativePath(value.notesFile);
  if (!notesFile) {
    throw new Error('recovery state notes path must be repository-relative');
  }
  if (!RECOVERY_PHASES.includes(value.phase)) {
    throw new Error('recovery state contains an unsupported phase');
  }
  const artifacts = normalizeArtifacts(value.artifacts, version);
  const latestYmlSha256 = normalizeSha256(value.latestYmlSha256, 'latest.yml digest');
  const latestArtifact = artifacts.find((artifact) => artifact.name === 'latest.yml');
  if (!latestArtifact || latestArtifact.sha256 !== latestYmlSha256) {
    throw new Error('recovery state latest.yml digest does not match its asset');
  }
  const createdAt = normalizeTimestamp(value.createdAt, 'createdAt');
  const updatedAt = normalizeTimestamp(value.updatedAt, 'updatedAt');
  return {
    schemaVersion: 1,
    version,
    tag: value.tag,
    branch: 'main',
    remote: 'gouyu',
    commit: value.commit,
    notesFile,
    phase: value.phase,
    artifacts,
    latestYmlSha256,
    createdAt,
    updatedAt,
  };
}

/**
 * @param {string} filePath
 * @param {string} expectedVersion
 * @returns {RecoveryState}
 */
export function readRecoveryState(filePath, expectedVersion) {
  recoverInterruptedStateReplacement(filePath);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error('release recovery state is missing or unreadable');
  }
  try {
    return assertRecoveryState(JSON.parse(raw), expectedVersion);
  } catch (error) {
    if (error instanceof Error && /recovery state/u.test(error.message)) {
      throw error;
    }
    throw new Error('release recovery state is invalid');
  }
}

/**
 * @param {string} filePath
 * @param {RecoveryState} state
 */
export function writeRecoveryStateAtomically(filePath, state) {
  const validated = assertRecoveryState(state, state.version);
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath = `${filePath}.${nonce}.tmp`;
  const previousPath = `${filePath}.${nonce}.previous`;
  fs.writeFileSync(tempPath, `${JSON.stringify(validated, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  let previousMoved = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, previousPath);
      previousMoved = true;
    }
    fs.renameSync(tempPath, filePath);
    setOwnerOnlyPermissions(filePath);
    if (previousMoved) {
      fs.rmSync(previousPath, { force: true });
    }
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    if (previousMoved && !fs.existsSync(filePath)) {
      try {
        fs.renameSync(previousPath, filePath);
      } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(previousPath) && fs.existsSync(filePath)) {
      fs.rmSync(previousPath, { force: true });
    }
  }
}

/**
 * @param {string} filePath
 * @param {RecoveryState} state
 * @param {{ phase: RecoveryState['phase'], now?: () => Date }} patch
 * @returns {RecoveryState}
 */
export function updateRecoveryState(filePath, state, { phase, now = () => new Date() }) {
  const current = assertRecoveryState(state, state.version);
  const updated = assertRecoveryState({
    ...current,
    phase,
    updatedAt: now().toISOString(),
  }, current.version);
  writeRecoveryStateAtomically(filePath, updated);
  return updated;
}

function normalizeArtifacts(value, version) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error('recovery state must contain exactly three release assets');
  }
  const expectedNames = new Set([
    `CodexBridge-Weixin-Admin-Setup-${version}.exe`,
    `CodexBridge-Weixin-Admin-Setup-${version}.exe.blockmap`,
    'latest.yml',
  ]);
  const artifacts = value.map((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !expectedNames.has(item.name)) {
      throw new Error('recovery state contains an unexpected release asset');
    }
    if (!Number.isSafeInteger(item.size) || item.size <= 0) {
      throw new Error('recovery state contains an invalid asset size');
    }
    return {
      name: item.name,
      size: item.size,
      sha256: normalizeSha256(item.sha256, 'asset digest'),
    };
  });
  if (new Set(artifacts.map((artifact) => artifact.name)).size !== 3) {
    throw new Error('recovery state assets must have unique names');
  }
  return artifacts;
}

function normalizeSha256(value, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`recovery state contains an invalid ${label}`);
  }
  return value;
}

function normalizeRelativePath(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '';
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.startsWith('/')
    || /^[A-Za-z]:\//u.test(normalized)
    || normalized.split('/').some((segment) => segment === '..')
  ) {
    return '';
  }
  return path.posix.normalize(normalized).replace(/^\.\//u, '');
}

function normalizeTimestamp(value, label) {
  if (
    typeof value !== 'string'
    || !ISO_TIMESTAMP_PATTERN.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`recovery state contains an invalid ${label}`);
  }
  return value;
}

function recoverInterruptedStateReplacement(filePath) {
  if (fs.existsSync(filePath)) {
    return;
  }
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    return;
  }
  const prefix = `${path.basename(filePath)}.`;
  const candidate = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.previous'))
    .map((entry) => {
      const candidatePath = path.join(directory, entry.name);
      return { candidatePath, mtimeMs: fs.statSync(candidatePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0];
  if (candidate) {
    fs.renameSync(candidate.candidatePath, filePath);
    setOwnerOnlyPermissions(filePath);
  }
}

function setOwnerOnlyPermissions(filePath) {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows permissions are inherited from the user-data directory.
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
