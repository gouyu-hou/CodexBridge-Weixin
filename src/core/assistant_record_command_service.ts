import { formatPlatformScopeKey } from './contracts.js';
import type { Translator } from '../i18n/index.js';
import type {
  AssistantRecord,
  AssistantRecordType,
  PlatformScopeRef,
} from '../types/core.js';
import type { InboundTextEvent } from '../types/platform.js';

export type AssistantRecordUpdateAction = 'update' | 'complete' | 'cancel' | 'archive';
type AssistantRecordTerminalAction = 'confirm' | 'cancel';
type AssistantRecordExplicitMutationAction = 'complete' | 'archive' | 'cancel';

export type PendingAssistantRecordUpdateDraft = {
  createdAt: number;
  rawInput: string;
  instructions: string[];
  targetRecordId: string;
  matchedRecord: AssistantRecord;
  action: AssistantRecordUpdateAction;
  updatedRecord: AssistantRecord;
  matchedScore: number;
  normalizedBy: 'codex' | 'provider' | 'local';
  changeSummary: string | null;
};

type AssistantRecordLocalQueryIntent = {
  kind: 'list';
  typeFilter: AssistantRecordType | null;
};

export type AssistantRecordCommandDependencies<Response> = {
  isSupported(): boolean;
  getTranslator(): Translator;
  buildSessionMeta(event: InboundTextEvent): unknown;
  messageResponse(lines: string[], session?: unknown): Response;
  renderList(event: InboundTextEvent, typeFilter: AssistantRecordType | null, query?: string): Response;
  resolveRecord(
    event: InboundTextEvent,
    args: unknown[],
    typeFilter: AssistantRecordType | null,
  ): AssistantRecord | null;
  renderRecordDetail(record: AssistantRecord): string[];
  completeRecord(record: AssistantRecord): AssistantRecord;
  archiveRecord(record: AssistantRecord): AssistantRecord;
  cancelRecordMutation(record: AssistantRecord): AssistantRecord;
  renderRecordMutation(action: AssistantRecordExplicitMutationAction, record: AssistantRecord): string[];
  getPendingRecord(event: InboundTextEvent, typeFilter: AssistantRecordType | null): AssistantRecord | null;
  normalizeEdit(
    event: InboundTextEvent,
    draft: PendingAssistantRecordUpdateDraft,
    input: string,
    forcedType: AssistantRecordType | null,
  ): Promise<PendingAssistantRecordUpdateDraft | null>;
  editPendingRecord(
    event: InboundTextEvent,
    record: AssistantRecord,
    input: string,
    forcedType: AssistantRecordType | null,
  ): Promise<AssistantRecord>;
  renderPendingRecord(record: AssistantRecord, commandName: string): string[];
  renderEditNeedsText(event: InboundTextEvent): Response;
  renderEditNoPending(event: InboundTextEvent): Response;
  renderNotFound(event: InboundTextEvent): Response;
  rejectMutation(event: InboundTextEvent): Promise<Response | null>;
  applyUpdateDraft(draft: PendingAssistantRecordUpdateDraft): AssistantRecord | null;
  renderUpdateDraft(draft: PendingAssistantRecordUpdateDraft, commandName: string): string[];
  renderUpdateApplied(draft: PendingAssistantRecordUpdateDraft, record: AssistantRecord, commandName: string): string[];
  renderNoPending(
    event: InboundTextEvent,
    typeFilter: AssistantRecordType | null,
    action: AssistantRecordTerminalAction,
  ): Promise<Response>;
  natural(event: InboundTextEvent, rawInput: string, forcedType: AssistantRecordType | null): Promise<Response>;
};

export class AssistantRecordCommandService<Response> {
  private readonly pendingUpdateDraftsByScope = new Map<string, PendingAssistantRecordUpdateDraft>();

  constructor(private readonly dependencies: AssistantRecordCommandDependencies<Response>) {}

