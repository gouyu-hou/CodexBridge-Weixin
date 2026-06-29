import { WeixinAccountStore } from './account_store.js';
import { loadWeixinConfig } from './config.js';
import { WeixinPlatformPlugin } from './plugin.js';
import { resetSessionPause } from './official/session_guard.js';

interface MultiAccountWeixinPlatformPluginOptions {
  accountStore?: WeixinAccountStore;
  stateDir?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
  locale?: string | null;
  attachmentProcessingConcurrency?: number;
  accountPollConcurrency?: number;
}

interface AccountRuntime {
  accountId: string;
  plugin: WeixinPlatformPlugin;
  signature: string;
}

export class MultiAccountWeixinPlatformPlugin {
  constructor({
    accountStore = new WeixinAccountStore(),
    stateDir = null,
    env = process.env,
    locale = null,
    attachmentProcessingConcurrency = 3,
    accountPollConcurrency = 4,
  }: MultiAccountWeixinPlatformPluginOptions = {}) {
    this.id = 'weixin';
    this.displayName = 'WeChat';
    this.accountStore = accountStore;
    this.stateDir = stateDir;
    this.env = env;
    this.locale = locale;
    this.attachmentProcessingConcurrency = normalizeConcurrency(attachmentProcessingConcurrency, 3);
    this.accountPollConcurrency = normalizeConcurrency(accountPollConcurrency, 4);
    this.running = false;
    this.accounts = new Map();
  }

  id: string;
  displayName: string;
  accountStore: WeixinAccountStore;
  stateDir: string | null;
  env: NodeJS.ProcessEnv | Record<string, unknown>;
  locale: string | null;
  attachmentProcessingConcurrency: number;
  accountPollConcurrency: number;
  running: boolean;
  accounts: Map<string, AccountRuntime>;

  async start() {
    this.running = true;
    await this.refreshAccounts();
    if (this.accounts.size === 0) {
      const config = loadWeixinConfig({
        env: this.env,
        stateDir: this.stateDir ?? undefined,
        accountStore: this.accountStore,
      });
      if (config.accountId) {
        await this.startAccountRuntime(config.accountId);
      }
    }
  }

  async stop() {
    this.running = false;
    const plugins = [...this.accounts.values()].map((entry) => entry.plugin);
    this.accounts.clear();
    await Promise.all(plugins.map((plugin) => plugin.stop().catch(() => {})));
  }

  async restart() {
    const accountIds = new Set([
      ...this.accountStore.listAccounts(),
      ...this.accounts.keys(),
    ]);
    await this.stop();
    for (const accountId of accountIds) {
      resetSessionPause(accountId);
    }
    await this.start();
  }

  configureConcurrency({
    attachmentProcessingConcurrency,
    accountPollConcurrency,
  }: {
    attachmentProcessingConcurrency?: number | null;
    accountPollConcurrency?: number | null;
  }) {
    if (attachmentProcessingConcurrency !== undefined && attachmentProcessingConcurrency !== null) {
      this.attachmentProcessingConcurrency = normalizeConcurrency(attachmentProcessingConcurrency, 3);
      for (const runtime of this.accounts.values()) {
        runtime.plugin.configureConcurrency?.({
          attachmentProcessingConcurrency: this.attachmentProcessingConcurrency,
        });
      }
    }
    if (accountPollConcurrency !== undefined && accountPollConcurrency !== null) {
      this.accountPollConcurrency = normalizeConcurrency(accountPollConcurrency, 4);
    }
  }

  getStatus() {
    return {
      running: this.running,
      accountCount: this.accounts.size,
      activeAccountIds: [...this.accounts.keys()],
      attachmentProcessingConcurrency: this.attachmentProcessingConcurrency,
      accountPollConcurrency: this.accountPollConcurrency,
    };
  }

  async refreshAccount(accountId: string) {
    const normalizedAccountId = String(accountId ?? '').trim();
    if (!normalizedAccountId) {
      return;
    }
    const current = this.accounts.get(normalizedAccountId);
    const config = loadWeixinConfig({
      env: {
        ...this.env,
        WEIXIN_ACCOUNT_ID: normalizedAccountId,
      },
      stateDir: this.stateDir ?? undefined,
      accountStore: this.accountStore,
    });
    const account = this.accountStore.loadAccount(normalizedAccountId);
    const signature = accountRuntimeSignature(config, account);
    if (!config.enabled || account?.disabled) {
      if (current) {
        this.accounts.delete(normalizedAccountId);
        await current.plugin.stop().catch(() => {});
      }
      resetSessionPause(normalizedAccountId);
      return;
    }
    if (current && current.signature === signature) {
      return;
    }
    if (current) {
      this.accounts.delete(normalizedAccountId);
      await current.plugin.stop().catch(() => {});
    }
    resetSessionPause(normalizedAccountId);
    await this.startAccountRuntime(normalizedAccountId, config, signature);
  }

