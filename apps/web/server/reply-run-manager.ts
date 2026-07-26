import crypto from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { getWebPaths } from '../lib/server/runtime';
import type { WebCodexThreadMessage } from '../lib/server/queries';

type ReplyRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ReplyRunSnapshot = {
  runId: string;
  sourceThreadId: string;
  finalThreadId: string | null;
  bridgeSessionId: string | null;
  status: ReplyRunStatus;
  assistantText: string;
  commentaryText: string;
  error: string | null;
  turnId: string | null;
  items: WebCodexThreadMessage[] | null;
  hasMore: boolean;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
};

export type ReplyRunEvent =
  | { type: 'snapshot'; run: ReplyRunSnapshot }
  | { type: 'started'; run: ReplyRunSnapshot }
  | { type: 'assistant'; run: ReplyRunSnapshot }
  | { type: 'commentary'; run: ReplyRunSnapshot }
  | { type: 'done'; run: ReplyRunSnapshot }
  | { type: 'failed'; run: ReplyRunSnapshot };

type ReplyRunRecord = {
  snapshot: ReplyRunSnapshot;
  cleanupTimer: NodeJS.Timeout | null;
  listeners: Set<(event: ReplyRunEvent) => void>;
};

type ReplyRunManagerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  getPaths?: typeof getWebPaths;
  idleTimeoutMs?: number;
  maxPendingStdoutBytes?: number;
  maxStderrBytes?: number;
  runTtlMs?: number;
  scriptPath?: string;
};

const DEFAULT_RUN_TTL_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_PENDING_STDOUT_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const PROCESS_TREE_COMMAND_TIMEOUT_MS = 5_000;

export class ReplyRunManager {
  private readonly runs = new Map<string, ReplyRunRecord>();

  private readonly cwd: string;

  private readonly env: NodeJS.ProcessEnv;

  private readonly getPaths: typeof getWebPaths;

  private readonly idleTimeoutMs: number;

  private readonly maxPendingStdoutBytes: number;

  private readonly maxStderrBytes: number;

  private readonly runTtlMs: number;

  private readonly scriptPath: string;

  constructor({
    cwd = process.cwd(),
    env = process.env,
    getPaths = getWebPaths,
    idleTimeoutMs,
    maxPendingStdoutBytes,
    maxStderrBytes,
    runTtlMs,
    scriptPath,
  }: ReplyRunManagerOptions = {}) {
    this.cwd = cwd;
    this.env = env;
    this.getPaths = getPaths;
    this.idleTimeoutMs = resolvePositiveInteger(
      idleTimeoutMs,
      env.CODEXBRIDGE_WEB_REPLY_IDLE_TIMEOUT_MS,
      DEFAULT_IDLE_TIMEOUT_MS,
      'idleTimeoutMs',
    );
    this.maxPendingStdoutBytes = resolvePositiveInteger(
      maxPendingStdoutBytes,
      env.CODEXBRIDGE_WEB_REPLY_MAX_STDOUT_LINE_BYTES,
      DEFAULT_MAX_PENDING_STDOUT_BYTES,
      'maxPendingStdoutBytes',
    );
    this.maxStderrBytes = resolvePositiveInteger(
      maxStderrBytes,
      env.CODEXBRIDGE_WEB_REPLY_STDERR_TAIL_BYTES,
      DEFAULT_MAX_STDERR_BYTES,
      'maxStderrBytes',
    );
    this.runTtlMs = resolvePositiveInteger(
      runTtlMs,
      undefined,
      DEFAULT_RUN_TTL_MS,
      'runTtlMs',
    );
    this.scriptPath = scriptPath ?? path.join(cwd, 'server', 'reply-codex-thread.ts');
  }

