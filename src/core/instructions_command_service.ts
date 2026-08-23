import {
  buildInstructionsDraftResponseLines,
  buildInstructionsEditKey,
  buildInstructionsOperation,
  buildInstructionsOperationKey,
  buildInstructionsOperationPreviewLines,
  buildPendingInstructionsOperationFromSkillResult,
  extractInstructionsEditBody,
  extractInstructionsInlineContent,
  normalizeInstructionsDocumentContent,
  renderInstructionsSavedLines,
  type InstructionsCommandSkillResult,
  type PendingInstructionsCapture,
  type PendingInstructionsOperation,
} from './instructions_command.js';
import type { Translator } from '../i18n/index.js';
import type { CodexInstructionsSnapshot } from '../providers/codex/instructions_state.js';
import type { PlatformScopeRef } from '../types/core.js';
import type { InboundTextEvent } from '../types/platform.js';

const HELP_FLAG_SET = new Set(['-h', '--help', '-help', '-helps']);
const MAX_CLARIFY_CANDIDATES = 6;

interface CodexInstructionsManagerLike {
  readInstructions(): Promise<CodexInstructionsSnapshot>;
  writeInstructions(content: string): Promise<CodexInstructionsSnapshot>;
  clearInstructions(): Promise<CodexInstructionsSnapshot>;
}

type InstructionsSkillRequest = {
  subcommand: 'natural' | 'edit';
  userInput: string;
  currentInstructions: CodexInstructionsSnapshot;
  pendingDraft: PendingInstructionsOperation | null;
};

type InstructionsServiceDependencies<Response> = {
  now: () => number;
  getTranslator: () => Translator;
  instructionsManager: CodexInstructionsManagerLike;
  toScopeRef: (event: InboundTextEvent) => PlatformScopeRef;
  buildSessionMeta: (event: InboundTextEvent) => unknown;
  messageResponse: (lines: string[], session?: unknown) => Response;
  handleHelp: (event: InboundTextEvent, args: string[]) => Promise<Response> | Response;
  hasActiveTurn: () => boolean;
  reconnectCodexBackedProfiles: () => Promise<{ refreshedCount: number; errors: string[] }>;
  normalizeWithCodex: (
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    request: InstructionsSkillRequest,
  ) => Promise<InstructionsCommandSkillResult | null>;
  formatError: (error: unknown) => string;
};

export class InstructionsCommandService<Response> {
  private readonly pendingCapturesByScope = new Map<string, PendingInstructionsCapture>();
  private readonly pendingOperationsByScope = new Map<string, PendingInstructionsOperation>();

  constructor(private readonly dependencies: InstructionsServiceDependencies<Response>) {}

  hasPendingCapture(event: InboundTextEvent): boolean {
    return this.pendingCapturesByScope.has(buildInstructionsEditKey(event));
  }

  async handlePendingCapture(event: InboundTextEvent): Promise<Response> {
    if (!String(event.text ?? '').trim()) {
      return this.messageResponse([
        this.t('coordinator.instructions.editNeedsText'),
        this.t('coordinator.instructions.editHint'),
      ], this.buildSessionMeta(event));
    }
    return this.proposeLiteralReplace(event, this.dependencies.toScopeRef(event), event.text, 'capture');
  }

  async handle(event: InboundTextEvent, args: unknown[] = []): Promise<Response> {
    const scopeRef = this.dependencies.toScopeRef(event);
    const normalizedArgs = Array.isArray(args)
      ? args.map((value) => String(value ?? '').trim())
      : [];
    const action = String(normalizedArgs[0] ?? '').trim().toLowerCase();
    if (!action) {
      return this.renderStatus(event);
    }
    if (HELP_FLAG_SET.has(action)) {
      return this.dependencies.handleHelp(event, ['instructions']);
    }
    if (action === 'cancel') {
      return this.cancel(event);
    }
    if (['ok', 'confirm'].includes(action)) {
      const operation = this.getPendingOperation(scopeRef);
      if (!operation) {
        return this.messageResponse([
          this.t('coordinator.instructions.noDraft'),
        ], this.buildSessionMeta(event));
      }
      return this.apply(event, scopeRef, operation);
    }
    if (action === 'clear') {
      if (normalizedArgs.length > 1) {
        return this.dependencies.handleHelp(event, ['instructions']);
      }
      return this.proposeClear(event, scopeRef);
    }
    if (action === 'edit') {
      const editInstruction = extractInstructionsEditBody(event.text);
      if (!editInstruction) {
        this.setPendingCapture(event);
        return this.messageResponse([
          this.t('coordinator.instructions.editArmed'),
          this.t('coordinator.instructions.editHint'),
        ], this.buildSessionMeta(event));
      }
      return this.handleNatural(event, scopeRef, {
        subcommand: 'edit',
        userInput: editInstruction,
      });
    }
    if (action === 'set') {
      const inlineContent = extractInstructionsInlineContent(event.text);
      if (!inlineContent) {
        this.setPendingCapture(event);
        return this.messageResponse([
          this.t('coordinator.instructions.editArmed'),
          this.t('coordinator.instructions.editHint'),
        ], this.buildSessionMeta(event));
      }
      return this.proposeLiteralReplace(event, scopeRef, inlineContent, 'set');
    }
    const rawInput = compactWhitespace(normalizedArgs.join(' '));
    if (!rawInput) {
      return this.dependencies.handleHelp(event, ['instructions']);
    }
    return this.handleNatural(event, scopeRef, {
      subcommand: 'natural',
      userInput: rawInput,
    });
  }

