import { parseSlashCommand } from '../../core/command_parser.js';

interface CompletionLike {
  then?: (onfulfilled?: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) => unknown;
}

interface EventOutcome {
  completion?: CompletionLike | null;
  afterCommit?: (() => Promise<void> | void) | null;
}

type PollerErrorStage = 'poll' | 'commit';

interface WeixinPollerPlugin {
  loadSyncCursor?: () => string | null;
  pollOnce(params: { syncCursor: string | null }): Promise<{ syncCursor?: string | null; events?: unknown[] }>;
  commitSyncCursor?: (syncCursor: string | null | undefined) => Promise<void>;
}

interface PendingCursorCommit {
  syncCursor: string | null | undefined;
  afterCommitActions: Array<() => Promise<void> | void>;
}

interface WeixinPollerOptions {
  plugin: WeixinPollerPlugin;
  onEvent?: (event: unknown) => Promise<EventOutcome | void> | EventOutcome | void;
  onSuccess?: (params: { syncCursor: string | null | undefined; eventCount: number }) => Promise<void> | void;
  onCommitSuccess?: (params: { syncCursor: string | null | undefined }) => Promise<void> | void;
  onError?: (error: unknown, context: { stage: PollerErrorStage }) => Promise<void> | void;
  sleep?: (ms: number) => Promise<void>;
  idlePollDelayMs?: number;
  commitRetryDelayMs?: number;
  eventDispatchConcurrency?: number;
  pollTimeoutMs?: number;
}

export class WeixinPoller {
  constructor({
    plugin,
    onEvent = async () => {},
    onSuccess = async () => {},
    onCommitSuccess = async () => {},
    onError = async () => {},
    sleep = defaultSleep,
    idlePollDelayMs = 1000,
    commitRetryDelayMs = 2000,
    eventDispatchConcurrency = 8,
    pollTimeoutMs = 0,
  }: WeixinPollerOptions) {
    this.plugin = plugin;
    this.onEvent = onEvent;
    this.onSuccess = onSuccess;
    this.onCommitSuccess = onCommitSuccess;
    this.onError = onError;
    this.sleep = sleep;
    this.idlePollDelayMs = Math.max(0, Number(idlePollDelayMs) || 0);
    this.commitRetryDelayMs = commitRetryDelayMs;
    this.eventDispatchConcurrency = normalizeConcurrency(eventDispatchConcurrency, 8);
    this.pollTimeoutMs = Math.max(0, Number(pollTimeoutMs) || 0);
    this.running = false;
    this.nextSyncCursor = null;
    this.pendingCursorCommits = [];
    this.commitPumpPromise = null;
    this.commitBlocked = false;
    this.commitRetryTimer = null;
  }

  plugin: WeixinPollerPlugin;
  onEvent: (event: unknown) => Promise<EventOutcome | void> | EventOutcome | void;
  onSuccess: (params: { syncCursor: string | null | undefined; eventCount: number }) => Promise<void> | void;
  onCommitSuccess: (params: { syncCursor: string | null | undefined }) => Promise<void> | void;
  onError: (error: unknown, context: { stage: PollerErrorStage }) => Promise<void> | void;
  sleep: (ms: number) => Promise<void>;
  idlePollDelayMs: number;
  commitRetryDelayMs: number;
  eventDispatchConcurrency: number;
  pollTimeoutMs: number;
  running: boolean;
  nextSyncCursor: string | null;
  pendingCursorCommits: PendingCursorCommit[];
  commitPumpPromise: Promise<void> | null;
  commitBlocked: boolean;
  commitRetryTimer: ReturnType<typeof setTimeout> | null;

  async start() {
    this.running = true;
    this.nextSyncCursor = this.plugin.loadSyncCursor?.() ?? null;
    while (this.running) {
      try {
        const result = await this.callPollOnce(this.nextSyncCursor);
        this.nextSyncCursor = result?.syncCursor ?? this.nextSyncCursor;
        const events = result?.events ?? [];
        const dispatchOutcome = await this.dispatchEvents(events);
        void dispatchOutcome.completion.catch(async (error) => {
          // Service-mode cursor persistence must not wait on long-running turn completion.
          // We still surface background failures through onError for observability.
          await this.onError(error, { stage: 'poll' });
        });
        this.enqueueCursorCommit({
          syncCursor: result?.syncCursor ?? this.nextSyncCursor,
          afterCommitActions: dispatchOutcome.afterCommitActions,
        });
        this.ensureCommitPump();
        await Promise.resolve(this.onSuccess({
          syncCursor: result?.syncCursor ?? this.nextSyncCursor,
          eventCount: Array.isArray(events) ? events.length : 0,
        })).catch(async (error) => {
          await this.onError(error, { stage: 'poll' });
        });
        if (this.running && (!Array.isArray(events) || events.length === 0) && this.idlePollDelayMs > 0) {
          await this.sleep(this.idlePollDelayMs);
        }
      } catch (error) {
        await this.onError(error, { stage: 'poll' });
        await this.sleep(2000);
      }
    }
    if (this.pendingCursorCommits.length > 0 && !this.commitPumpPromise && !this.commitBlocked) {
      this.ensureCommitPump();
    }
    await this.commitPumpPromise;
  }