  createRun({
    text,
    threadId,
  }: {
    text: string;
    threadId: string;
  }): ReplyRunSnapshot {
    const runId = crypto.randomUUID();
    const now = Date.now();
    const snapshot: ReplyRunSnapshot = {
      runId,
      sourceThreadId: threadId,
      finalThreadId: null,
      bridgeSessionId: null,
      status: 'queued',
      assistantText: '',
      commentaryText: '',
      error: null,
      turnId: null,
      items: null,
      hasMore: false,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    const record: ReplyRunRecord = {
      snapshot,
      cleanupTimer: null,
      listeners: new Set(),
    };
    this.runs.set(runId, record);
    void this.execute(record, text).catch((error) => {
      this.fail(record, error instanceof Error ? error.message : String(error));
    });
    return snapshot;
  }

  getSnapshot(runId: string): ReplyRunSnapshot | null {
    return this.runs.get(runId)?.snapshot ?? null;
  }

  subscribe(runId: string, listener: (event: ReplyRunEvent) => void): (() => void) | null {
    const record = this.runs.get(runId);
    if (!record) {
      return null;
    }
    record.listeners.add(listener);
    return () => {
      record.listeners.delete(listener);
    };
  }

  private emit(record: ReplyRunRecord, type: ReplyRunEvent['type']) {
    const event = {
      type,
      run: { ...record.snapshot },
    } as ReplyRunEvent;
    for (const listener of record.listeners) {
      try {
        listener(event);
      } catch {
        // ignore listener failures
      }
    }
  }

  private update(record: ReplyRunRecord, patch: Partial<ReplyRunSnapshot>, eventType: ReplyRunEvent['type']) {
    record.snapshot = {
      ...record.snapshot,
      ...patch,
      updatedAt: Date.now(),
    };
    this.emit(record, eventType);
  }

  private fail(record: ReplyRunRecord, message: string) {
    this.update(record, {
      completedAt: Date.now(),
      error: message || 'reply_failed',
      status: 'failed',
    }, 'failed');
    this.scheduleCleanup(record.snapshot.runId);
  }

  private scheduleCleanup(runId: string) {
    const record = this.runs.get(runId);
    if (!record) {
      return;
    }
    if (record.cleanupTimer) {
      clearTimeout(record.cleanupTimer);
    }
    record.cleanupTimer = setTimeout(() => {
      this.runs.delete(runId);
    }, this.runTtlMs);
    record.cleanupTimer.unref?.();
  }

  private async execute(record: ReplyRunRecord, text: string) {
    const { repoRoot, stateDir } = this.getPaths();
    const child = spawn(process.execPath, ['--import', 'tsx', this.scriptPath], {
      cwd: this.cwd,
      detached: process.platform !== 'win32',
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutBuffer = '';
    let stdoutBufferBytes = 0;
    let stderrBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let completed = false;
    let idleTimer: NodeJS.Timeout | null = null;
    let settled = false;
    let terminationStarted = false;
    let terminationPromise: Promise<void> | null = null;
    let terminatingError: Error | null = null;

    const appendStderr = (chunk: unknown) => {
      stderrBuffer = appendBufferTail(stderrBuffer, chunk, this.maxStderrBytes);
    };

    const clearIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
    };

    const handleLine = (line: string) => {
      const payload = JSON.parse(line) as
        | {
            type: 'started';
            bridgeSessionId?: string | null;
            providerProfileId?: string | null;
            threadId?: string | null;
            turnId?: string | null;
          }
        | {
            type: 'assistant';
            text?: string | null;
          }
        | {
            type: 'commentary';
            text?: string | null;
          }
        | {
            type: 'done';
            bridgeSessionId?: string | null;
            outputText?: string | null;
            threadId?: string | null;
            items?: WebCodexThreadMessage[] | null;
            hasMore?: boolean | null;
          };

      if (payload.type === 'started') {
        this.update(record, {
          bridgeSessionId: typeof payload.bridgeSessionId === 'string' ? payload.bridgeSessionId : record.snapshot.bridgeSessionId,
          finalThreadId: typeof payload.threadId === 'string' ? payload.threadId : record.snapshot.finalThreadId,
          status: 'running',
          turnId: typeof payload.turnId === 'string' ? payload.turnId : record.snapshot.turnId,
        }, 'started');
        return;
      }

      if (payload.type === 'assistant') {
        this.update(record, {
          assistantText: typeof payload.text === 'string' ? payload.text : record.snapshot.assistantText,
        }, 'assistant');
        return;
      }

      if (payload.type === 'commentary') {
        this.update(record, {
          commentaryText: typeof payload.text === 'string' ? payload.text : record.snapshot.commentaryText,
        }, 'commentary');
        return;
      }

      completed = true;
      this.update(record, {
        assistantText:
          typeof payload.outputText === 'string' && payload.outputText.trim()
            ? payload.outputText
            : record.snapshot.assistantText,
        bridgeSessionId:
          typeof payload.bridgeSessionId === 'string'
            ? payload.bridgeSessionId
            : record.snapshot.bridgeSessionId,
        completedAt: Date.now(),
        error: null,
        finalThreadId:
          typeof payload.threadId === 'string'
            ? payload.threadId
            : record.snapshot.finalThreadId,
        hasMore: Boolean(payload.hasMore),
        items: Array.isArray(payload.items) ? payload.items : record.snapshot.items,
        status: 'completed',
      }, 'done');
      this.scheduleCleanup(record.snapshot.runId);
    };

    await new Promise<void>((resolve, reject) => {
      const finish = (error: Error | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearIdleTimer();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const terminate = (error: Error | null) => {
        if (settled || terminationStarted) {
          return;
        }
        terminationStarted = true;
        terminatingError = error;
        clearIdleTimer();
        terminationPromise = terminateProcessTree(child).catch(() => {
          if (isChildRunning(child)) {
            child.kill('SIGKILL');
          }
        });
      };

      const resetIdleTimer = () => {
        if (settled || terminatingError) {
          return;
        }
        clearIdleTimer();
        idleTimer = setTimeout(() => {
          if (completed) {
            terminate(null);
            return;
          }
          terminate(new Error(`reply_idle_timeout:${this.idleTimeoutMs}`));
        }, this.idleTimeoutMs);
      };

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (terminationStarted || settled) {
          return;
        }
        resetIdleTimer();
        stdoutBuffer += chunk;
        while (stdoutBuffer.includes('\n')) {
          const newlineIndex = stdoutBuffer.indexOf('\n');
          const rawLine = stdoutBuffer.slice(0, newlineIndex);
          stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
          if (Buffer.byteLength(rawLine, 'utf8') > this.maxPendingStdoutBytes) {
            terminate(new Error(`reply_stdout_line_limit_exceeded:${this.maxPendingStdoutBytes}`));
            return;
          }
          const line = rawLine.trim();
          if (!line) {
            continue;
          }
          try {
            handleLine(line);
          } catch (error) {
            appendStderr(`${error instanceof Error ? error.message : String(error)}\n`);
          }
        }
        stdoutBufferBytes = Buffer.byteLength(stdoutBuffer, 'utf8');
        if (stdoutBufferBytes > this.maxPendingStdoutBytes) {
          terminate(new Error(`reply_stdout_line_limit_exceeded:${this.maxPendingStdoutBytes}`));
        }
      });
      child.stderr.on('data', (chunk: string) => {
        if (terminationStarted || settled) {
          return;
        }
        resetIdleTimer();
        appendStderr(chunk);
      });
      child.once('error', (error) => {
        void (async () => {
          await terminationPromise;
          if (terminatingError) {
            finish(terminatingError);
            return;
          }
          finish(completed ? null : error);
        })();
      });
      child.once('close', (code) => {
        void (async () => {
          await terminationPromise;
          if (terminatingError) {
            finish(terminatingError);
            return;
          }
          if (completed) {
            finish(null);
            return;
          }
          const detail = bufferTailToString(stderrBuffer, this.maxStderrBytes).trim();
          finish(new Error(detail || `reply_failed:${code ?? 'unknown'}`));
        })();
      });
      child.stdin.once('error', (error) => terminate(error));

      resetIdleTimer();
      child.stdin.end(JSON.stringify({
        repoRoot,
        stateDir,
        text,
        threadId: record.snapshot.sourceThreadId,
      }));
    });
  }
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (typeof pid !== 'number') {
    child.kill('SIGKILL');
    return;
  }

  if (process.platform === 'win32') {
    const treeKilled = await terminateWindowsProcessTree(pid);
    if (!treeKilled && isChildRunning(child)) {
      child.kill('SIGKILL');
    }
    return;
  }

  await terminatePosixProcessTree(child, pid);
}

function terminateWindowsProcessTree(pid: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killer.kill('SIGKILL');
      finish(false);
    }, PROCESS_TREE_COMMAND_TIMEOUT_MS);
    killer.once('error', () => finish(false));
    killer.once('close', (code) => finish(code === 0));
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

