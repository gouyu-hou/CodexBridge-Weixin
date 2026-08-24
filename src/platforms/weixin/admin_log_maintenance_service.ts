import fs from 'node:fs';
import path from 'node:path';

const LOG_TAIL_BYTES = 256 * 1024;
const DEFAULT_LOG_CLEANUP_ENABLED = true;
const DEFAULT_LOG_RETENTION_DAYS = 7;
const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_LOG_CLEANUP_INTERVAL_MINUTES = 60;
export const MAX_LOG_RETENTION_DAYS = 365;
export const MAX_LOG_CLEANUP_INTERVAL_MINUTES = 24 * 60;

export interface WeixinAdminLogFile {
  kind: 'stdout' | 'stderr';
  path: string;
}

export interface WeixinAdminLogCleanupSettings {
  enabled: boolean;
  retentionDays: number;
  maxBytes: number;
  intervalMinutes: number;
}

export interface WeixinAdminLogCleanupAction {
  path: string;
  action: string;
  beforeBytes: number;
  afterBytes: number;
  error?: string;
}

export interface WeixinAdminLogCleanupResult {
  enabled: boolean;
  reason: string;
  startedAt: string;
  settings?: WeixinAdminLogCleanupSettings;
  actions: WeixinAdminLogCleanupAction[];
}

export interface WeixinAdminLogMaintenanceServiceOptions {
  stateDir: string;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  now?: () => number;
  setInterval?: (callback: () => void, delay: number) => unknown;
  clearInterval?: (timer: unknown) => void;
  path?: typeof path;
  fs?: typeof fs;
  buildActiveLogResetSummary?: (input: { reason: string; startedAt: string }) => string;
}

