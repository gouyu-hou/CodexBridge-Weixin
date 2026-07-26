export type WebPermissionsMode = 'default-permissions' | 'auto-review' | 'full-access' | 'custom';
export type WebApprovalsReviewer = 'user' | 'auto_review';
export type WebLegacyAccessPreset = 'read-only' | 'default' | 'full-access';

export type WebPermissionSettings = {
  permissionsMode?: WebPermissionsMode | null;
  accessPreset?: WebLegacyAccessPreset | null;
  approvalPolicy?: string | null;
  sandboxMode?: string | null;
  approvalsReviewer?: WebApprovalsReviewer | null;
};

export type ResolvedPermissionsState = {
  permissionsMode: WebPermissionsMode;
  accessPreset: WebLegacyAccessPreset | null;
  approvalPolicy: string | null;
  sandboxMode: string | null;
  approvalsReviewer: WebApprovalsReviewer | null;
  usesProfileDefaults: boolean;
};

const PERMISSIONS_MODES = new Set<WebPermissionsMode>([
  'default-permissions',
  'auto-review',
  'full-access',
  'custom',
]);

const LEGACY_ACCESS_PRESETS = new Set<WebLegacyAccessPreset>([
  'read-only',
  'default',
  'full-access',
]);

export function normalizeApprovalsReviewer(value: unknown): WebApprovalsReviewer | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'user' || normalized === 'auto_review' ? normalized : null;
}

export function normalizePermissionsMode(value: unknown): WebPermissionsMode | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return PERMISSIONS_MODES.has(normalized as WebPermissionsMode)
    ? normalized as WebPermissionsMode
    : null;
}

export function normalizeLegacyAccessPreset(value: unknown): WebLegacyAccessPreset | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return LEGACY_ACCESS_PRESETS.has(normalized as WebLegacyAccessPreset)
    ? normalized as WebLegacyAccessPreset
    : null;
}

export function buildPermissionsSettingsUpdate(mode: WebPermissionsMode): WebPermissionSettings {
  switch (mode) {
    case 'auto-review':
      return {
        permissionsMode: mode,
        accessPreset: 'default',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalsReviewer: 'auto_review',
      };
    case 'full-access':
      return {
        permissionsMode: mode,
        accessPreset: 'full-access',
        approvalPolicy: 'never',
        sandboxMode: 'danger-full-access',
        approvalsReviewer: null,
      };
    case 'custom':
      return {
        permissionsMode: mode,
        accessPreset: null,
        approvalPolicy: null,
        sandboxMode: null,
        approvalsReviewer: null,
      };
    default:
      return {
        permissionsMode: 'default-permissions',
        accessPreset: 'default',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        approvalsReviewer: 'user',
      };
  }
}

export function resolvePermissionsState(
  settings: WebPermissionSettings | null | undefined,
): ResolvedPermissionsState {
  const explicitMode = normalizePermissionsMode(settings?.permissionsMode);
  const reviewer = normalizeApprovalsReviewer(settings?.approvalsReviewer);

  if (explicitMode === 'default-permissions' || explicitMode === 'auto-review') {
    return {
      permissionsMode: explicitMode,
      accessPreset: 'default',
      approvalPolicy: settings?.approvalPolicy ?? 'on-request',
      sandboxMode: settings?.sandboxMode ?? 'workspace-write',
      approvalsReviewer: reviewer ?? (explicitMode === 'auto-review' ? 'auto_review' : 'user'),
      usesProfileDefaults: false,
    };
  }
  if (explicitMode === 'full-access') {
    return {
      permissionsMode: explicitMode,
      accessPreset: 'full-access',
      approvalPolicy: settings?.approvalPolicy ?? 'never',
      sandboxMode: settings?.sandboxMode ?? 'danger-full-access',
      approvalsReviewer: null,
      usesProfileDefaults: false,
    };
  }
  if (explicitMode === 'custom') {
    return {
      permissionsMode: explicitMode,
      accessPreset: normalizeLegacyAccessPreset(settings?.accessPreset),
      approvalPolicy: settings?.approvalPolicy ?? null,
      sandboxMode: settings?.sandboxMode ?? null,
      approvalsReviewer: reviewer,
      usesProfileDefaults: settings?.approvalPolicy == null
        && settings?.sandboxMode == null
        && reviewer == null,
    };
  }

  const legacyPreset = normalizeLegacyAccessPreset(settings?.accessPreset);
  if (legacyPreset === 'full-access') {
    return {
      permissionsMode: 'full-access',
      accessPreset: legacyPreset,
      approvalPolicy: settings?.approvalPolicy ?? 'never',
      sandboxMode: settings?.sandboxMode ?? 'danger-full-access',
      approvalsReviewer: null,
      usesProfileDefaults: false,
    };
  }
  if (legacyPreset === 'default' || legacyPreset === 'read-only') {
    return {
      permissionsMode: legacyPreset === 'default' ? 'default-permissions' : 'custom',
      accessPreset: legacyPreset,
      approvalPolicy: settings?.approvalPolicy ?? 'on-request',
      sandboxMode: settings?.sandboxMode ?? (legacyPreset === 'default' ? 'workspace-write' : 'read-only'),
      approvalsReviewer: reviewer ?? 'user',
      usesProfileDefaults: false,
    };
  }
  if (settings?.sandboxMode === 'danger-full-access' && settings?.approvalPolicy === 'never') {
    return {
      permissionsMode: 'full-access',
      accessPreset: 'full-access',
      approvalPolicy: 'never',
      sandboxMode: 'danger-full-access',
      approvalsReviewer: null,
      usesProfileDefaults: false,
    };
  }
  if (settings?.sandboxMode === 'workspace-write' && settings?.approvalPolicy === 'on-request') {
    return {
      permissionsMode: reviewer === 'auto_review' ? 'auto-review' : 'default-permissions',
      accessPreset: 'default',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      approvalsReviewer: reviewer ?? 'user',
      usesProfileDefaults: false,
    };
  }
  return {
    permissionsMode: 'custom',
    accessPreset: null,
    approvalPolicy: settings?.approvalPolicy ?? null,
    sandboxMode: settings?.sandboxMode ?? null,
    approvalsReviewer: reviewer,
    usesProfileDefaults: settings?.approvalPolicy == null
      && settings?.sandboxMode == null
      && reviewer == null,
  };
}