async function terminatePosixProcessTree(
  child: ChildProcessWithoutNullStreams,
  pid: number,
): Promise<void> {
  // Snapshot descendants that escaped the worker's process group; this is best-effort on POSIX.
  const descendants = await listDescendantProcessIds(pid);
  const trackedPids = [pid, ...descendants];

  if (!signalProcessGroup(pid, 'SIGTERM')) {
    child.kill('SIGTERM');
  }
  signalProcesses(descendants, 'SIGTERM');
  if (await waitForProcessesExit(trackedPids, 1_000)) {
    return;
  }

  if (!signalProcessGroup(pid, 'SIGKILL')) {
    child.kill('SIGKILL');
  }
  signalProcesses(descendants, 'SIGKILL');
  await waitForProcessesExit(trackedPids, 1_000);
}

async function listDescendantProcessIds(rootPid: number): Promise<number[]> {
  const table = await readPosixProcessTable();
  if (!table) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const line of table.split(/\r?\n/u)) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/u.exec(line);
    if (!match) {
      continue;
    }
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }

  const descendants: number[] = [];
  const visited = new Set<number>([rootPid]);
  const pending = [rootPid];
  while (pending.length > 0) {
    const parentPid = pending.pop()!;
    for (const childPid of childrenByParent.get(parentPid) ?? []) {
      if (visited.has(childPid)) {
        continue;
      }
      visited.add(childPid);
      descendants.push(childPid);
      pending.push(childPid);
    }
  }
  return descendants;
}

