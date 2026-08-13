import path from 'node:path';
import { formatPlatformScopeKey } from './contracts.js';
import { parseJsonObject } from './json_object_parser.js';
import { normalizeLocale, type Translator } from '../i18n/index.js';
import type { CodexInstructionsSnapshot } from '../providers/codex/instructions_state.js';
import type { PlatformScopeRef } from '../types/core.js';
import type { InboundTextEvent } from '../types/platform.js';

export const INSTRUCTIONS_COMMAND_SKILL_ACTIONS = new Set([
  'propose_patch',
  'propose_replace',
  'propose_clear',
  'update_pending_draft',
  'clarify',
  'reject',
  'local_only',
] as const);

const INSTRUCTIONS_COMMAND_SKILL_PATH = path.resolve('docs/command-skills/instructions.md');

export type InstructionsProposalKind = 'patch' | 'replace' | 'clear';

export type PendingInstructionsCapture = {
  startedAt: number;
};

export type PendingInstructionsOperation = {
  kind: InstructionsProposalKind;
  createdAt: number;
  rawInput: string;
  summary: string;
  changes: string[];
  proposedContent: string;
  baseContent: string;
  normalizedBy: 'codex' | 'local';
};

export type InstructionsCommandSkillResult =
  | {
    action: 'propose_patch' | 'propose_replace' | 'propose_clear';
    confidence: number;
    summary: string;
    changes: string[];
    proposedContent: string;
  }
  | {
    action: 'update_pending_draft';
    confidence: number;
    proposalKind: InstructionsProposalKind;
    summary: string;
    changes: string[];
    proposedContent: string;
  }
  | {
    action: 'clarify';
    confidence: number;
    question: string;
    candidates: Array<Record<string, unknown>>;
  }
  | {
    action: 'reject' | 'local_only';
    confidence: number;
    reason: string | null;
  };

export function buildInstructionsOperationKey(scopeRef: PlatformScopeRef) {
  return formatPlatformScopeKey(scopeRef.platform, scopeRef.externalScopeId);
}

export function buildInstructionsEditKey(event) {
  return formatPlatformScopeKey(event.platform, event.externalScopeId);
}

export function formatInstructionsStatus(hasInstructions: boolean, i18n: Translator) {
  return hasInstructions ? i18n.t('common.enabled') : i18n.t('common.notSet');
}

export function extractInstructionsInlineContent(text: string) {
  const raw = String(text ?? '');
  const match = raw.match(/^\/(?:instructions|ins)\s+set(?:\s+|$)([\s\S]*)$/iu);
  if (!match) {
    return '';
  }
  return match[1] ?? '';
}

export function extractInstructionsEditBody(text: string) {
  const raw = String(text ?? '');
  const match = raw.match(/^\/(?:instructions|ins)\s+edit(?:\s+|$)([\s\S]*)$/iu);
  if (!match) {
    return '';
  }
  return compactWhitespace(match[1] ?? '');
}