  async resetAccount(accountId: string) {
    const normalizedAccountId = String(accountId ?? '').trim();
    if (!normalizedAccountId) {
      return;
    }
    resetSessionPause(normalizedAccountId);
    await this.refreshAccount(normalizedAccountId);
  }

  async pollOnce({ syncCursor = null }: { syncCursor?: string | null } = {}) {
    await this.refreshAccounts();
    const accountIds = [...this.accounts.keys()];
    if (accountIds.length === 0) {
      return { syncCursor, events: [] };
    }
    const requestedCursors = parseCommittedCursors(syncCursor);
    const primaryAccountId = this.primaryAccountId(accountIds);
    const pollResults = await mapWithConcurrency(accountIds, this.accountPollConcurrency, async (accountId) => {
      const runtime = this.accounts.get(accountId);
      if (!runtime) {
        return null;
      }
      const result = await runtime.plugin.pollOnce({
        syncCursor: requestedCursors.get(accountId) ?? null,
      });
      return { accountId, result };
    });
    const nextCursors: Record<string, string | null> = {};
    const events: unknown[] = [];
    for (const entry of pollResults) {
      if (!entry) {
        continue;
      }
      nextCursors[entry.accountId] = entry.result.syncCursor ?? requestedCursors.get(entry.accountId) ?? null;
      events.push(
        ...(entry.result.events ?? []).map((event) => scopeEventToAccount(entry.accountId, event, primaryAccountId)),
      );
    }
    return {
      syncCursor: JSON.stringify({ accounts: nextCursors }),
      events,
    };
  }

  async commitSyncCursor(syncCursor: string | null | undefined) {
    const parsed = parseCommittedCursors(syncCursor);
    if (parsed.size === 0) {
      return '';
    }
    await Promise.all([...parsed.entries()].map(async ([accountId, accountSyncCursor]) => {
      const runtime = this.accounts.get(accountId);
      await runtime?.plugin.commitSyncCursor?.(accountSyncCursor);
    }));
    return JSON.stringify({ accounts: Object.fromEntries(parsed) });
  }

  async sendText({ externalScopeId, content }: { externalScopeId: string; content: string }) {
    await this.refreshAccountsIfRunning();
    const { accountId, scopeId } = parseAccountScopedExternalScopeId(externalScopeId);
    const runtime = accountId ? this.accounts.get(accountId) : this.firstRuntime();
    return runtime?.plugin.sendText({ externalScopeId: scopeId, content });
  }

  async sendTyping({ externalScopeId, status }: { externalScopeId: string; status: 'start' | 'stop' }) {
    await this.refreshAccountsIfRunning();
    const { accountId, scopeId } = parseAccountScopedExternalScopeId(externalScopeId);
    const runtime = accountId ? this.accounts.get(accountId) : this.firstRuntime();
    return runtime?.plugin.sendTyping?.({ externalScopeId: scopeId, status });
  }

  async sendMedia(params: { externalScopeId: string; filePath: string; caption?: string | null }) {
    await this.refreshAccountsIfRunning();
    const { accountId, scopeId } = parseAccountScopedExternalScopeId(params.externalScopeId);
    const runtime = accountId ? this.accounts.get(accountId) : this.firstRuntime();
    return runtime?.plugin.sendMedia?.({
      ...params,
      externalScopeId: scopeId,
    });
  }

  buildTextDeliveries(params: { externalScopeId: string; content: string }) {
    const { accountId, scopeId } = parseAccountScopedExternalScopeId(params.externalScopeId);
    const runtime = accountId ? this.accounts.get(accountId) : this.firstRuntime();
    return runtime?.plugin.buildTextDeliveries({
      ...params,
      externalScopeId: scopeId,
    }) ?? [];
  }

  loadSyncCursor() {
    return null;
  }

  private firstRuntime(): AccountRuntime | null {
    const primary = this.primaryAccountId([...this.accounts.keys()]);
    if (primary && this.accounts.has(primary)) {
      return this.accounts.get(primary) ?? null;
    }
    return this.accounts.values().next().value ?? null;
  }

  private async refreshAccountsIfRunning() {
    if (!this.running) {
      return;
    }
    await this.refreshAccounts();
  }

  private async refreshAccounts() {
    const accountIds = this.resolveAccountIds();
    const accountIdSet = new Set(accountIds);
    for (const [accountId, runtime] of [...this.accounts.entries()]) {
      if (!accountIdSet.has(accountId)) {
        this.accounts.delete(accountId);
        await runtime.plugin.stop().catch(() => {});
      }
    }
    for (const accountId of accountIds) {
      await this.refreshAccount(accountId);
    }
  }

  private resolveAccountIds() {
    const requested = normalizeCsv(this.env.WEIXIN_ACCOUNT_ID);
    if (requested.length > 0) {
      return requested;
    }
    const accountIds = this.accountStore
      .listAccounts()
      .filter((accountId) => !this.accountStore.isAccountDisabled(accountId));
    const primary = this.primaryAccountId(accountIds);
    return primary
      ? [primary, ...accountIds.filter((accountId) => accountId !== primary)]
      : accountIds;
  }