  private t(key: string, params: Record<string, unknown> = {}) {
    return this.dependencies.getTranslator().t(key, params);
  }

  private messageResponse(lines: string[], session?: unknown): Response {
    return this.dependencies.messageResponse(lines, session);
  }

  private buildSessionMeta(event: InboundTextEvent): unknown {
    return this.dependencies.buildSessionMeta(event);
  }

  private getPendingOperation(scopeRef: PlatformScopeRef): PendingInstructionsOperation | null {
    return this.pendingOperationsByScope.get(buildInstructionsOperationKey(scopeRef)) ?? null;
  }

  private setPendingCapture(event: InboundTextEvent) {
    this.pendingCapturesByScope.set(buildInstructionsEditKey(event), {
      startedAt: this.dependencies.now(),
    });
  }

  private clearPendingCapture(event: InboundTextEvent) {
    this.pendingCapturesByScope.delete(buildInstructionsEditKey(event));
  }

  private setPendingOperation(scopeRef: PlatformScopeRef, operation: PendingInstructionsOperation) {
    this.pendingOperationsByScope.set(buildInstructionsOperationKey(scopeRef), operation);
  }

  private clearPendingOperation(scopeRef: PlatformScopeRef) {
    this.pendingOperationsByScope.delete(buildInstructionsOperationKey(scopeRef));
  }

  private async renderStatus(event: InboundTextEvent): Promise<Response> {
    const scopeRef = this.dependencies.toScopeRef(event);
    const snapshot = await this.dependencies.instructionsManager.readInstructions();
    const lines = [
      this.t('coordinator.instructions.current', {
        value: snapshot.exists ? this.t('common.enabled') : this.t('common.notSet'),
      }),
      this.t('coordinator.instructions.path', { value: snapshot.path }),
      this.t('coordinator.instructions.contentLabel'),
      snapshot.exists
        ? snapshot.content.trimEnd() || this.t('common.empty')
        : this.t('common.notSet'),
      this.t('coordinator.instructions.usage'),
      this.t('coordinator.instructions.help'),
    ];
    if (this.hasPendingCapture(event)) {
      lines.push(this.t('coordinator.instructions.editPending'));
    }
    const operation = this.getPendingOperation(scopeRef);
    if (operation) {
      lines.push('');
      lines.push(this.t('coordinator.instructions.draftPending'));
      lines.push(...buildInstructionsOperationPreviewLines(operation, this.dependencies.getTranslator()));
    }
    return this.messageResponse(lines, this.buildSessionMeta(event));
  }

  private async proposeLiteralReplace(
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    content: string,
    source: 'set' | 'capture',
  ): Promise<Response> {
    const snapshot = await this.dependencies.instructionsManager.readInstructions();
    const operation = buildInstructionsOperation({
      kind: 'replace',
      createdAt: this.dependencies.now(),
      rawInput: String(content ?? ''),
      summary: this.t('coordinator.instructions.defaultSummary.replace'),
      changes: [this.t('coordinator.instructions.defaultChange.replace')],
      proposedContent: normalizeInstructionsDocumentContent(content),
      baseContent: snapshot.content,
      normalizedBy: 'local',
    });
    this.clearPendingCapture(event);
    this.setPendingOperation(scopeRef, operation);
    return this.messageResponse(
      buildInstructionsDraftResponseLines(operation, {
        includeEditHint: true,
        includeSourceNotice: source === 'capture',
      }, this.dependencies.getTranslator()),
      this.buildSessionMeta(event),
    );
  }

  private async proposeClear(event: InboundTextEvent, scopeRef: PlatformScopeRef): Promise<Response> {
    const snapshot = await this.dependencies.instructionsManager.readInstructions();
    const operation = buildInstructionsOperation({
      kind: 'clear',
      createdAt: this.dependencies.now(),
      rawInput: String(event.text ?? ''),
      summary: this.t('coordinator.instructions.defaultSummary.clear'),
      changes: [this.t('coordinator.instructions.defaultChange.clear')],
      proposedContent: '',
      baseContent: snapshot.content,
      normalizedBy: 'local',
    });
    this.clearPendingCapture(event);
    this.setPendingOperation(scopeRef, operation);
    return this.messageResponse(
      buildInstructionsDraftResponseLines(operation, {
        includeEditHint: true,
      }, this.dependencies.getTranslator()),
      this.buildSessionMeta(event),
    );
  }

