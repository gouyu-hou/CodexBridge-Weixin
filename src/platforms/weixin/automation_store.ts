import crypto from 'node:crypto';
import path from 'node:path';
import { JsonFileStore } from '../../store/file_json/json_file_store.js';
import type { InboundTextEvent } from '../../types/platform.js';

export type WeixinAutomationMatchMode = 'contains' | 'exact' | 'prefix' | 'regex';

export interface WeixinAutomationTemplate {
  id: string;
  name: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface WeixinAutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  keywords: string[];
  matchMode: WeixinAutomationMatchMode;
  externalScopeId: string | null;
  replyTemplateId: string | null;
  replyText: string | null;
  promptTemplateId: string | null;
  promptText: string | null;
  archive: boolean;
  archiveTag: string | null;
  stopAfterMatch: boolean;
  hitCount: number;
  lastHitAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface WeixinAutomationArchiveRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  externalScopeId: string;
  matchedKeyword: string;
  text: string;
  archiveTag: string | null;
  attachmentCount: number;
  archivedAt: number;
}

export interface WeixinAutomationData {
  version: 1;
  templates: WeixinAutomationTemplate[];
  rules: WeixinAutomationRule[];
  archive: WeixinAutomationArchiveRecord[];
}

export interface WeixinAutomationApplyResult {
  matched: boolean;
  handled: boolean;
  event: InboundTextEvent;
  replies: string[];
  archivedCount: number;
  matchedRuleIds: string[];
}

export interface WeixinAutomationCommandResult {
  handled: boolean;
  content: string;
}

interface MatchedRule {
  rule: WeixinAutomationRule;
  keyword: string;
}

const DEFAULT_ARCHIVE_LIMIT = 1000;
const AUTOMATION_COMMANDS = new Set(['tpl', 'template', 'kw', 'keyword', 'archive']);

export class WeixinAutomationStore {
  constructor(filePath: string, options: { archiveLimit?: number | null } = {}) {
    this.store = new JsonFileStore<WeixinAutomationData>(filePath, {
      version: 1,
      templates: [],
      rules: [],
      archive: [],
    });
    this.archiveLimit = Math.max(1, Number(options.archiveLimit ?? DEFAULT_ARCHIVE_LIMIT));
  }

  store: JsonFileStore<WeixinAutomationData>;

  archiveLimit: number;

  snapshot(): WeixinAutomationData {
    const data = this.normalizeData(this.store.read());
    this.store.write(data);
    return cloneJson(data);
  }

  listTemplates(): WeixinAutomationTemplate[] {
    return this.snapshot().templates;
  }

  listRules(): WeixinAutomationRule[] {
    return this.snapshot().rules;
  }

  listArchive(limit = 20): WeixinAutomationArchiveRecord[] {
    return this.snapshot().archive.slice(0, Math.max(0, limit));
  }

  createTemplate(params: { name: string; content: string }): WeixinAutomationTemplate {
    const data = this.snapshot();
    const now = Date.now();
    const name = normalizeName(params.name);
    const content = String(params.content ?? '').trim();
    if (!name) {
      throw new Error('模板名称不能为空');
    }
    if (!content) {
      throw new Error('模板内容不能为空');
    }
    const existing = data.templates.find((template) => normalizeLookup(template.name) === normalizeLookup(name));
    if (existing) {
      throw new Error(`模板已存在：${name}`);
    }
    const template: WeixinAutomationTemplate = {
      id: crypto.randomUUID(),
      name,
      content,
      createdAt: now,
      updatedAt: now,
    };
    data.templates.push(template);
    this.writeData(data);
    return template;
  }