  stop() {
    this.running = false;
    if (this.commitRetryTimer) {
      clearTimeout(this.commitRetryTimer);
      this.commitRetryTimer = null;
    }
    this.commitBlocked = false;
    this.ensureCommitPump();
  }

  async callPollOnce(syncCursor: string | null) {
    const call = this.plugin.pollOnce({ syncCursor });
    if (!this.pollTimeoutMs || this.pollTimeoutMs <= 0) {
      return call;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`weixin poll timed out after ${this.pollTimeoutMs}ms`)),
        this.pollTimeoutMs,
      );
    });
    try {
      return await Promise.race([call, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async dispatchEvents(events: unknown[]) {
    const outcomes = await mapWithConcurrency(collapseRestartEvents(events), this.eventDispatchConcurrency, async (event) => {
      const outcome = await this.onEvent(event);
      const completion = extractCompletionPromise(outcome);
      const afterCommit = extractAfterCommitAction(outcome);
      return { completion, afterCommit };
    });
    const completions = outcomes
      .map((outcome) => outcome.completion)
      .filter((completion): completion is Promise<void> => Boolean(completion));
    const afterCommitActions = outcomes
      .map((outcome) => outcome.afterCommit)
      .filter((afterCommit): afterCommit is () => Promise<void> | void => Boolean(afterCommit));
    return {
      completion: completions.length === 0 ? Promise.resolve() : Promise.all(completions).then(() => {}),
      afterCommitActions,
    };
  }

  enqueueCursorCommit(entry: PendingCursorCommit) {
    this.pendingCursorCommits.push(entry);
  }

  ensureCommitPump() {
    if (this.commitPumpPromise || this.commitBlocked || this.pendingCursorCommits.length === 0) {
      return;
    }
    this.commitPumpPromise = this.runCommitPump()
      .finally(() => {
        this.commitPumpPromise = null;
        if (this.pendingCursorCommits.length > 0 && !this.commitBlocked) {
          this.ensureCommitPump();
        }
      });
  }

  async runCommitPump() {
    while (this.pendingCursorCommits.length > 0) {
      const entry = this.pendingCursorCommits[0];
      try {
        await this.plugin.commitSyncCursor?.(entry.syncCursor);
        for (const afterCommit of entry.afterCommitActions) {
          await afterCommit();
        }
        this.pendingCursorCommits.shift();
        await Promise.resolve(this.onCommitSuccess({ syncCursor: entry.syncCursor })).catch(async (error) => {
          await this.onError(error, { stage: 'commit' });
        });
      } catch (error) {
        this.commitBlocked = true;
        await this.onError(error, { stage: 'commit' });
        this.scheduleCommitRetry();
        return;
      }
    }
  }

  scheduleCommitRetry() {
    if (!this.running || this.commitRetryTimer || this.pendingCursorCommits.length === 0) {
      return;
    }
    this.commitRetryTimer = setTimeout(() => {
      this.commitRetryTimer = null;
      if (!this.running) {
        return;
      }
      this.commitBlocked = false;
      if (this.pendingCursorCommits.length > 0) {
        this.ensureCommitPump();
      }
    }, this.commitRetryDelayMs);
  }
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R> | R,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const limit = Math.min(normalizeConcurrency(concurrency, 1), items.length);
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }));
  return results;
}

function normalizeConcurrency(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(parsed, 64));
}

function extractCompletionPromise(outcome: EventOutcome | void): Promise<void> | null {
  if (!outcome) {
    return null;
  }
  const completion = outcome.completion;
  if (!completion || typeof completion.then !== 'function') {
    return null;
  }
  return Promise.resolve(completion).then(() => {});
}

function extractAfterCommitAction(outcome: EventOutcome | void): (() => Promise<void> | void) | null {
  if (!outcome || typeof outcome.afterCommit !== 'function') {
    return null;
  }
  return outcome.afterCommit;
}

function collapseRestartEvents(events: unknown[]) {
  const latestRestartIndexByScope = new Map<string, number>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index] as any;
    const scopeId = typeof event?.externalScopeId === 'string' ? event.externalScopeId : '';
    const command = parseSlashCommand(String(event?.text ?? ''));
    if (!scopeId || command?.name !== 'restart') {
      continue;
    }
    const previousIndex = latestRestartIndexByScope.get(scopeId);
    if (previousIndex === undefined) {
      latestRestartIndexByScope.set(scopeId, index);
      continue;
    }
    const previousEvent = events[previousIndex] as any;
    const previousMessageId = parseMessageId(previousEvent?.metadata?.weixin?.messageId);
    const currentMessageId = parseMessageId(event?.metadata?.weixin?.messageId);
    if (currentMessageId !== null && previousMessageId !== null) {
      if (currentMessageId >= previousMessageId) {
        latestRestartIndexByScope.set(scopeId, index);
      }
      continue;
    }
    latestRestartIndexByScope.set(scopeId, index);
  }

  return events.filter((event, index) => {
    const anyEvent = event as any;
    const scopeId = typeof anyEvent?.externalScopeId === 'string' ? anyEvent.externalScopeId : '';
    const command = parseSlashCommand(String(anyEvent?.text ?? ''));
    if (!scopeId || command?.name !== 'restart') {
      return true;
    }
    return latestRestartIndexByScope.get(scopeId) === index;
  });
}

function parseMessageId(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