  async handle(
    event: InboundTextEvent,
    args: unknown[] = [],
    forcedType: AssistantRecordType | null = null,
  ): Promise<Response> {
    if (!this.dependencies.isSupported()) {
      return this.dependencies.messageResponse([
        this.dependencies.getTranslator().t('coordinator.assistant.unsupported'),
      ], this.dependencies.buildSessionMeta(event));
    }
    const commandName = assistantCommandNameForType(forcedType);
    const action = String(args[0] ?? '').trim().toLowerCase();
    const typeFilter = forcedType ?? null;
    const localTypeFilter = forcedType ?? 'todo';
    if (['list', 'ls', 'status'].includes(action)) {
      return this.dependencies.renderList(event, localTypeFilter);
    }
    if (action === 'search') {
      const query = args.slice(1).join(' ').trim();
      if (!query) {
        return this.dependencies.messageResponse([
          this.dependencies.getTranslator().t('coordinator.assistant.searchUsage', { command: commandName }),
        ], this.dependencies.buildSessionMeta(event));
      }
      return this.dependencies.renderList(event, localTypeFilter, query);
    }
    if (action === 'show') {
      return this.show(event, args.slice(1), localTypeFilter);
    }
    if (['done', 'complete'].includes(action)) {
      return this.mutateRecord(event, args.slice(1), localTypeFilter, 'complete');
    }
    if (['del', 'delete', 'archive'].includes(action)) {
      return this.mutateRecord(event, args.slice(1), localTypeFilter, 'archive');
    }
    if (action === 'ok' || action === 'confirm') {
      return this.confirm(event, typeFilter);
    }
    if (action === 'cancel') {
      return args[1]
        ? this.mutateRecord(event, args.slice(1), localTypeFilter, 'cancel')
        : this.cancel(event, typeFilter);
    }
    if (action === 'edit') {
      return this.edit(event, args.slice(1), forcedType);
    }
    const rawInput = args.join(' ').trim();
    if (!rawInput) {
      return this.dependencies.renderList(event, localTypeFilter);
    }
    const localQuery = resolveAssistantRecordLocalQueryIntent(rawInput, forcedType);
    if (localQuery) {
      return this.dependencies.renderList(event, localQuery.typeFilter);
    }
    return this.dependencies.natural(event, rawInput, forcedType);
  }

  getPendingUpdateDraft(scopeRef: PlatformScopeRef): PendingAssistantRecordUpdateDraft | null {
    return this.pendingUpdateDraftsByScope.get(buildAssistantUpdateDraftKey(scopeRef)) ?? null;
  }

  getPendingUpdateDraftForType(
    scopeRef: PlatformScopeRef,
    typeFilter: AssistantRecordType | null,
  ): PendingAssistantRecordUpdateDraft | null {
    const draft = this.getPendingUpdateDraft(scopeRef);
    if (!draft || !typeFilter) {
      return draft;
    }
    return draft.updatedRecord.type === typeFilter || draft.matchedRecord.type === typeFilter
      ? draft
      : null;
  }

  setPendingUpdateDraft(scopeRef: PlatformScopeRef, draft: PendingAssistantRecordUpdateDraft): void {
    this.pendingUpdateDraftsByScope.set(buildAssistantUpdateDraftKey(scopeRef), draft);
  }

  clearPendingUpdateDraft(scopeRef: PlatformScopeRef): void {
    this.pendingUpdateDraftsByScope.delete(buildAssistantUpdateDraftKey(scopeRef));
  }

  async confirm(event: InboundTextEvent, typeFilter: AssistantRecordType | null): Promise<Response> {
    return this.handleTerminalAction(event, typeFilter, 'confirm');
  }

  async cancel(event: InboundTextEvent, typeFilter: AssistantRecordType | null): Promise<Response> {
    return this.handleTerminalAction(event, typeFilter, 'cancel');
  }

  private async show(
    event: InboundTextEvent,
    args: unknown[],
    typeFilter: AssistantRecordType | null,
  ): Promise<Response> {
    const record = this.dependencies.resolveRecord(event, args, typeFilter);
    if (!record) {
      return this.notFound(event);
    }
    return this.dependencies.messageResponse(
      this.dependencies.renderRecordDetail(record),
      this.dependencies.buildSessionMeta(event),
    );
  }

  private async mutateRecord(
    event: InboundTextEvent,
    args: unknown[],
    typeFilter: AssistantRecordType | null,
    action: AssistantRecordExplicitMutationAction,
  ): Promise<Response> {
    const record = this.dependencies.resolveRecord(event, args, typeFilter);
    if (!record) {
      return this.notFound(event);
    }
    const updatedRecord = action === 'complete'
      ? this.dependencies.completeRecord(record)
      : action === 'archive'
        ? this.dependencies.archiveRecord(record)
        : this.dependencies.cancelRecordMutation(record);
    return this.dependencies.messageResponse(
      this.dependencies.renderRecordMutation(action, updatedRecord),
      this.dependencies.buildSessionMeta(event),
    );
  }