  updateTemplate(idOrName: string, updates: Partial<Pick<WeixinAutomationTemplate, 'name' | 'content'>>): WeixinAutomationTemplate {
    const data = this.snapshot();
    const resolved = this.resolveTemplateFromData(data, idOrName);
    if (!resolved) {
      throw new Error(`模板不存在：${idOrName}`);
    }
    const nextName = updates.name === undefined ? resolved.name : normalizeName(updates.name);
    const nextContent = updates.content === undefined ? resolved.content : String(updates.content ?? '').trim();
    if (!nextName) {
      throw new Error('模板名称不能为空');
    }
    if (!nextContent) {
      throw new Error('模板内容不能为空');
    }
    const conflict = data.templates.find((template) => (
      template.id !== resolved.id
      && normalizeLookup(template.name) === normalizeLookup(nextName)
    ));
    if (conflict) {
      throw new Error(`模板已存在：${nextName}`);
    }
    const updated = {
      ...resolved,
      name: nextName,
      content: nextContent,
      updatedAt: Date.now(),
    };
    data.templates = data.templates.map((template) => template.id === updated.id ? updated : template);
    this.writeData(data);
    return updated;
  }

  deleteTemplate(idOrName: string): void {
    const data = this.snapshot();
    const resolved = this.resolveTemplateFromData(data, idOrName);
    if (!resolved) {
      throw new Error(`模板不存在：${idOrName}`);
    }
    data.templates = data.templates.filter((template) => template.id !== resolved.id);
    data.rules = data.rules.map((rule) => ({
      ...rule,
      replyTemplateId: rule.replyTemplateId === resolved.id ? null : rule.replyTemplateId,
      promptTemplateId: rule.promptTemplateId === resolved.id ? null : rule.promptTemplateId,
    }));
    this.writeData(data);
  }

  createRule(params: Partial<WeixinAutomationRule> & {
    name: string;
    keywords: string[];
  }): WeixinAutomationRule {
    const data = this.snapshot();
    const now = Date.now();
    const name = normalizeName(params.name);
    const keywords = normalizeStringList(params.keywords);
    if (!name) {
      throw new Error('规则名称不能为空');
    }
    if (keywords.length === 0) {
      throw new Error('关键词不能为空');
    }
    const existing = data.rules.find((rule) => normalizeLookup(rule.name) === normalizeLookup(name));
    if (existing) {
      throw new Error(`规则已存在：${name}`);
    }
    const rule = normalizeRule({
      ...params,
      id: crypto.randomUUID(),
      name,
      keywords,
      enabled: params.enabled !== false,
      hitCount: 0,
      lastHitAt: null,
      createdAt: now,
      updatedAt: now,
    });
    data.rules.push(rule);
    this.writeData(data);
    return rule;
  }

  updateRule(idOrName: string, updates: Partial<WeixinAutomationRule>): WeixinAutomationRule {
    const data = this.snapshot();
    const resolved = this.resolveRuleFromData(data, idOrName);
    if (!resolved) {
      throw new Error(`规则不存在：${idOrName}`);
    }
    const next = normalizeRule({
      ...resolved,
      ...updates,
      updatedAt: Date.now(),
    });
    if (!next.name) {
      throw new Error('规则名称不能为空');
    }
    if (next.keywords.length === 0) {
      throw new Error('关键词不能为空');
    }
    const conflict = data.rules.find((rule) => (
      rule.id !== next.id
      && normalizeLookup(rule.name) === normalizeLookup(next.name)
    ));
    if (conflict) {
      throw new Error(`规则已存在：${next.name}`);
    }
    data.rules = data.rules.map((rule) => rule.id === next.id ? next : rule);
    this.writeData(data);
    return next;
  }

  deleteRule(idOrName: string): void {
    const data = this.snapshot();
    const resolved = this.resolveRuleFromData(data, idOrName);
    if (!resolved) {
      throw new Error(`规则不存在：${idOrName}`);
    }
    data.rules = data.rules.filter((rule) => rule.id !== resolved.id);
    this.writeData(data);
  }

  recordHit(ruleId: string): void {
    const data = this.snapshot();
    const now = Date.now();
    data.rules = data.rules.map((rule) => rule.id === ruleId
      ? {
        ...rule,
        hitCount: Math.max(0, Number(rule.hitCount ?? 0)) + 1,
        lastHitAt: now,
        updatedAt: now,
      }
      : rule);
    this.writeData(data);
  }

