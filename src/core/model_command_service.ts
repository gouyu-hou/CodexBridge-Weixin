import type { Translator } from '../i18n/index.js';
import type {
  BridgeSession,
  PlatformScopeRef,
  SessionSettings,
} from '../types/core.js';
import type { InboundTextEvent } from '../types/platform.js';
import type {
  ProviderModelInfo,
  ProviderPluginContract,
  ProviderProfile,
} from '../types/provider.js';
import {
  findModelByIndexToken,
  findModelByToken,
  formatReasoningEffortLabel,
  formatSupportedEfforts,
  parseConcatenatedModelEffortToken,
  renderCurrentModelStateLines,
  renderModelCatalogLines,
  resolveEffortForModel,
  resolveSessionModelForEffort,
  type EffectiveModelState,
} from './model_command.js';

type PendingNewSessionState = {
  providerProfileId: string;
  settings: Partial<SessionSettings>;
};

export type ModelCommandServiceDependencies<Response> = {
  getTranslator(): Translator;
  toScopeRef(event: InboundTextEvent): PlatformScopeRef;
  resolveScopeProviderProfile(scopeRef: PlatformScopeRef): ProviderProfile;
  requireProviderProfile(providerProfileId: string): ProviderProfile;
  getProvider(providerKind: string): ProviderPluginContract;
  getPendingNewSession(scopeRef: PlatformScopeRef): PendingNewSessionState | null;
  resolveScopeSession(scopeRef: PlatformScopeRef): BridgeSession | null;
  getSessionSettings(sessionId: string): Partial<SessionSettings> | null;
  updatePendingNewSessionSettings(
    scopeRef: PlatformScopeRef,
    updates: Partial<SessionSettings>,
  ): unknown;
  upsertSessionSettings(sessionId: string, updates: Partial<SessionSettings>): unknown;
  resolveEffectiveModelState(
    providerProfile: ProviderProfile,
    settings: Partial<SessionSettings> | null,
    availableModels?: ProviderModelInfo[] | null,
  ): Promise<EffectiveModelState>;
  rejectIfActiveTurn(event: InboundTextEvent): Promise<Response | null>;
  resolveScopeLocale(scopeRef: PlatformScopeRef, event: InboundTextEvent): string;
  resolveScopedSessionMeta(scopeRef: PlatformScopeRef): unknown;
  buildScopedSessionMeta(event: InboundTextEvent): unknown;
  buildSessionMeta(session: BridgeSession): unknown;
  messageResponse(lines: string[], session?: unknown): Response;
};

export class ModelCommandService<Response> {
  constructor(private readonly dependencies: ModelCommandServiceDependencies<Response>) {}

  async handleModels(event: InboundTextEvent): Promise<Response> {
    const scopeRef = this.dependencies.toScopeRef(event);
    const providerProfile = this.dependencies.resolveScopeProviderProfile(scopeRef);
    const providerPlugin = this.dependencies.getProvider(providerProfile.providerKind);
    if (typeof providerPlugin.listModels !== 'function') {
      return this.messageResponse([
        this.t('coordinator.model.unsupported'),
      ], this.dependencies.resolveScopedSessionMeta(scopeRef));
    }
    const models = await providerPlugin.listModels({ providerProfile });
    const session = this.dependencies.resolveScopeSession(scopeRef);
    const settings = session ? this.dependencies.getSessionSettings(session.id) : null;
    const effectiveModelState = await this.dependencies.resolveEffectiveModelState(
      providerProfile,
      settings,
      models,
    );
    return this.messageResponse(renderModelCatalogLines({
      providerProfileId: providerProfile.id,
      models,
      effectiveModelState,
    }, this.dependencies.getTranslator()), this.dependencies.resolveScopedSessionMeta(scopeRef));
  }