  private async edit(
    event: InboundTextEvent,
    args: unknown[],
    forcedType: AssistantRecordType | null,
  ): Promise<Response> {
    const input = args.join(' ').trim();
    if (!input) {
      return this.dependencies.renderEditNeedsText(event);
    }
    const scopeRef = toAssistantRecordScopeRef(event);
    const updateDraft = this.getPendingUpdateDraftForType(scopeRef, forcedType);
    if (updateDraft) {
      if (shouldCreateAssistantRecordInsteadOfUpdating(input)) {
        this.clearPendingUpdateDraft(scopeRef);
        return this.handle(event, [input], forcedType);
      }
      const updatedDraft = await this.dependencies.normalizeEdit(event, updateDraft, input, forcedType);
      if (!updatedDraft) {
        return this.notFound(event);
      }
      this.setPendingUpdateDraft(scopeRef, updatedDraft);
      return this.dependencies.messageResponse(
        this.dependencies.renderUpdateDraft(updatedDraft, assistantCommandNameForType(forcedType)),
        this.dependencies.buildSessionMeta(event),
      );
    }
    const record = this.dependencies.getPendingRecord(event, forcedType);
    if (!record) {
      return this.dependencies.renderEditNoPending(event);
    }
    const updatedRecord = await this.dependencies.editPendingRecord(event, record, input, forcedType);
    return this.dependencies.messageResponse(
      this.dependencies.renderPendingRecord(updatedRecord, assistantCommandNameForType(forcedType)),
      this.dependencies.buildSessionMeta(event),
    );
  }

  private notFound(event: InboundTextEvent): Response {
    return this.dependencies.renderNotFound(event);
  }

  private async handleTerminalAction(
    event: InboundTextEvent,
    typeFilter: AssistantRecordType | null,
    action: AssistantRecordTerminalAction,
  ): Promise<Response> {
    const rejected = await this.dependencies.rejectMutation(event);
    if (rejected !== null) {
      return rejected;
    }
    const scopeRef = toAssistantRecordScopeRef(event);
    const draft = this.getPendingUpdateDraftForType(scopeRef, typeFilter);
    if (!draft) {
      return this.dependencies.renderNoPending(event, typeFilter, action);
    }
    if (action === 'cancel') {
      this.clearPendingUpdateDraft(scopeRef);
      return this.dependencies.messageResponse([
        this.dependencies.getTranslator().t('coordinator.assistant.updateDraftCancelled'),
      ], this.dependencies.buildSessionMeta(event));
    }
    const record = this.dependencies.applyUpdateDraft(draft);
    const commandName = assistantCommandNameForType(typeFilter);
    if (!record) {
      return this.notFound(event);
    }
    this.clearPendingUpdateDraft(scopeRef);
    return this.dependencies.messageResponse(
      this.dependencies.renderUpdateApplied(draft, record, commandName),
      this.dependencies.buildSessionMeta(event),
    );
  }
}

function shouldCreateAssistantRecordInsteadOfUpdating(input: string): boolean {
  const value = compactWhitespace(input);
  if (!value) {
    return false;
  }
  return isExplicitAssistantCreateRequest(value)
    || isDisavowingExistingAssistantMatch(value)
    || (hasAssistantRecordTypeCreateIntent(value) && !hasExplicitExistingAssistantRecordReference(value));
}

function isExplicitAssistantCreateRequest(input: string): boolean {
  const value = compactWhitespace(input);
  if (!value) {
    return false;
  }
  return /(?:^|[，,。；;\s])(?:新增|新建|添加|增加|记一条新的|记一个新的|新记一条|再记一条|再加一条|另记一条|另加一条).{0,24}(?:待办|todo|提醒|reminder|日志|log|笔记|note|事项|任务)/u.test(value)
    || /^(?:新增|新建|添加|增加)(?:一个|一条)?(?:待办|todo|提醒|reminder|日志|log|笔记|note)/u.test(value);
}

function isDisavowingExistingAssistantMatch(input: string): boolean {
  return /(?:完全新的|全新的|新的内容|另一件事|另一个事项|跟.+?(?:没关系|无关|不相关)|不是(?:这个|那个|原来|之前|已有).{0,12}(?:todo|待办|记录|提醒|事项))/iu.test(input);
}