  archiveEvent(params: {
    rule: WeixinAutomationRule;
    event: InboundTextEvent;
    keyword: string;
  }): WeixinAutomationArchiveRecord {
    const data = this.snapshot();
    const record: WeixinAutomationArchiveRecord = {
      id: crypto.randomUUID(),
      ruleId: params.rule.id,
      ruleName: params.rule.name,
      externalScopeId: String(params.event.externalScopeId ?? ''),
      matchedKeyword: params.keyword,
      text: String(params.event.text ?? '').trim(),
      archiveTag: params.rule.archiveTag,
      attachmentCount: Array.isArray(params.event.attachments) ? params.event.attachments.length : 0,
      archivedAt: Date.now(),
    };
    data.archive.unshift(record);
    data.archive = data.archive.slice(0, this.archiveLimit);
    this.writeData(data);
    return record;
  }

  clearArchive(): void {
    const data = this.snapshot();
    data.archive = [];
    this.writeData(data);
  }

  matchRules(event: InboundTextEvent): MatchedRule[] {
    const text = String(event.text ?? '');
    const scopeId = String(event.externalScopeId ?? '');
    if (!text.trim()) {
      return [];
    }
    return this.listRules()
      .filter((rule) => rule.enabled)
      .filter((rule) => !rule.externalScopeId || rule.externalScopeId === scopeId)
      .map((rule) => {
        const keyword = findMatchedKeyword(rule, text);
        return keyword ? { rule, keyword } : null;
      })
      .filter((entry): entry is MatchedRule => Boolean(entry));
  }

  resolveTemplate(idOrName: string): WeixinAutomationTemplate | null {
    return this.resolveTemplateFromData(this.snapshot(), idOrName);
  }

  resolveRule(idOrName: string): WeixinAutomationRule | null {
    return this.resolveRuleFromData(this.snapshot(), idOrName);
  }

  private writeData(data: WeixinAutomationData): void {
    this.store.write(this.normalizeData(data));
  }

  private resolveTemplateFromData(data: WeixinAutomationData, idOrName: string): WeixinAutomationTemplate | null {
    const token = normalizeLookup(idOrName);
    if (!token) {
      return null;
    }
    const index = Number.parseInt(token, 10);
    if (Number.isInteger(index) && String(index) === token && index > 0) {
      return data.templates[index - 1] ?? null;
    }
    return data.templates.find((template) => (
      template.id === idOrName
      || normalizeLookup(template.name) === token
    )) ?? null;
  }

  private resolveRuleFromData(data: WeixinAutomationData, idOrName: string): WeixinAutomationRule | null {
    const token = normalizeLookup(idOrName);
    if (!token) {
      return null;
    }
    const index = Number.parseInt(token, 10);
    if (Number.isInteger(index) && String(index) === token && index > 0) {
      return data.rules[index - 1] ?? null;
    }
    return data.rules.find((rule) => (
      rule.id === idOrName
      || normalizeLookup(rule.name) === token
    )) ?? null;
  }

  private normalizeData(value: WeixinAutomationData): WeixinAutomationData {
    const record: Record<string, unknown> = isRecord(value) ? value : {};
    const templates = Array.isArray(record.templates)
      ? record.templates.map((template) => normalizeTemplate(template)).filter(Boolean) as WeixinAutomationTemplate[]
      : [];
    const rules = Array.isArray(record.rules)
      ? record.rules.map((rule) => normalizeRule(rule)).filter(Boolean)
      : [];
    const archive = Array.isArray(record.archive)
      ? record.archive.map((entry) => normalizeArchiveRecord(entry)).filter(Boolean) as WeixinAutomationArchiveRecord[]
      : [];
    return {
      version: 1,
      templates,
      rules,
      archive: archive.slice(0, this.archiveLimit),
    };
  }
}

export class WeixinAutomationService {
  constructor(store: WeixinAutomationStore) {
    this.store = store;
  }

  store: WeixinAutomationStore;

  isAutomationCommand(name: string | null | undefined): boolean {
    return AUTOMATION_COMMANDS.has(String(name ?? '').trim().toLowerCase());
  }

