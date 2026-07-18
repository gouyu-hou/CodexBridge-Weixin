import type { Translator } from '../i18n/index.js';
import type { SessionSettings } from '../types/core.js';
import {
  normalizePermissionsMode,
  resolvePermissionsState,
  type ResolvedPermissionsState,
} from './permissions_mode.js';

export function normalizePermissionsCommandArg(
  value: unknown,
): NonNullable<SessionSettings['permissionsMode']> | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === 'default') {
    return 'default-permissions';
  }
  if (normalized === 'read-only') {
    return null;
  }
  return normalizePermissionsMode(normalized);
}

export function formatPermissionsMode(
  mode: NonNullable<SessionSettings['permissionsMode']>,
  i18n: Translator,
): string {
  switch (mode) {
    case 'auto-review':
      return i18n.t('coordinator.permissions.mode.autoReview');
    case 'full-access':
      return i18n.t('coordinator.permissions.mode.fullAccess');
    case 'custom':
      return i18n.t('coordinator.permissions.mode.custom');
    case 'default-permissions':
    default:
      return i18n.t('coordinator.permissions.mode.defaultPermissions');
  }
}

export function formatApprovalPolicyValue(
  state: ResolvedPermissionsState,
  i18n: Translator,
): string {
  if (state.usesProfileDefaults) {
    return i18n.t('coordinator.permissions.configuredInProfile');
  }
  return state.approvalPolicy ?? i18n.t('common.notSet');
}

export function formatSandboxModeValue(
  state: ResolvedPermissionsState,
  i18n: Translator,
): string {
  if (state.usesProfileDefaults) {
    return i18n.t('coordinator.permissions.configuredInProfile');
  }
  return state.sandboxMode ?? i18n.t('common.notSet');
}

export function formatApprovalsReviewerValue(
  state: ResolvedPermissionsState,
  i18n: Translator,
): string {
  if (state.permissionsMode === 'full-access') {
    return i18n.t('coordinator.permissions.notApplicable');
  }
  if (state.usesProfileDefaults) {
    return i18n.t('coordinator.permissions.configuredInProfile');
  }
  if (state.approvalsReviewer === 'auto_review') {
    return i18n.t('coordinator.permissions.reviewer.autoReview');
  }
  if (state.approvalsReviewer === 'user') {
    return i18n.t('coordinator.permissions.reviewer.user');
  }
  return i18n.t('common.notSet');
}

export function renderPermissionsLines(
  settings: Parameters<typeof resolvePermissionsState>[0],
  i18n: Translator,
): string[] {
  const state = resolvePermissionsState(settings);
  return [
    i18n.t('coordinator.permissions.current', {
      value: formatPermissionsMode(state.permissionsMode, i18n),
    }),
    i18n.t('coordinator.status.approvalPolicy', {
      value: formatApprovalPolicyValue(state, i18n),
    }),
    i18n.t('coordinator.status.sandboxMode', {
      value: formatSandboxModeValue(state, i18n),
    }),
    i18n.t('coordinator.status.approvalsReviewer', {
      value: formatApprovalsReviewerValue(state, i18n),
    }),
    '',
    i18n.t('coordinator.permissions.availableCommands'),
    '- /permissions default-permissions',
    '- /permissions auto-review',
    '- /permissions full-access',
    '- /permissions custom',
    '',
    i18n.t('coordinator.permissions.notes'),
    i18n.t('coordinator.permissions.defaultPermissionsDesc'),
    i18n.t('coordinator.permissions.autoReviewDesc'),
    i18n.t('coordinator.permissions.fullAccessDesc'),
    i18n.t('coordinator.permissions.customDesc'),
    '',
    i18n.t('coordinator.permissions.applyNextTurn'),
  ];
}
