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
  allowChat?: boolean;
  allowCommands?: boolean;
  allowUploads?: boolean;
  displayName?: string;
  enabled?: boolean;
  model?: string;
  primary?: boolean;
  providerProfileId?: string;
  reasoningEffort?: string;
  role?: string;
  userId?: string;
};

export type ProviderProfile = JsonObject & {
  baseUrl?: string;
  id: string;
  label?: string;
  model?: string;
  provider?: string;
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
  label?: string;
  limit?: number;
  remaining?: number;
  resetAfterSeconds?: number;
  used?: number;
};

export type ProviderUsage = JsonObject & {
  available?: boolean;
  message?: string;
  providerProfileId?: string;
  windows?: ProviderUsageWindow[];
};

export type AdminSettings = JsonObject & {
  alertWebhookUrl?: string;
  concurrency?: JsonObject;
  logCleanup?: JsonObject;
  modelProvider?: JsonObject;
};

export type PairingState = JsonObject & {
  account?: AdminAccount;
  error?: string;
  expiresAt?: string;
  qrCodeDataUrl?: string;
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