  handleCommand(event: InboundTextEvent, command: { name?: string | null; raw?: string | null }): WeixinAutomationCommandResult {
    const name = String(command.name ?? '').trim().toLowerCase();
    const text = String(command.raw ?? event.text ?? '').trim();
    if (name === 'tpl' || name === 'template') {
      return { handled: true, content: this.handleTemplateCommand(text) };
    }
    if (name === 'kw' || name === 'keyword') {
      return { handled: true, content: this.handleKeywordCommand(text, event.externalScopeId) };
    }
    if (name === 'archive') {
      return { handled: true, content: this.handleArchiveCommand(text) };
    }
    return { handled: false, content: '' };
  }

  apply(event: InboundTextEvent): WeixinAutomationApplyResult {
    const matches = this.store.matchRules(event);
    if (matches.length === 0) {
      return {
        matched: false,
        handled: false,
        event,
        replies: [],
        archivedCount: 0,
        matchedRuleIds: [],
      };
    }
    const replies: string[] = [];
    const prompts: string[] = [];
    let archivedCount = 0;
    let handled = false;
    const matchedRuleIds: string[] = [];
    for (const match of matches) {
      const { rule, keyword } = match;
      matchedRuleIds.push(rule.id);
      this.store.recordHit(rule.id);
      const context = buildTemplateContext({ event, rule, keyword });
      const reply = resolveRuleReply(this.store, rule, context);
      if (reply) {
        replies.push(reply);
      }
      const prompt = resolveRulePrompt(this.store, rule, context);
      if (prompt) {
        prompts.push(prompt);
      }
      if (rule.archive) {
        this.store.archiveEvent({ rule, event, keyword });
        archivedCount += 1;
      }
      if (rule.stopAfterMatch) {
        handled = true;
      }
    }
    const promptText = prompts.join('\n\n').trim();
    return {
      matched: true,
      handled: handled && !promptText,
      event: promptText
        ? withAutomationMetadata({
          ...event,
          text: promptText,
        }, {
          keywordRuleIds: matchedRuleIds,
        })
        : withAutomationMetadata(event, {
          keywordRuleIds: matchedRuleIds,
        }),
      replies,
      archivedCount,
      matchedRuleIds,
    };
  }

  private handleTemplateCommand(rawText: string): string {
    const rest = stripCommandName(rawText);
    const action = firstToken(rest).toLowerCase();
    if (!action || action === 'list') {
      return renderTemplateList(this.store.listTemplates());
    }
    if (action === 'add') {
      const spec = rest.slice(firstToken(rest).length).trim();
      const { name, body } = splitNameAndBody(spec);
      const template = this.store.createTemplate({ name, content: body });
      return [
        '模板已添加',
        `${template.name}`,
        '用法：/kw add 关键词 -> ' + template.name,
      ].join('\n');
    }
    if (action === 'set' || action === 'update') {
      const spec = rest.slice(firstToken(rest).length).trim();
      const { name, body } = splitNameAndBody(spec);
      const template = this.store.updateTemplate(name, { content: body });
      return ['模板已更新', template.name].join('\n');
    }
    if (action === 'del' || action === 'delete') {
      const token = rest.slice(firstToken(rest).length).trim();
      this.store.deleteTemplate(token);
      return '模板已删除';
    }
    if (action === 'show') {
      const token = rest.slice(firstToken(rest).length).trim();
      const template = this.store.resolveTemplate(token);
      if (!template) {
        return `模板不存在：${token || '?'}`;
      }
      return [`模板：${template.name}`, template.content].join('\n');
    }
    if (action === 'use') {
      const token = rest.slice(firstToken(rest).length).trim();
      const template = this.store.resolveTemplate(token);
      if (!template) {
        return `模板不存在：${token || '?'}`;
      }
      return renderTemplate(template.content, {
        text: '',
        keyword: '',
        rule: '',
        scope: '',
        date: formatLocalDate(Date.now()),
        time: formatLocalTime(Date.now()),
      });
    }
    return renderTemplateHelp();
  }