  private primaryAccountId(accountIds = this.accountStore.listAccounts()) {
    const explicitPrimary = normalizeCsv(this.env.WEIXIN_PRIMARY_ACCOUNT_ID)[0]
      ?? normalizeCsv(this.env.WEIXIN_ACCOUNT_ID)[0];
    if (explicitPrimary) {
      return explicitPrimary;
    }
    return accountIds
      .map((accountId) => ({
        accountId,
        savedAt: Date.parse(String(this.accountStore.loadAccount(accountId)?.saved_at ?? '')),
      }))
      .sort((left, right) => {
        const leftTime = Number.isFinite(left.savedAt) ? left.savedAt : Number.MAX_SAFE_INTEGER;
        const rightTime = Number.isFinite(right.savedAt) ? right.savedAt : Number.MAX_SAFE_INTEGER;
        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        return left.accountId.localeCompare(right.accountId);
      })[0]?.accountId ?? null;
  }

  private async startAccountRuntime(
    accountId: string,
    config: ReturnType<typeof loadWeixinConfig> | null = null,
    signature: string | null = null,
  ) {
    const resolvedConfig = config ?? loadWeixinConfig({
      env: {
        ...this.env,
        WEIXIN_ACCOUNT_ID: accountId,
      },
      stateDir: this.stateDir ?? undefined,
      accountStore: this.accountStore,
    });
    const account = this.accountStore.loadAccount(accountId);
    if (!resolvedConfig.accountId || !resolvedConfig.enabled || account?.disabled) {
      return;
    }
    const plugin = new WeixinPlatformPlugin({
      accountStore: this.accountStore,
      config: resolvedConfig,
      locale: this.locale,
      attachmentProcessingConcurrency: this.attachmentProcessingConcurrency,
    });
    await plugin.start();
    this.accounts.set(accountId, {
      accountId,
      plugin,
      signature: signature ?? accountRuntimeSignature(resolvedConfig, account),
    });
  }
}

function accountRuntimeSignature(
  config: ReturnType<typeof loadWeixinConfig>,
  account: ReturnType<WeixinAccountStore['loadAccount']>,
) {
  return JSON.stringify({
    accountId: config.accountId,
    token: config.token,
    baseUrl: config.baseUrl,
    cdnBaseUrl: config.cdnBaseUrl,
    dmPolicy: config.dmPolicy,
    groupPolicy: config.groupPolicy,
    allowFrom: config.allowFrom,
    groupAllowFrom: config.groupAllowFrom,
    maxMessageLength: config.maxMessageLength,
    user_id: account?.user_id ?? '',
    disabled: Boolean(account?.disabled),
    saved_at: account?.saved_at ?? '',
  });
}

function scopeEventToAccount(accountId: string, event: unknown, primaryAccountId: string | null) {
  if (!event || typeof event !== 'object') {
    return event;
  }
  const record = event as Record<string, unknown>;
  const externalScopeId = String(record.externalScopeId ?? '');
  if (!externalScopeId) {
    return event;
  }
  const nextExternalScopeId = accountId === primaryAccountId
    ? externalScopeId
    : formatAccountScopedExternalScopeId(accountId, externalScopeId);
  return {
    ...record,
    externalScopeId: nextExternalScopeId,
    metadata: {
      ...(record.metadata && typeof record.metadata === 'object' ? record.metadata as Record<string, unknown> : {}),
      weixinAccountId: accountId,
    },
  };
}

export function formatAccountScopedExternalScopeId(accountId: string, externalScopeId: string) {
  return `${accountId}:${externalScopeId}`;
}

export function parseAccountScopedExternalScopeId(externalScopeId: string) {
  const normalized = String(externalScopeId ?? '');
  const separatorIndex = normalized.indexOf(':');
  if (separatorIndex <= 0) {
    return { accountId: null, scopeId: normalized };
  }
  return {
    accountId: normalized.slice(0, separatorIndex),
    scopeId: normalized.slice(separatorIndex + 1),
  };
}

function normalizeCsv(value: unknown) {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseCommittedCursors(value: unknown): Map<string, string | null> {
  const cursors = new Map<string, string | null>();
  if (typeof value !== 'string' || !value.trim()) {
    return cursors;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.accounts && typeof parsed.accounts === 'object' && !Array.isArray(parsed.accounts)) {
      for (const [accountId, accountSyncCursor] of Object.entries(parsed.accounts)) {
        const normalizedAccountId = String(accountId ?? '').trim();
        if (!normalizedAccountId) {
          continue;
        }
        cursors.set(normalizedAccountId, typeof accountSyncCursor === 'string' ? accountSyncCursor : null);
      }
      return cursors;
    }
    const accountId = String(parsed?.accountId ?? '').trim();
    if (!accountId) {
      return cursors;
    }
    cursors.set(accountId, typeof parsed?.syncCursor === 'string' ? parsed.syncCursor : null);
    return cursors;
  } catch {
    return cursors;
  }
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
  return Math.max(1, Math.min(parsed, 32));
}