export class WeixinAdminLogMaintenanceService {
  constructor({
    stateDir,
    env = process.env,
    now = Date.now,
    setInterval: setIntervalFn = (callback, delay) => setInterval(callback, delay),
    clearInterval: clearIntervalFn = (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
    path: pathModule = path,
    fs: fsModule = fs,
    buildActiveLogResetSummary = () => '',
  }: WeixinAdminLogMaintenanceServiceOptions) {
    this.stateDir = stateDir;
    this.env = env;
    this.now = now;
    this.setInterval = setIntervalFn;
    this.clearInterval = clearIntervalFn;
    this.path = pathModule;
    this.fs = fsModule;
    this.buildActiveLogResetSummary = buildActiveLogResetSummary;
    this.timer = null;
  }

  stateDir: string;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  now: () => number;
  setInterval: (callback: () => void, delay: number) => unknown;
  clearInterval: (timer: unknown) => void;
  path: typeof path;
  fs: typeof fs;
  buildActiveLogResetSummary: (input: { reason: string; startedAt: string }) => string;
  timer: unknown | null;

  start(): void {
    this.schedule({ runImmediately: true });
  }

  restart(): void {
    this.schedule({ runImmediately: false });
  }

  stop(): void {
    if (this.timer === null) {
      return;
    }
    this.clearInterval(this.timer);
    this.timer = null;
  }

  buildSummary() {
    const files = this.resolveLogFiles().map((entry) => {
      const stat = this.safeStat(entry.path);
      return {
        ...entry,
        exists: Boolean(stat),
        sizeBytes: stat?.size ?? 0,
        updatedAt: stat?.mtimeMs ?? null,
      };
    });
    return {
      generatedAt: new Date(this.now()).toISOString(),
      settings: this.resolveSettings(),
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files,
    };
  }

  readLogs({ lineLimit = 300 }: { lineLimit?: number } = {}) {
    const files = this.resolveLogFiles().map((entry) => {
      const stat = this.safeStat(entry.path);
      const tail = stat ? this.tailLines(this.readTailText(entry.path, LOG_TAIL_BYTES), lineLimit) : '';
      return {
        ...entry,
        exists: Boolean(stat),
        sizeBytes: stat?.size ?? 0,
        updatedAt: stat?.mtimeMs ?? null,
        text: tail,
      };
    });
    return {
      generatedAt: new Date(this.now()).toISOString(),
      settings: this.resolveSettings(),
      totalSizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      files,
      text: files
        .map((file) => [
          `== ${file.kind}: ${file.path} ==`,
          file.exists ? (file.text || '(empty)') : '(missing)',
        ].join('\n'))
        .join('\n\n'),
    };
  }

  resolveLogFiles(): WeixinAdminLogFile[] {
    return [
      { kind: 'stdout', path: this.path.join(this.stateDir, 'logs', 'weixin-bridge.out.log') },
      { kind: 'stderr', path: this.path.join(this.stateDir, 'logs', 'weixin-bridge.err.log') },
    ];
  }

  resolveSettings(): WeixinAdminLogCleanupSettings {
    return {
      enabled: parseBooleanEnv(this.env.WEIXIN_LOG_CLEANUP_ENABLE, DEFAULT_LOG_CLEANUP_ENABLED),
      retentionDays: parsePositiveInt(this.env.WEIXIN_LOG_RETENTION_DAYS, DEFAULT_LOG_RETENTION_DAYS, MAX_LOG_RETENTION_DAYS),
      maxBytes: parsePositiveInt(this.env.WEIXIN_LOG_MAX_BYTES, DEFAULT_LOG_MAX_BYTES, Number.MAX_SAFE_INTEGER),
      intervalMinutes: parsePositiveInt(
        this.env.WEIXIN_LOG_CLEANUP_INTERVAL_MINUTES,
        DEFAULT_LOG_CLEANUP_INTERVAL_MINUTES,
        MAX_LOG_CLEANUP_INTERVAL_MINUTES,
      ),
    };
  }

  async cleanup(reason: string): Promise<WeixinAdminLogCleanupResult> {
    const settings = this.resolveSettings();
    const logsDir = this.path.join(this.stateDir, 'logs');
    const startedAt = new Date(this.now()).toISOString();
    const actions: WeixinAdminLogCleanupAction[] = [];
    if (!settings.enabled) {
      return { enabled: false, reason, startedAt, actions };
    }
    const now = this.now();
    const retentionMs = settings.retentionDays > 0 ? settings.retentionDays * 24 * 60 * 60 * 1000 : 0;
    const activeLogPaths = new Set(this.resolveLogFiles().map((entry) => this.path.resolve(entry.path)));
    for (const filePath of this.listCleanupTargets(logsDir)) {
      const stat = this.safeStat(filePath);
      if (!stat || !stat.isFile()) {
        continue;
      }
      const beforeBytes = stat.size;
      const isActiveLog = activeLogPaths.has(this.path.resolve(filePath));
      try {
        if (retentionMs > 0 && now - stat.mtimeMs > retentionMs) {
          if (isActiveLog) {
            const message = `[CodexBridge] log cleared at ${startedAt}; reason=${reason}; older than ${settings.retentionDays} day(s).\n`;
            this.fs.writeFileSync(filePath, message, 'utf8');
            actions.push({ path: filePath, action: 'cleared_old_active_log', beforeBytes, afterBytes: this.safeStat(filePath)?.size ?? 0 });
          } else {
            this.fs.unlinkSync(filePath);
            actions.push({ path: filePath, action: 'deleted_old_log', beforeBytes, afterBytes: 0 });
          }
          continue;
        }
        if (settings.maxBytes > 0 && stat.size > settings.maxBytes) {
          this.compactLogFile(filePath, settings.maxBytes, { reason, timestamp: startedAt });
          actions.push({ path: filePath, action: 'compacted_large_log', beforeBytes, afterBytes: this.safeStat(filePath)?.size ?? 0 });
        }
      } catch (error) {
        actions.push({
          path: filePath,
          action: 'failed',
          beforeBytes,
          afterBytes: this.safeStat(filePath)?.size ?? beforeBytes,
          error: formatError(error),
        });
      }
    }
    return { enabled: true, reason, startedAt, settings, actions };
  }

  async clearActive(reason: string): Promise<WeixinAdminLogCleanupResult> {
    const startedAt = new Date(this.now()).toISOString();
    const summary = this.buildActiveLogResetSummary({ reason, startedAt });
    const actions: WeixinAdminLogCleanupAction[] = [];
    for (const entry of this.resolveLogFiles()) {
      const beforeBytes = this.safeStat(entry.path)?.size ?? 0;
      try {
        this.fs.mkdirSync(this.path.dirname(entry.path), { recursive: true });
        const content = entry.kind === 'stdout' ? summary : '';
        this.fs.writeFileSync(entry.path, content, 'utf8');
        actions.push({
          path: entry.path,
          action: entry.kind === 'stdout' ? 'reset_active_log_with_summary' : 'cleared_active_log',
          beforeBytes,
          afterBytes: this.safeStat(entry.path)?.size ?? 0,
        });
      } catch (error) {
        actions.push({
          path: entry.path,
          action: 'failed',
          beforeBytes,
          afterBytes: this.safeStat(entry.path)?.size ?? beforeBytes,
          error: formatError(error),
        });
      }
    }
    return { enabled: true, reason, startedAt, actions };
  }

  private schedule({ runImmediately }: { runImmediately: boolean }): void {
    this.stop();
    const settings = this.resolveSettings();
    if (!settings.enabled) {
      return;
    }
    if (runImmediately) {
      void this.cleanup('startup').catch(() => {});
    }
    this.timer = this.setInterval(() => {
      void this.cleanup('interval').catch(() => {});
    }, Math.max(1, settings.intervalMinutes) * 60 * 1000);
  }

  private listCleanupTargets(logsDir: string): string[] {
    const paths = new Set(this.resolveLogFiles().map((entry) => entry.path));
    try {
      for (const name of this.fs.readdirSync(logsDir)) {
        if (/^weixin-bridge\..*\.log(?:\.\d+)?$/u.test(name)) {
          paths.add(this.path.join(logsDir, name));
        }
      }
    } catch {
      // Missing logs directory is normal before the service has written logs.
    }
    return [...paths];
  }

  private safeStat(filePath: string) {
    try {
      return this.fs.statSync(filePath);
    } catch {
      return null;
    }
  }

  private readTailText(filePath: string, maxBytes: number): string {
    let fd: number | null = null;
    try {
      const stat = this.fs.statSync(filePath);
      const length = Math.min(stat.size, maxBytes);
      const start = Math.max(0, stat.size - length);
      const buffer = Buffer.alloc(length);
      fd = this.fs.openSync(filePath, 'r');
      this.fs.readSync(fd, buffer, 0, length, start);
      return buffer.toString('utf8');
    } catch {
      return '';
    } finally {
      if (fd !== null) {
        try {
          this.fs.closeSync(fd);
        } catch {}
      }
    }
  }

  private compactLogFile(filePath: string, maxBytes: number, { reason, timestamp }: { reason: string; timestamp: string }): void {
    const marker = `[CodexBridge] log compacted at ${timestamp}; reason=${reason}; kept the latest log tail.\n`;
    const markerBuffer = Buffer.from(marker, 'utf8').subarray(0, maxBytes);
    const keepBytes = Math.max(0, maxBytes - markerBuffer.length);
    const tail = this.readTailBuffer(filePath, keepBytes);
    this.fs.writeFileSync(filePath, Buffer.concat([markerBuffer, tail]));
  }

  private readTailBuffer(filePath: string, maxBytes: number): Buffer {
    if (maxBytes <= 0) {
      return Buffer.alloc(0);
    }
    let fd: number | null = null;
    try {
      const stat = this.fs.statSync(filePath);
      const length = Math.min(stat.size, maxBytes);
      const start = Math.max(0, stat.size - length);
      const buffer = Buffer.alloc(length);
      fd = this.fs.openSync(filePath, 'r');
      this.fs.readSync(fd, buffer, 0, length, start);
      return buffer;
    } catch {
      return Buffer.alloc(0);
    } finally {
      if (fd !== null) {
        try {
          this.fs.closeSync(fd);
        } catch {}
      }
    }
  }

  private tailLines(text: string, lineLimit: number): string {
    const normalized = text.replace(/^\uFEFF/u, '').trimEnd();
    if (!normalized) {
      return '';
    }
    const lines = normalized.split(/\r?\n/u);
    return lines.slice(Math.max(0, lines.length - lineLimit)).join('\n');
  }
}

function parsePositiveInt(value: unknown, defaultValue: number, maxValue: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function parseBooleanEnv(value: unknown, defaultValue = false): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.stack || String(error);
  }
  return String(error);
}