  private handleKeywordCommand(rawText: string, externalScopeId: string): string {
    const rest = stripCommandName(rawText);
    const action = firstToken(rest).toLowerCase();
    if (!action || action === 'list') {
      return renderRuleList(this.store.listRules());
    }
    if (action === 'add') {
      const spec = rest.slice(firstToken(rest).length).trim();
      const parsed = splitArrowSpec(spec);
      if (!parsed) {
        return '格式：/kw add 关键词 -> 模板名';
      }
      const template = this.store.resolveTemplate(parsed.right);
      if (!template) {
        return `模板不存在：${parsed.right}`;
      }
      const rule = this.store.createRule({
        name: parsed.left,
        keywords: [parsed.left],
        replyTemplateId: template.id,
        stopAfterMatch: true,
      });
      return ['关键词规则已添加', `${rule.name} -> ${template.name}`].join('\n');
    }
    if (action === 'prompt') {
      const spec = rest.slice(firstToken(rest).length).trim();
      const parsed = splitArrowSpec(spec);
      if (!parsed) {
        return '格式：/kw prompt 关键词 -> 模板名';
      }
      const template = this.store.resolveTemplate(parsed.right);
      if (!template) {
        return `模板不存在：${parsed.right}`;
      }
      const rule = this.store.createRule({
        name: parsed.left,
        keywords: [parsed.left],
        promptTemplateId: template.id,
        stopAfterMatch: false,
      });
      return ['关键词提示词规则已添加', `${rule.name} -> ${template.name}`].join('\n');
    }
    if (action === 'archive') {
      const spec = rest.slice(firstToken(rest).length).trim();
      const { name, body } = splitNameAndBody(spec);
      const rule = this.store.createRule({
        name,
        keywords: [name],
        archive: true,
        archiveTag: body || null,
        stopAfterMatch: false,
      });
      return ['归档规则已添加', `${rule.name}${rule.archiveTag ? ` #${rule.archiveTag}` : ''}`].join('\n');
    }
    if (action === 'scope') {
      const token = rest.slice(firstToken(rest).length).trim();
      const rule = this.store.updateRule(token, { externalScopeId });
      return ['规则已限制到当前聊天', rule.name].join('\n');
    }
    if (action === 'global') {
      const token = rest.slice(firstToken(rest).length).trim();
      const rule = this.store.updateRule(token, { externalScopeId: null });
      return ['规则已改为全局生效', rule.name].join('\n');
    }
    if (action === 'on' || action === 'off') {
      const token = rest.slice(firstToken(rest).length).trim();
      const rule = this.store.updateRule(token, { enabled: action === 'on' });
      return [`规则已${rule.enabled ? '启用' : '停用'}`, rule.name].join('\n');
    }
    if (action === 'del' || action === 'delete') {
      const token = rest.slice(firstToken(rest).length).trim();
      this.store.deleteRule(token);
      return '规则已删除';
    }
    return renderRuleHelp();
  }

  private handleArchiveCommand(rawText: string): string {
    const rest = stripCommandName(rawText);
    const action = firstToken(rest).toLowerCase();
    if (action === 'clear') {
      this.store.clearArchive();
      return '归档已清空';
    }
    const limit = action ? Number.parseInt(action, 10) : 10;
    return renderArchiveList(this.store.listArchive(Number.isInteger(limit) ? limit : 10));
  }
}

export function createWeixinAutomationStore(stateDir: string): WeixinAutomationStore {
  return new WeixinAutomationStore(path.join(stateDir, 'weixin', 'automation.json'));
}

function resolveRuleReply(
  store: WeixinAutomationStore,
  rule: WeixinAutomationRule,
  context: Record<string, string>,
): string {
  const content = rule.replyText
    || (rule.replyTemplateId ? store.resolveTemplate(rule.replyTemplateId)?.content ?? '' : '');
  return renderTemplate(content, context);
}

function resolveRulePrompt(
  store: WeixinAutomationStore,
  rule: WeixinAutomationRule,
  context: Record<string, string>,
): string {
  const content = rule.promptText
    || (rule.promptTemplateId ? store.resolveTemplate(rule.promptTemplateId)?.content ?? '' : '');
  return renderTemplate(content, context);
}

function renderTemplate(content: string, context: Record<string, string>): string {
  return String(content ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gu, (_, key: string) => (
    context[key] ?? ''
  )).trim();
}

function buildTemplateContext({
  event,
  rule,
  keyword,
}: {
  event: InboundTextEvent;
  rule: WeixinAutomationRule;
  keyword: string;
}): Record<string, string> {
  const now = Date.now();
  return {
    text: String(event.text ?? '').trim(),
    keyword,
    rule: rule.name,
    scope: String(event.externalScopeId ?? ''),
    date: formatLocalDate(now),
    time: formatLocalTime(now),
  };
}

function findMatchedKeyword(rule: WeixinAutomationRule, text: string): string | null {
  const value = String(text ?? '');
  const normalizedText = value.toLowerCase();
  for (const keyword of rule.keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (!normalizedKeyword) {
      continue;
    }
    if (rule.matchMode === 'exact' && normalizedText.trim() === normalizedKeyword) {
      return keyword;
    }
    if (rule.matchMode === 'prefix' && normalizedText.trimStart().startsWith(normalizedKeyword)) {
      return keyword;
    }
    if (rule.matchMode === 'regex') {
      try {
        if (new RegExp(keyword, 'iu').test(value)) {
          return keyword;
        }
      } catch {
        continue;
      }
    }
    if (rule.matchMode === 'contains' && normalizedText.includes(normalizedKeyword)) {
      return keyword;
    }
  }
  return null;
}

function normalizeTemplate(value: unknown): WeixinAutomationTemplate | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizeName(value.id) || crypto.randomUUID();
  const name = normalizeName(value.name);
  const content = String(value.content ?? '').trim();
  if (!name || !content) {
    return null;
  }
  const now = Date.now();
  return {
    id,
    name,
    content,
    createdAt: normalizeTimestamp(value.createdAt, now),
    updatedAt: normalizeTimestamp(value.updatedAt, now),
  };
}