  private async apply(
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    operation: PendingInstructionsOperation,
  ): Promise<Response> {
    if (this.dependencies.hasActiveTurn()) {
      return this.messageResponse([
        this.t('coordinator.instructions.blocked'),
      ], this.buildSessionMeta(event));
    }
    try {
      const snapshot = operation.kind === 'clear'
        ? await this.dependencies.instructionsManager.clearInstructions()
        : await this.dependencies.instructionsManager.writeInstructions(operation.proposedContent);
      this.clearPendingCapture(event);
      this.clearPendingOperation(scopeRef);
      const reconnectSummary = await this.dependencies.reconnectCodexBackedProfiles();
      return this.messageResponse(renderInstructionsSavedLines({
        action: operation.kind === 'clear' ? 'cleared' : 'saved',
        snapshot,
        reconnectSummary,
      }, this.dependencies.getTranslator()), this.buildSessionMeta(event));
    } catch (error) {
      return this.messageResponse([
        this.t('coordinator.instructions.failed', { error: this.dependencies.formatError(error) }),
      ], this.buildSessionMeta(event));
    }
  }

  private cancel(event: InboundTextEvent): Response {
    const scopeRef = this.dependencies.toScopeRef(event);
    if (!this.hasPendingCapture(event) && !this.getPendingOperation(scopeRef)) {
      return this.messageResponse([
        this.t('coordinator.instructions.editNotPending'),
      ], this.buildSessionMeta(event));
    }
    this.clearPendingCapture(event);
    this.clearPendingOperation(scopeRef);
    return this.messageResponse([
      this.t('coordinator.instructions.editCancelled'),
    ], this.buildSessionMeta(event));
  }

  private async handleNatural(
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    request: Pick<InstructionsSkillRequest, 'subcommand' | 'userInput'>,
  ): Promise<Response> {
    const currentInstructions = await this.dependencies.instructionsManager.readInstructions();
    const pendingDraft = this.getPendingOperation(scopeRef);
    const commandResult = await this.dependencies.normalizeWithCodex(event, scopeRef, {
      ...request,
      currentInstructions,
      pendingDraft,
    }).catch(() => null);
    if (!commandResult) {
      return this.messageResponse([
        this.t('coordinator.instructions.parseFailed'),
      ], this.buildSessionMeta(event));
    }
    return this.handleSkillResult(
      event,
      scopeRef,
      request.userInput,
      currentInstructions,
      commandResult,
      pendingDraft,
    );
  }

  private handleSkillResult(
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    rawInput: string,
    currentInstructions: CodexInstructionsSnapshot,
    result: InstructionsCommandSkillResult,
    pendingDraft: PendingInstructionsOperation | null = null,
  ): Response {
    if (result.action === 'clarify') {
      return this.renderClarify(event, result.question, result.candidates);
    }
    if (result.action === 'reject' || result.action === 'local_only') {
      return this.messageResponse([
        result.reason || this.t('coordinator.instructions.parseFailed'),
      ], this.buildSessionMeta(event));
    }
    const operation = buildPendingInstructionsOperationFromSkillResult({
      now: this.dependencies.now(),
      rawInput,
      result,
      currentContent: currentInstructions.content,
      pendingDraft,
    });
    if (!operation) {
      return this.messageResponse([
        this.t('coordinator.instructions.parseFailed'),
      ], this.buildSessionMeta(event));
    }
    this.clearPendingCapture(event);
    this.setPendingOperation(scopeRef, operation);
    return this.messageResponse(
      buildInstructionsDraftResponseLines(operation, {}, this.dependencies.getTranslator()),
      this.buildSessionMeta(event),
    );
  }

  private renderClarify(
    event: InboundTextEvent,
    question: string,
    candidates: Array<Record<string, unknown>>,
  ): Response {
    const lines = [question || this.t('coordinator.instructions.parseFailed')];
    if (Array.isArray(candidates) && candidates.length > 0) {
      lines.push(this.t('coordinator.instructions.candidatesTitle'));
      for (const [index, candidate] of candidates.slice(0, MAX_CLARIFY_CANDIDATES).entries()) {
        const label = [
          candidate.index ? `${candidate.index}.` : `${index + 1}.`,
          compactWhitespace(candidate.label ?? candidate.title ?? candidate.kind ?? this.t('common.unknown')),
        ].filter(Boolean).join(' ');
        lines.push(label);
      }
    }
    return this.messageResponse(lines, this.buildSessionMeta(event));
  }
}

function compactWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}