function hasAssistantRecordTypeCreateIntent(input: string): boolean {
  return /(?:设为|设置为|标记为|作为|做成|归为|类型(?:是|为)|这是(?:一个)?|这个是|我这是).{0,24}(?:提醒|remind|代办|todo|日志|log|笔记|note)/iu.test(input)
    || /(?:提醒我|给我.{0,16}提醒|发.{0,12}消息.{0,12}提醒|remind\s+me)/iu.test(input);
}

function hasExplicitExistingAssistantRecordReference(input: string): boolean {
  return /(?:记录|条目|事项)\s*#?\d+/iu.test(input)
    || /(?:第|#)\s*\d+\s*(?:条|个|项)?/iu.test(input)
    || /(?:刚才|上面|上一条|当前|这个|这条|该|原来|之前|已有).{0,10}(?:记录|条|事项|todo|待办|提醒|日志|笔记)/iu.test(input);
}

export function assistantCommandNameForType(type: AssistantRecordType | null): string {
  switch (type) {
    case 'log':
      return '/log';
    case 'todo':
      return '/todo';
    case 'reminder':
      return '/remind';
    case 'note':
      return '/note';
    default:
      return '/as';
  }
}

export function resolveAssistantRecordLocalQueryIntent(
  input: string,
  forcedType: AssistantRecordType | null,
): AssistantRecordLocalQueryIntent | null {
  const value = compactWhitespace(input).toLowerCase();
  if (!value || hasAssistantRecordCreateRequestPrefix(value)) {
    return null;
  }
  const inferredType = inferAssistantRecordTypeFromQueryText(value);
  const typeFilter = forcedType ?? inferredType ?? 'todo';
  if (!isAssistantRecordListQuery(value, forcedType, inferredType)) {
    return null;
  }
  return { kind: 'list', typeFilter };
}

function buildAssistantUpdateDraftKey(scopeRef: PlatformScopeRef): string {
  return formatPlatformScopeKey(scopeRef.platform, scopeRef.externalScopeId);
}

function toAssistantRecordScopeRef(event: InboundTextEvent): PlatformScopeRef {
  return {
    platform: event.platform,
    externalScopeId: event.externalScopeId,
  };
}

function compactWhitespace(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim();
}

function isAssistantRecordListQuery(
  value: string,
  forcedType: AssistantRecordType | null,
  inferredType: AssistantRecordType | null,
): boolean {
  if (forcedType && /^(?:给我)?(?:查看|看看|看一下|查一下|查找|找找|找一下|搜一下|搜索|列出|显示)(?:一下)?$/u.test(value)) {
    return true;
  }
  const hasViewVerb = /(?:查看|看看|看一下|查一下|查找|找找|找一下|搜一下|搜索|列出|列一下|显示|给我看|给我看看|打开)/u.test(value);
  const hasListCue = /(?:有哪些|还有哪些|都有哪些|有哪(?:些|几|几个)|有什么|有啥|当前|现在|目前|所有|全部|还(?:有|剩)|剩下|列表|清单)/u.test(value);
  const mentionsSpecificType = inferredType !== null;
  const mentionsGenericRecords = /(?:助理记录|记录|事项|条目|清单|列表)/u.test(value);
  const hasTarget = mentionsSpecificType || mentionsGenericRecords;
  if (/(?:有哪些|还有哪些|都有哪些|有哪(?:些|几|几个)|有什么|有啥|还(?:有|剩)(?:哪些|什么)|剩下哪些)/u.test(value)) {
    return hasTarget || forcedType !== null;
  }
  if (!hasViewVerb) {
    return false;
  }
  if (hasTarget) {
    return true;
  }
  return forcedType !== null && hasListCue;
}

function hasAssistantRecordCreateRequestPrefix(value: string): boolean {
  return /^(?:新增|新建|添加|增加|创建|保存|记下|记一条|记一个|帮我(?:新增|新建|添加|增加|创建|保存|记下|记一条|记一个)|提醒我|安排)/u.test(value);
}

function inferAssistantRecordTypeFromQueryText(value: string): AssistantRecordType | null {
  if (/(?:待办|todo|todos|任务|要做的事|待处理事项)/iu.test(value)) {
    return 'todo';
  }
  if (/(?:提醒|remind|reminder|reminders|通知)/iu.test(value)) {
    return 'reminder';
  }
  if (/(?:日志|log|logs|日记)/iu.test(value)) {
    return 'log';
  }
  if (/(?:笔记|note|notes|备忘)/iu.test(value)) {
    return 'note';
  }
  return null;
}