function normalizeRule(value: unknown): WeixinAutomationRule {
  const record = isRecord(value) ? value : {};
  const now = Date.now();
  const matchMode = ['exact', 'prefix', 'regex'].includes(String(record.matchMode ?? ''))
    ? String(record.matchMode) as WeixinAutomationMatchMode
    : 'contains';
  return {
    id: normalizeName(record.id) || crypto.randomUUID(),
    name: normalizeName(record.name),
    enabled: record.enabled !== false,
    keywords: normalizeStringList(record.keywords),
    matchMode,
    externalScopeId: normalizeNullableString(record.externalScopeId),
    replyTemplateId: normalizeNullableString(record.replyTemplateId),
    replyText: normalizeNullableString(record.replyText),
    promptTemplateId: normalizeNullableString(record.promptTemplateId),
    promptText: normalizeNullableString(record.promptText),
    archive: Boolean(record.archive),
    archiveTag: normalizeNullableString(record.archiveTag),
    stopAfterMatch: Boolean(record.stopAfterMatch),
    hitCount: Math.max(0, Number(record.hitCount ?? 0)),
    lastHitAt: normalizeNullableNumber(record.lastHitAt),
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now),
  };
}

function normalizeArchiveRecord(value: unknown): WeixinAutomationArchiveRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const text = String(value.text ?? '').trim();
  if (!text) {
    return null;
  }
  return {
    id: normalizeName(value.id) || crypto.randomUUID(),
    ruleId: normalizeName(value.ruleId),
    ruleName: normalizeName(value.ruleName),
    externalScopeId: String(value.externalScopeId ?? ''),
    matchedKeyword: String(value.matchedKeyword ?? ''),
    text,
    archiveTag: normalizeNullableString(value.archiveTag),
    attachmentCount: Math.max(0, Number(value.attachmentCount ?? 0)),
    archivedAt: normalizeTimestamp(value.archivedAt, Date.now()),
  };
}

function stripCommandName(text: string): string {
  return String(text ?? '').trim().replace(/^\/\S+\s*/u, '').trim();
}

function firstToken(text: string): string {
  return String(text ?? '').trim().split(/\s+/u)[0] ?? '';
}

