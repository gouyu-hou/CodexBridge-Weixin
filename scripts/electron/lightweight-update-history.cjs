const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const HISTORY_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 100;
const MAX_RECORDS = 1_000;
const MAX_RECORD_STRING_LENGTH = 500;
const ACTIONS = new Set(['verify', 'install', 'failure', 'rollback']);
const RESULTS = new Set(['success', 'failure', 'skipped']);

class LightweightUpdateHistoryStore {
  constructor(filePath, options = {}) {
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw new TypeError('Lightweight update history path is required.');
    }
    this.filePath = path.resolve(filePath);
    this.maxEntries = normalizeMaxEntries(options.maxEntries);
    this.records = [];
    this.loaded = false;
    this.loading = null;
    this.writeQueue = Promise.resolve();
  }

  async load() {
    await this.writeQueue;
    return this.ensureLoaded();
  }

  list() {
    return this.records.map((record) => ({ ...record }));
  }

  append(record) {
    const operation = this.writeQueue.then(async () => {
      await this.ensureLoaded();
      const normalized = normalizeHistoryRecord(record);
      const records = [...this.records, normalized].slice(-this.maxEntries);
      await this.persist(records);
      this.records = records;
      return { ...normalized };
    });
    this.writeQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async ensureLoaded() {
    if (this.loaded) {
      return this.list();
    }
    if (!this.loading) {
      this.loading = this.readFromDisk().finally(() => {
        this.loading = null;
      });
    }
    await this.loading;
    return this.list();
  }

  async readFromDisk() {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    await recoverInterruptedHistoryReplacement(this.filePath);
    let raw;
    try {
      raw = await fsp.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
      this.records = [];
      this.loaded = true;
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      this.records = normalizeHistoryFile(parsed, this.maxEntries);
    } catch {
      await quarantineCorruptHistory(this.filePath);
      this.records = [];
    }
    this.loaded = true;
  }

  async persist(records) {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const nonce = `${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
    const temporaryPath = `${this.filePath}.${nonce}.tmp`;
    const previousPath = `${this.filePath}.${nonce}.previous`;
    const backupPath = `${this.filePath}.bak`;
    const payload = JSON.stringify({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      records,
    }, null, 2) + '\n';
    await fsp.writeFile(temporaryPath, payload, 'utf8');
    if (fs.existsSync(this.filePath)) {
      await fsp.copyFile(this.filePath, backupPath).catch(() => {});
    }
    let previousMoved = false;
    try {
      if (fs.existsSync(this.filePath)) {
        await fsp.rename(this.filePath, previousPath);
        previousMoved = true;
      }
      await fsp.rename(temporaryPath, this.filePath);
      await fsp.chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      if (previousMoved && !fs.existsSync(this.filePath)) {
        await fsp.rename(previousPath, this.filePath).catch(() => {});
      }
      throw error;
    } finally {
      if (previousMoved && fs.existsSync(this.filePath)) {
        await fsp.rm(previousPath, { force: true }).catch(() => {});
      }
    }
  }
}

function normalizeHistoryFile(value, maxEntries) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Lightweight update history must be an object.');
  }
  if (value.schemaVersion !== HISTORY_SCHEMA_VERSION || !Array.isArray(value.records)) {
    throw new Error('Lightweight update history schema is invalid.');
  }
  return value.records
    .map((record) => {
      try {
        return normalizeHistoryRecord(record);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(-maxEntries);
}

function normalizeHistoryRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Lightweight update history record is invalid.');
  }
  const action = normalizeEnum(value.action, ACTIONS, 'history action');
  const result = normalizeEnum(value.result, RESULTS, 'history result');
  const at = normalizeTimestamp(value.at) || new Date().toISOString();
  const keyId = normalizeKeyId(value.keyId);
  return {
    id: normalizeId(value.id) || crypto.randomUUID(),
    at,
    action,
    result,
    stage: normalizeText(value.stage),
    source: normalizeText(value.source),
    version: normalizeVersion(value.version),
    fromVersion: normalizeVersion(value.fromVersion),
    keyId,
    errorCode: normalizeText(value.errorCode),
    errorMessage: sanitizeErrorMessage(value.errorMessage),
  };
}

function normalizeMaxEntries(value) {
  const parsed = Number(value ?? DEFAULT_MAX_ENTRIES);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_RECORDS) {
    throw new RangeError('Lightweight update history entry limit is invalid.');
  }
  return parsed;
}

function normalizeEnum(value, allowed, label) {
  const normalized = normalizeText(value);
  if (!allowed.has(normalized)) {
    throw new Error(`Lightweight ${label} is invalid.`);
  }
  return normalized;
}

function normalizeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/u.test(value.trim())
    ? value.trim()
    : '';
}

function normalizeKeyId(value) {
  const normalized = normalizeText(value).toLowerCase();
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : null;
}

function normalizeVersion(value) {
  const normalized = normalizeText(value);
  return /^\d+\.\d+\.\d+$/u.test(normalized) ? normalized : null;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  const normalized = value.trim();
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) && date.toISOString() === normalized
    ? normalized
    : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_RECORD_STRING_LENGTH) : '';
}

function sanitizeErrorMessage(value) {
  return normalizeText(value)
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/giu, '[redacted-key]')
    .replace(/(api[_-]?key|token|password|secret|private[_-]?key)\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(/[\r\n]+/gu, ' ')
    .slice(0, MAX_RECORD_STRING_LENGTH);
}

async function quarantineCorruptHistory(filePath) {
  const target = `${filePath}.corrupt-${Date.now()}-${crypto.randomUUID()}`;
  await fsp.rename(filePath, target).catch(() => {});
}

async function recoverInterruptedHistoryReplacement(filePath) {
  if (fs.existsSync(filePath)) {
    return false;
  }
  let entries;
  try {
    entries = await fsp.readdir(path.dirname(filePath), { withFileTypes: true });
  } catch {
    return false;
  }
  const prefix = `${path.basename(filePath)}.`;
  const candidates = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.previous'))
    .map(async (entry) => {
      const candidatePath = path.join(path.dirname(filePath), entry.name);
      const stat = await fsp.stat(candidatePath);
      return { candidatePath, mtimeMs: stat.mtimeMs };
    }));
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const candidate = candidates[0];
  if (!candidate) {
    return false;
  }
  await fsp.rename(candidate.candidatePath, filePath);
  return true;
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  LightweightUpdateHistoryStore,
};