  async handleModel(event: InboundTextEvent, args: unknown[] = []): Promise<Response> {
    const scopeRef = this.dependencies.toScopeRef(event);
    const pendingNewSession = this.dependencies.getPendingNewSession(scopeRef);
    const session = this.dependencies.resolveScopeSession(scopeRef);
    const providerProfile = pendingNewSession
      ? this.dependencies.requireProviderProfile(pendingNewSession.providerProfileId)
      : this.dependencies.resolveScopeProviderProfile(scopeRef);
    const normalizedArgs = args
      .map((arg) => String(arg ?? '').trim())
      .filter((arg) => arg.length > 0);
    if (!normalizedArgs.length) {
      const settings = pendingNewSession?.settings
        ?? (session ? this.dependencies.getSessionSettings(session.id) : null);
      const effectiveModelState = await this.dependencies.resolveEffectiveModelState(providerProfile, settings);
      return this.messageResponse(
        renderCurrentModelStateLines(providerProfile.id, effectiveModelState, this.dependencies.getTranslator()),
        this.dependencies.resolveScopedSessionMeta(scopeRef),
      );
    }
    if (normalizedArgs.length > 2) {
      return this.messageResponse([
        this.t('coordinator.model.noArgHint', { providerProfileId: providerProfile.id }),
      ], this.dependencies.resolveScopedSessionMeta(scopeRef));
    }
    const providerPlugin = this.dependencies.getProvider(providerProfile.providerKind);
    const activeResponse = await this.dependencies.rejectIfActiveTurn(event);
    if (activeResponse) {
      return activeResponse;
    }
    if (!session && !pendingNewSession) {
      return this.messageResponse([
        this.t('coordinator.model.noSession'),
      ], this.dependencies.resolveScopedSessionMeta(scopeRef));
    }
    if (typeof providerPlugin.listModels !== 'function') {
      return this.messageResponse([
        this.t('coordinator.model.unsupported'),
      ], session
        ? this.dependencies.buildSessionMeta(session)
        : this.dependencies.buildScopedSessionMeta(event));
    }
    const models = await providerPlugin.listModels({ providerProfile });
    const requestedModel = normalizedArgs[0] ?? '';
    const requestedEffort = normalizedArgs[1] ?? '';
    const normalizedModel = requestedModel.toLowerCase();
    const normalizedEffort = requestedEffort.trim().toLowerCase();
    const sessionSettings = pendingNewSession?.settings
      ?? (session ? this.dependencies.getSessionSettings(session.id) : null);
    const currentModel = resolveSessionModelForEffort(models, sessionSettings?.model);
    const sessionMeta = session
      ? this.dependencies.buildSessionMeta(session)
      : this.dependencies.buildScopedSessionMeta(event);

    if (['default', 'reset', 'clear', 'none', '默认', '重置'].includes(normalizedModel)) {
      const updates: Partial<SessionSettings> = {
        model: null,
        reasoningEffort: null,
      };
      const messages = [this.t('coordinator.model.reset')];
      if (normalizedEffort) {
        const resolvedEffort = resolveEffortForModel(currentModel, normalizedEffort);
        if (!resolvedEffort) {
          return this.messageResponse([
            this.t('coordinator.model.unsupportedEffort', {
              effort: requestedEffort,
              supported: formatSupportedEfforts(currentModel, this.dependencies.getTranslator()),
            }),
          ], sessionMeta);
        }
        updates.reasoningEffort = resolvedEffort;
        messages.push(this.t('coordinator.model.effortUpdated', {
          value: formatReasoningEffortLabel(resolvedEffort),
        }));
      }
      this.updateSettings(event, scopeRef, pendingNewSession, session, updates);
      return this.messageResponse([
        ...messages,
        this.t('coordinator.permissions.nextTurn'),
      ], sessionMeta);
    }

    const matchedModel = findModelByToken(models, requestedModel)
      ?? findModelByIndexToken(models, requestedModel);
    if (!matchedModel && normalizedArgs.length === 1) {
      const mergedInput = parseConcatenatedModelEffortToken(normalizedModel, models);
      if (mergedInput) {
        return this.messageResponse([
          this.t('coordinator.model.missingEffortSeparator', {
            model: mergedInput.model,
            effort: mergedInput.effort,
          }),
        ], sessionMeta);
      }
      const resolvedEffort = resolveEffortForModel(currentModel, normalizedModel);
      if (!resolvedEffort) {
        return this.messageResponse([
          this.t('coordinator.model.unknown', { name: requestedModel }),
          this.t('coordinator.model.notFoundHint'),
        ], sessionMeta);
      }
      this.updateSettings(event, scopeRef, pendingNewSession, session, {
        reasoningEffort: resolvedEffort,
      });
      return this.messageResponse([
        this.t('coordinator.model.effortUpdated', {
          value: formatReasoningEffortLabel(resolvedEffort),
        }),
        this.t('coordinator.permissions.nextTurn'),
      ], sessionMeta);
    }
    if (!matchedModel && normalizedArgs.length > 1) {
      return this.messageResponse([
        this.t('coordinator.model.unknown', { name: requestedModel }),
        this.t('coordinator.model.notFoundHint'),
      ], sessionMeta);
    }
    const resolvedEffort = requestedEffort
      ? resolveEffortForModel(matchedModel ?? currentModel, normalizedEffort)
      : null;
    if (requestedEffort && !resolvedEffort) {
      const modelForEffort = matchedModel ?? currentModel;
      return this.messageResponse([
        this.t('coordinator.model.unsupportedEffort', {
          effort: requestedEffort,
          supported: formatSupportedEfforts(modelForEffort, this.dependencies.getTranslator()),
        }),
      ], sessionMeta);
    }
    const updates: Partial<SessionSettings> = {};
    const messages: string[] = [];
    if (matchedModel) {
      updates.model = String(matchedModel.model ?? matchedModel.id);
      messages.push(this.t('coordinator.model.updated', {
        name: String(matchedModel.model ?? matchedModel.id),
      }));
    }
    if (requestedEffort) {
      updates.reasoningEffort = resolvedEffort;
      messages.push(this.t('coordinator.model.effortUpdated', {
        value: formatReasoningEffortLabel(resolvedEffort),
      }));
    }
    if (messages.length === 0) {
      messages.push(this.t('coordinator.model.noArgHint', { providerProfileId: providerProfile.id }));
    }
    this.updateSettings(event, scopeRef, pendingNewSession, session, updates);
    return this.messageResponse([
      ...messages,
      this.t('coordinator.permissions.nextTurn'),
    ], sessionMeta);
  }

  private t(key: string, params: Record<string, unknown> = {}): string {
    return this.dependencies.getTranslator().t(key, params);
  }

  private messageResponse(lines: string[], session?: unknown): Response {
    return this.dependencies.messageResponse(lines, session);
  }

  private updateSettings(
    event: InboundTextEvent,
    scopeRef: PlatformScopeRef,
    pendingNewSession: PendingNewSessionState | null,
    session: BridgeSession | null,
    updates: Partial<SessionSettings>,
  ): void {
    if (pendingNewSession) {
      this.dependencies.updatePendingNewSessionSettings(scopeRef, {
        ...updates,
        locale: this.dependencies.resolveScopeLocale(scopeRef, event),
      });
      return;
    }
    if (session) {
      this.dependencies.upsertSessionSettings(session.id, updates);
    }
  }
}