function splitNameAndBody(text: string): { name: string; body: string } {
  const normalized = String(text ?? '').trim();
  const token = firstToken(normalized);
  return {
    name: token,
    body: normalized.slice(token.length).trim(),
  };
}

function splitArrowSpec(text: string): { left: string; right: string } | null {
  const match = String(text ?? '').match(/^(.*?)\s*(?:->|=>)\s*(.*?)$/u);
  if (!match) {
    return null;
  }
  const left = String(match[1] ?? '').trim();
  const right = String(match[2] ?? '').trim();
  return left && right ? { left, right } : null;
}

function renderTemplateList(templates: WeixinAutomationTemplate[]): string {
  if (templates.length === 0) {
    return [
      '模板列表：0',
      renderTemplateHelp(),
    ].join('\n');
  }
  return [
    `模板列表：${templates.length}`,
    ...templates.map((template, index) => `${index + 1}. ${template.name}`),
    '查看：/tpl show 序号或名称',
  ].join('\n');
}

function renderRuleList(rules: WeixinAutomationRule[]): string {
  if (rules.length === 0) {
    return [
      '关键词规则：0',
      renderRuleHelp(),
    ].join('\n');
  }
  return [
    `关键词规则：${rules.length}`,
    ...rules.map((rule, index) => [
      `${index + 1}. ${rule.enabled ? '启用' : '停用'} ${rule.name}`,
      `   关键词：${rule.keywords.join('、')}`,
      `   动作：${describeRuleActions(rule)}`,
      `   命中：${rule.hitCount}`,
    ].join('\n')),
  ].join('\n');
}

function renderArchiveList(records: WeixinAutomationArchiveRecord[]): string {
  if (records.length === 0) {
    return '归档列表：0';
  }
  return [
    `最近归档：${records.length}`,
    ...records.map((record, index) => [
      `${index + 1}. ${record.ruleName}${record.archiveTag ? ` #${record.archiveTag}` : ''}`,
      `   ${formatLocalDateTime(record.archivedAt)}`,
      `   ${truncateText(record.text, 80)}`,
    ].join('\n')),
  ].join('\n');
}

function renderTemplateHelp(): string {
  return [
    '模板命令：',
    '/tpl list',
    '/tpl add 名称 内容',
    '/tpl set 名称 新内容',
    '/tpl show 名称',
    '/tpl del 名称',
    '变量：{{text}} {{keyword}} {{rule}} {{scope}} {{date}} {{time}}',
  ].join('\n');
}

function renderRuleHelp(): string {
  return [
    '关键词命令：',
    '/kw list',
    '/kw add 关键词 -> 模板名',
    '/kw prompt 关键词 -> 模板名',
    '/kw archive 关键词 标签',
    '/kw on 序号',
    '/kw off 序号',
    '/kw del 序号',
    '/kw scope 序号    限制到当前聊天',
    '/kw global 序号   全局生效',
  ].join('\n');
}

function describeRuleActions(rule: WeixinAutomationRule): string {
  const actions: string[] = [];
  if (rule.replyTemplateId || rule.replyText) {
    actions.push('回复模板');
  }
  if (rule.promptTemplateId || rule.promptText) {
    actions.push('提示词触发');
  }
  if (rule.archive) {
    actions.push('归档');
  }
  if (rule.stopAfterMatch) {
    actions.push('停止普通对话');
  }
  return actions.join('，') || '无';
}

function withAutomationMetadata(event: InboundTextEvent, updates: Record<string, unknown>): InboundTextEvent {
  const metadata = isRecord(event.metadata) ? event.metadata : {};
  const codexbridge = isRecord(metadata.codexbridge) ? metadata.codexbridge : {};
  return {
    ...event,
    metadata: {
      ...metadata,
      codexbridge: {
        ...codexbridge,
        ...updates,
      },
    },
  };
}

function normalizeStringList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value];
  return [...new Set(source
    .flatMap((entry) => String(entry ?? '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean))];
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().slice(0, 120);
}

function normalizeLookup(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function formatLocalDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

function formatLocalTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN');
}

function formatLocalDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN');
}

function truncateText(value: unknown, limit: number): string {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
