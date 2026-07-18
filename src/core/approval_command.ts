import type { Translator } from '../i18n/index.js';
import type { ProviderApprovalRequest } from '../types/provider.js';

export type ApprovalOption = 1 | 2 | 3;

export function parseAllowCommandArgs(args: readonly unknown[]): {
  option: ApprovalOption | null;
  requestIndex: number;
} {
  const option = normalizeAllowOption(args[0]);
  const parsedIndex = Number.parseInt(String(args[1] ?? ''), 10);
  return {
    option,
    requestIndex: Number.isFinite(parsedIndex) && parsedIndex > 0 ? parsedIndex : 1,
  };
}

export function renderAllowLines(
  requests: ProviderApprovalRequest[],
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.allow.title', { count: requests.length }),
  ];
  if (requests.length > 1) {
    lines.push(i18n.t('coordinator.allow.requestIndexHint'));
  }
  const visibleRequests = requests.slice(0, 3);
  for (const [index, request] of visibleRequests.entries()) {
    if (lines.length > 1) {
      lines.push('');
    }
    lines.push(...renderApprovalRequestLines(request, index + 1, i18n));
  }
  if (requests.length > visibleRequests.length) {
    lines.push('');
    lines.push(i18n.t('coordinator.allow.moreRequests', {
      count: requests.length - visibleRequests.length,
    }));
  }
  return lines;
}

export function renderApprovalPromptLines(
  requests: ProviderApprovalRequest[],
  i18n: Translator,
): string[] {
  const visibleRequest = requests[0] ?? null;
  const lines = [
    i18n.t('coordinator.allow.title', { count: requests.length }),
  ];
  if (visibleRequest) {
    lines.push(i18n.t('coordinator.allow.requestHeader', {
      index: 1,
      kind: formatApprovalKind(visibleRequest.kind, i18n),
    }));
    if (visibleRequest.reason) {
      lines.push(i18n.t('coordinator.allow.reason', {
        value: truncateInlineText(visibleRequest.reason, 160),
      }));
    }
  }
  lines.push(i18n.t('coordinator.allow.promptView'));
  if (requests.length > 1) {
    lines.push(i18n.t('coordinator.allow.promptDecisionsIndexed'));
  } else if (visibleRequest && !supportsSessionWideApproval(visibleRequest)) {
    lines.push(i18n.t('coordinator.allow.promptDecisionsSingleNoRemember'));
  } else {
    lines.push(i18n.t('coordinator.allow.promptDecisionsSingle'));
  }
  return lines;
}

export function renderAllowAcknowledgementLines(
  request: ProviderApprovalRequest,
  option: ApprovalOption,
  i18n: Translator,
  activeTurnContinues = true,
): string[] {
  const followUpLine = activeTurnContinues
    ? (option === 3 ? i18n.t('coordinator.allow.waitModel') : i18n.t('coordinator.allow.continue'))
    : i18n.t('coordinator.allow.noLongerActive');
  if (option === 1) {
    return [
      i18n.t('coordinator.allow.approvedOnce', { kind: formatApprovalKind(request.kind, i18n) }),
      followUpLine,
    ];
  }
  if (option === 2) {
    return [
      i18n.t('coordinator.allow.approvedSession', { kind: formatApprovalKind(request.kind, i18n) }),
      followUpLine,
    ];
  }
  return [
    i18n.t('coordinator.allow.denied', { kind: formatApprovalKind(request.kind, i18n) }),
    followUpLine,
  ];
}

export function supportsSessionWideApproval(request: ProviderApprovalRequest): boolean {
  if (request.kind === 'permissions' || request.kind === 'file_change') {
    return true;
  }
  return Boolean(
    request.availableDecisionKeys?.includes('acceptForSession')
    || request.availableDecisionKeys?.includes('acceptWithExecpolicyAmendment')
    || (request.execPolicyAmendment && request.execPolicyAmendment.length > 0),
  );
}

function normalizeAllowOption(value: unknown): ApprovalOption | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['1', 'once', 'yes', 'y', 'approve'].includes(normalized)) {
    return 1;
  }
  if (['2', 'session', 'always', 'remember', 'allow'].includes(normalized)) {
    return 2;
  }
  if (['3', 'deny', 'no', 'n', 'reject'].includes(normalized)) {
    return 3;
  }
  return null;
}

function renderApprovalRequestLines(
  request: ProviderApprovalRequest,
  index: number,
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.allow.requestHeader', {
      index,
      kind: formatApprovalKind(request.kind, i18n),
    }),
  ];
  if (request.reason) {
    lines.push(i18n.t('coordinator.allow.reason', { value: request.reason }));
  }
  if (request.command) {
    lines.push(i18n.t('coordinator.allow.command', { value: request.command }));
  }
  if (request.cwd) {
    lines.push(i18n.t('coordinator.allow.cwd', { value: request.cwd }));
  }
  if (request.fileChanges?.length) {
    lines.push(i18n.t('coordinator.allow.files', { value: request.fileChanges.join(', ') }));
  }
  if (request.grantRoot) {
    lines.push(i18n.t('coordinator.allow.grantRoot', { value: request.grantRoot }));
  }
  if (request.networkPermission != null) {
    lines.push(i18n.t('coordinator.allow.network', {
      value: request.networkPermission ? i18n.t('common.enabled') : i18n.t('common.disabled'),
    }));
  }
  if (request.fileReadPermissions?.length) {
    lines.push(i18n.t('coordinator.allow.fileRead', { value: request.fileReadPermissions.join(', ') }));
  }
  if (request.fileWritePermissions?.length) {
    lines.push(i18n.t('coordinator.allow.fileWrite', { value: request.fileWritePermissions.join(', ') }));
  }
  lines.push(i18n.t('coordinator.allow.options'));
  lines.push(i18n.t('coordinator.allow.option1'));
  lines.push(supportsSessionWideApproval(request)
    ? i18n.t('coordinator.allow.option2')
    : i18n.t('coordinator.allow.option2Unavailable'));
  lines.push(i18n.t('coordinator.allow.option3'));
  lines.push(i18n.t('coordinator.allow.help'));
  return lines;
}

function formatApprovalKind(kind: ProviderApprovalRequest['kind'], i18n: Translator): string {
  if (kind === 'permissions') {
    return i18n.t('coordinator.allow.kind.permissions');
  }
  if (kind === 'file_change') {
    return i18n.t('coordinator.allow.kind.fileChange');
  }
  return i18n.t('coordinator.allow.kind.command');
}

function truncateInlineText(value: string, limit: number): string {
  const normalized = String(value ?? '').trim().replace(/\s+/gu, ' ');
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
