export type JsonObject = Record<string, unknown>;

export type BridgeStatus = JsonObject & {
  activeEventDispatches?: number;
  activeTurns?: number;
  maxConcurrentTurns?: number;
  running?: boolean;
  startedAt?: string;
};

export type AdminAccount = JsonObject & {
  accountId: string;
  baseUrl?: string;
  displayName?: string;
  disabled?: boolean;
  group?: string;
  modelProvider?: {
    model?: string;
    providerProfileId?: string;
    reasoningEffort?: string;
  };
  permissions?: {
    canChat?: boolean;
    canExecuteCommands?: boolean;
    canUpload?: boolean;
  };
  primary?: boolean;
  role?: string;
  savedAt?: string;
  syncUpdatedAt?: string;
  userId?: string;
};

export type ProviderProfile = JsonObject & {
  baseUrl?: string;
  defaultModel?: string;
  displayName?: string;
  id?: string;
  label?: string;
  model?: string;
  models?: string[];
  provider?: string;
  providerKind?: string;
  providerProfileId?: string;
};

export type ProviderModel = JsonObject & {
  capabilities?: string[];
  id: string;
  label?: string;
  reasoningEfforts?: string[];
};

export type ProviderModelCatalog = JsonObject & {
  expiresAt?: number;
  models?: ProviderModel[];
  providerProfileId?: string;
  source?: string;
  warning?: string;
};

export type ProviderUsageWindow = JsonObject & {
  name?: string;
  resetAfterSeconds?: number;
  usedPercent?: number;
};

export type ProviderUsage = JsonObject & {
  providerKind?: string;
  refreshFailed?: boolean;
  report?: JsonObject & {
    buckets?: Array<JsonObject & { name?: string; windows?: ProviderUsageWindow[] }>;
    plan?: string;
    provider?: string;
  };
  source?: string;
  status?: string;
  message?: string;
  providerProfileId?: string;
  windows?: ProviderUsageWindow[];
};

export type ModelProviderSettings = JsonObject & {
  apiKeyConfigured?: boolean;
  apiKeyMasked?: string;
  baseUrl?: string;
  capabilities?: string;
  ccswitch?: JsonObject;
  model?: string;
  modelIds?: string;
  profileId?: string;
  providerId?: string;
  providerName?: string;
  serviceEnvFile?: string;
  source?: string;
};

export type AdminSettings = JsonObject & {
  alertWebhookUrl?: string;
  concurrency?: JsonObject;
  logCleanup?: JsonObject;
  modelProvider?: ModelProviderSettings;
};

export type PairingState = JsonObject & {
  account?: AdminAccount;
  error?: string;
  accountId?: string;
  expiresAt?: string;
  qrImageDataUrl?: string;
  qrUrl?: string;
  status?: string;
};

export type AdminState = JsonObject & {
  accounts?: AdminAccount[];
  adminUrl?: string | null;
  bridge?: BridgeStatus;
  logs?: AdminLogs;
  pairing?: PairingState | null;
  primaryAccountId?: string | null;
  providerProfiles?: ProviderProfile[];
  service?: { shutdownAvailable?: boolean };
  settings?: AdminSettings;
  setup?: JsonObject;
  stateDir?: string;
};

export type AccountMetrics = JsonObject & {
  avgTurnDurationMs?: number;
  messagesReceived?: number;
  turnsCompleted?: number;
  turnsFailed?: number;
};

export type AdminMetrics = JsonObject & {
  avgTurnDurationMs?: number;
  byAccount?: Record<string, AccountMetrics>;
  deliveriesFailed?: number;
  deliveriesSucceeded?: number;
  errors?: number;
  errorsRecentHour?: number;
  messagesReceived?: number;
  pendingDeliveryRetries?: number;
  replyFailures?: number;
  turnsCompleted?: number;
  turnsFailed?: number;
};

export type DiagnosticAction = JsonObject & {
  action?: string;
  label?: string;
  target?: string;
};

export type DiagnosticCheck = JsonObject & {
  actions?: DiagnosticAction[];
  detail?: string;
  id?: string;
  reason?: string;
  status?: 'ok' | 'warn' | 'fail';
  title?: string;
};

export type DiagnosticsResult = JsonObject & {
  checks?: DiagnosticCheck[];
  generatedAt?: string;
  summary?: JsonObject & {
    failed?: number;
    ok?: number;
    status?: 'ok' | 'warn' | 'fail';
    text?: string;
    warned?: number;
  };
};

export type AdminSession = JsonObject & {
  accountIds?: string[];
  archived?: boolean;
  codexThreadId?: string;
  cwd?: string;
  id: string;
  model?: string;
  pinned?: boolean;
  preview?: string;
  provider?: string;
  title?: string;
  updatedAt?: string;
};

export type SessionsResponse = JsonObject & {
  returned?: number;
  sessions?: AdminSession[];
  total?: number;
};

export type SessionHistoryMessage = JsonObject & {
  role?: 'user' | 'assistant';
  text?: string;
  timestamp?: string;
};

export type SessionHistoryResponse = JsonObject & {
  messages?: SessionHistoryMessage[];
  sessionPath?: string | null;
  total?: number;
  truncated?: boolean;
};

export type AdminLogFile = JsonObject & {
  label?: string;
  lines?: string[];
  path?: string;
  size?: number;
  updatedAt?: string;
};

export type AdminLogs = JsonObject & {
  files?: AdminLogFile[];
  lines?: string[];
  totalBytes?: number;
};

export type BasicMutationResponse = JsonObject & {
  bridge?: BridgeStatus;
  message?: string;
  ok?: boolean;
  state?: AdminState;
};