export function buildInstructionsCommandSkillPrompt({
  event,
  subcommand,
  userInput,
  locale,
  now,
  cwd,
  currentInstructions,
  pendingDraft,
}: {
  event: InboundTextEvent;
  subcommand: 'natural' | 'edit';
  userInput: string;
  locale: string | null;
  now: number;
  cwd: string | null;
  currentInstructions: CodexInstructionsSnapshot;
  pendingDraft: PendingInstructionsOperation | null;
}): string {
  const payload = {
    command: 'instructions',
    subcommand,
    rawText: String(event.text ?? ''),
    userInput,
    now: new Date(now).toISOString(),
    locale: normalizeLocale(locale) ?? 'zh-CN',
    scope: {
      platform: event.platform,
      externalScopeId: event.externalScopeId,
    },
    cwd,
    instructionsPath: currentInstructions.path,
    currentInstructions: {
      exists: currentInstructions.exists,
      content: currentInstructions.content,
    },
    pendingDraft: pendingDraft
      ? {
        kind: pendingDraft.kind,
        rawInput: pendingDraft.rawInput,
        baseContent: pendingDraft.baseContent,
        proposedContent: pendingDraft.proposedContent,
        summary: pendingDraft.summary,
        changes: pendingDraft.changes,
      }
      : null,
    capabilities: {
      supportedActions: [...INSTRUCTIONS_COMMAND_SKILL_ACTIONS],
      supportedProposalKinds: ['patch', 'replace', 'clear'],
    },
    skillPath: INSTRUCTIONS_COMMAND_SKILL_PATH,
  };
  return [
    'CodexBridge command skill invocation.',
    '',
    `Please read and follow this command skill file: ${INSTRUCTIONS_COMMAND_SKILL_PATH}`,
    'Use it to interpret the /instructions command request below.',
    'Return exactly one JSON object that matches the skill contract.',
    'Do not use Markdown. Do not explain. Do not write files or execute anything.',
    '',
    'Invocation payload:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

export function parseInstructionsCommandSkillResult(value: unknown): InstructionsCommandSkillResult | null {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return null;
  }
  const action = normalizeInstructionsCommandSkillAction(parsed.action);
  if (!action) {
    return null;
  }
  const confidence = clampAssistantConfidence(Number(parsed.confidence ?? 0.8));
  if (action === 'clarify') {
    return {
      action,
      confidence,
      question: compactWhitespace(parsed.question ?? parsed.message ?? ''),
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates.filter((entry) => entry && typeof entry === 'object') : [],
    };
  }
  if (action === 'reject' || action === 'local_only') {
    return {
      action,
      confidence,
      reason: normalizeNullableText(parsed.reason ?? parsed.message),
    };
  }
  const summary = compactWhitespace(parsed.summary ?? parsed.changeSummary ?? parsed.message ?? '');
  const changes = normalizeStringArray(parsed.changes ?? parsed.changeList ?? parsed.change_list);
  const proposedContent = action === 'propose_clear'
    ? ''
    : normalizeInstructionsDocumentContent(parsed.proposedContent ?? parsed.content ?? parsed.instructions ?? '');
  if (!summary) {
    return null;
  }
  if (action === 'update_pending_draft') {
    const proposalKind = normalizeInstructionsProposalKind(parsed.proposalKind ?? parsed.kind ?? parsed.proposal_type);
    if (!proposalKind) {
      return null;
    }
    if (proposalKind !== 'clear' && !proposedContent) {
      return null;
    }
    return {
      action,
      confidence,
      proposalKind,
      summary,
      changes,
      proposedContent: proposalKind === 'clear' ? '' : proposedContent,
    };
  }
  if (action !== 'propose_clear' && !proposedContent) {
    return null;
  }
  return {
    action,
    confidence,
    summary,
    changes,
    proposedContent,
  };
}

function normalizeInstructionsCommandSkillAction(value: unknown): InstructionsCommandSkillResult['action'] | null {
  const normalized = compactWhitespace(value).toLowerCase();
  return INSTRUCTIONS_COMMAND_SKILL_ACTIONS.has(normalized as InstructionsCommandSkillResult['action'])
    ? normalized as InstructionsCommandSkillResult['action']
    : null;
}

export function normalizeInstructionsDocumentContent(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeInstructionsProposalKind(value: unknown): InstructionsProposalKind | null {
  const normalized = compactWhitespace(value).toLowerCase();
  if (normalized === 'patch') return 'patch';
  if (normalized === 'replace') return 'replace';
  if (normalized === 'clear') return 'clear';
  return null;
}

export function buildInstructionsOperation({
  kind,
  createdAt,
  rawInput,
  summary,
  changes,
  proposedContent,
  baseContent,
  normalizedBy,
}: PendingInstructionsOperation): PendingInstructionsOperation {
  return {
    kind,
    createdAt,
    rawInput,
    summary: compactWhitespace(summary),
    changes: normalizeStringArray(changes),
    proposedContent: kind === 'clear' ? '' : normalizeInstructionsDocumentContent(proposedContent),
    baseContent: String(baseContent ?? '').replace(/\r\n/g, '\n'),
    normalizedBy,
  };
}

export function buildPendingInstructionsOperationFromSkillResult({
  now,
  rawInput,
  result,
  currentContent,
  pendingDraft,
}: {
  now: number;
  rawInput: string;
  result: InstructionsCommandSkillResult;
  currentContent: string;
  pendingDraft: PendingInstructionsOperation | null;
}): PendingInstructionsOperation | null {
  const baseContent = pendingDraft?.baseContent ?? String(currentContent ?? '');
  if (result.action === 'propose_patch') {
    return buildInstructionsOperation({
      kind: 'patch',
      createdAt: now,
      rawInput,
      summary: result.summary,
      changes: result.changes,
      proposedContent: result.proposedContent,
      baseContent,
      normalizedBy: 'codex',
    });
  }
  if (result.action === 'propose_replace') {
    return buildInstructionsOperation({
      kind: 'replace',
      createdAt: now,
      rawInput,
      summary: result.summary,
      changes: result.changes,
      proposedContent: result.proposedContent,
      baseContent: String(currentContent ?? ''),
      normalizedBy: 'codex',
    });
  }
  if (result.action === 'propose_clear') {
    return buildInstructionsOperation({
      kind: 'clear',
      createdAt: now,
      rawInput,
      summary: result.summary,
      changes: result.changes,
      proposedContent: '',
      baseContent: String(currentContent ?? ''),
      normalizedBy: 'codex',
    });
  }
  if (result.action === 'update_pending_draft') {
    if (!pendingDraft) {
      return null;
    }
    return buildInstructionsOperation({
      kind: result.proposalKind,
      createdAt: now,
      rawInput: appendInstructionsDraftEditInput(pendingDraft.rawInput, rawInput),
      summary: result.summary,
      changes: result.changes,
      proposedContent: result.proposalKind === 'clear' ? '' : result.proposedContent,
      baseContent: pendingDraft.baseContent,
      normalizedBy: 'codex',
    });
  }
  return null;
}

function appendInstructionsDraftEditInput(rawInput: string, editInstruction: string): string {
  const parts = [compactWhitespace(rawInput), compactWhitespace(editInstruction)].filter(Boolean);
  return parts.join('\n');
}

export function formatInstructionsProposalKind(kind: InstructionsProposalKind, i18n: Translator): string {
  switch (kind) {
    case 'patch':
      return i18n.t('coordinator.instructions.kind.patch');
    case 'replace':
      return i18n.t('coordinator.instructions.kind.replace');
    case 'clear':
      return i18n.t('coordinator.instructions.kind.clear');
    default:
      return i18n.t('common.unknown');
  }
}

export function defaultInstructionsSummary(kind: InstructionsProposalKind, i18n: Translator): string {
  switch (kind) {
    case 'patch':
      return i18n.t('coordinator.instructions.defaultSummary.patch');
    case 'replace':
      return i18n.t('coordinator.instructions.defaultSummary.replace');
    case 'clear':
      return i18n.t('coordinator.instructions.defaultSummary.clear');
    default:
      return i18n.t('coordinator.instructions.defaultSummary.patch');
  }
}

export function formatInstructionsContentPreview(content: string, i18n: Translator): string[] {
  const normalized = normalizeInstructionsDocumentContent(content);
  if (!normalized) {
    return [i18n.t('coordinator.instructions.draftEmptyContent')];
  }
  const lines = normalized.split('\n');
  const preview = lines.slice(0, 24);
  if (lines.length > preview.length) {
    preview.push('...');
  }
  return preview;
}

export function buildInstructionsOperationPreviewLines(
  operation: PendingInstructionsOperation,
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.instructions.draftTitle'),
    i18n.t('coordinator.instructions.draftKind', {
      value: formatInstructionsProposalKind(operation.kind, i18n),
    }),
    i18n.t('coordinator.instructions.draftSummary', {
      value: operation.summary || defaultInstructionsSummary(operation.kind, i18n),
    }),
  ];
  if (operation.changes.length > 0) {
    lines.push(i18n.t('coordinator.instructions.draftChangesTitle'));
    lines.push(...operation.changes.map((change, index) => `${index + 1}. ${change}`));
  }
  lines.push(i18n.t('coordinator.instructions.draftContentTitle'));
  lines.push(...formatInstructionsContentPreview(operation.proposedContent, i18n));
  return lines;
}

export function buildInstructionsDraftResponseLines(
  operation: PendingInstructionsOperation,
  {
    includeEditHint = true,
    includeSourceNotice = false,
  }: {
    includeEditHint?: boolean;
    includeSourceNotice?: boolean;
  } = {},
  i18n: Translator,
): string[] {
  const lines = buildInstructionsOperationPreviewLines(operation, i18n);
  if (includeSourceNotice) {
    lines.push(i18n.t('coordinator.instructions.captureNotice'));
  }
  lines.push(i18n.t('coordinator.instructions.draftNotice'));
  lines.push(i18n.t('coordinator.instructions.confirmHint'));
  if (includeEditHint) {
    lines.push(i18n.t('coordinator.instructions.editDraftHint'));
  }
  lines.push(i18n.t('coordinator.instructions.cancelHint'));
  return lines;
}

export function renderInstructionsSavedLines(
  {
    action,
    snapshot,
    reconnectSummary,
  }: {
    action: 'saved' | 'cleared';
    snapshot: CodexInstructionsSnapshot;
    reconnectSummary: { refreshedCount: number; errors: string[] };
  },
  i18n: Translator,
): string[] {
  return [
    action === 'saved'
      ? i18n.t('coordinator.instructions.saved')
      : i18n.t('coordinator.instructions.cleared'),
    i18n.t('coordinator.instructions.path', { value: snapshot.path }),
    ...(reconnectSummary.refreshedCount > 0
      ? [i18n.t('coordinator.instructions.reconnected', { count: reconnectSummary.refreshedCount })]
      : [i18n.t('coordinator.instructions.reconnectedNone')]),
    ...(reconnectSummary.errors.length > 0
      ? [i18n.t('coordinator.instructions.reconnectFailed', { error: reconnectSummary.errors[0] })]
      : []),
    i18n.t('coordinator.instructions.applyNextTurn'),
  ];
}

function clampAssistantConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.8;
  }
  return Math.max(0, Math.min(1, value));
}

function compactWhitespace(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = compactWhitespace(value);
  return normalized || null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => compactWhitespace(entry)).filter(Boolean).slice(0, 12)
    : [];
}