async function readPosixProcessTable(): Promise<string | null> {
  const argumentSets = [
    ['-A', '-o', 'pid=,ppid='],
    ['-eo', 'pid=,ppid='],
    ['-o', 'pid,ppid'],
  ];
  for (const args of argumentSets) {
    const table = await runPosixPs(args);
    if (table !== null) {
      return table;
    }
  }
  return null;
}

function runPosixPs(args: string[]): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const ps = spawn('ps', args, {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      ps.kill('SIGKILL');
      finish(null);
    }, 1_000);
    ps.stdout.setEncoding('utf8');
    ps.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output, 'utf8') > 1024 * 1024) {
        ps.kill('SIGKILL');
        finish(null);
      }
    });
    ps.once('error', () => finish(null));
    ps.once('close', (code) => finish(code === 0 ? output : null));
  });
}

function signalProcesses(pids: number[], signal: NodeJS.Signals) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // process already exited
    }
  }
}

async function waitForProcessesExit(pids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isProcessRunning(pid))) {
      return true;
    }
    await sleep(20);
  }
  return pids.every((pid) => !isProcessRunning(pid));
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function isChildRunning(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolvePositiveInteger(
  explicitValue: number | undefined,
  envValue: string | undefined,
  fallback: number,
  label: string,
): number {
  if (explicitValue !== undefined) {
    if (!Number.isSafeInteger(explicitValue) || explicitValue <= 0) {
      throw new Error(`${label}_must_be_a_positive_integer`);
    }
    return explicitValue;
  }
  const parsed = Number(envValue);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function appendBufferTail(
  current: Buffer<ArrayBufferLike>,
  chunk: unknown,
  maxBytes: number,
): Buffer<ArrayBufferLike> {
  const incoming = Buffer.from(String(chunk), 'utf8');
  if (incoming.length >= maxBytes) {
    return incoming.subarray(incoming.length - maxBytes);
  }
  const combined = Buffer.concat([current, incoming]);
  return combined.length <= maxBytes
    ? combined
    : combined.subarray(combined.length - maxBytes);
}

function bufferTailToString(buffer: Buffer<ArrayBufferLike>, maxBytes: number): string {
  let value = buffer.toString('utf8');
  while (value && Buffer.byteLength(value, 'utf8') > maxBytes) {
    value = value.slice(1);
  }
  return value;
}

let manager: ReplyRunManager | null = null;

export function getReplyRunManager(): ReplyRunManager {
  if (!manager) {
    manager = new ReplyRunManager();
  }
  return manager;
}
