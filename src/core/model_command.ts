import type { Translator } from '../i18n/index.js';
import type { ProviderModelInfo } from '../types/provider.js';

export type ModelSourceKind = 'session' | 'profile_default' | 'provider_default' | 'provider_first' | 'unset';
export type ModelEffortSourceKind = 'session' | 'model_default' | 'unset';

export type EffectiveModelState = {
  models: ProviderModelInfo[];
  modelInfo: ProviderModelInfo | null;
  modelId: string | null;
  modelValue: string;
  modelSource: ModelSourceKind;
  description: string;
  effortValue: string;
  effortSource: ModelEffortSourceKind;
  defaultReasoningEffort: string | null;
  supportedEffortsText: string;
};

export function normalizeConfiguredModelToken(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

export function resolveProviderProfileDefaultModel(providerProfile): string | null {
  const configured = providerProfile?.config && typeof providerProfile.config === 'object'
    ? providerProfile.config.defaultModel
    : null;
  return normalizeConfiguredModelToken(configured);
}

export function buildSyntheticModelInfo(modelId: unknown): ProviderModelInfo {
  const resolvedModelId = String(modelId ?? '').trim();
  return {
    id: resolvedModelId,
    model: resolvedModelId,
    displayName: resolvedModelId,
    description: '',
    isDefault: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  };
}

export function resolveModelIdentifier(model: ProviderModelInfo | null): string | null {
  const resolved = String(model?.model ?? model?.id ?? '').trim();
  return resolved ? resolved : null;
}

export function findModelByToken(models: ProviderModelInfo[], request: unknown): ProviderModelInfo | null {
  const normalized = String(request ?? '').trim();
  const lowered = normalized.toLowerCase();
  return models.find((model) => {
    const modelId = String(model.model ?? '');
    const modelDisplayName = String(model.displayName ?? '');
    const modelConfigId = String(model.id ?? '');
    const normalizedModelId = modelId.toLowerCase();
    const normalizedDisplayName = modelDisplayName.toLowerCase();
    const normalizedConfigId = modelConfigId.toLowerCase();
    return modelId === normalized
      || normalizedModelId === lowered
      || modelDisplayName === normalized
      || normalizedDisplayName === lowered
      || modelConfigId === normalized
      || normalizedConfigId === lowered;
  }) ?? null;
}

export function findModelByIndexToken(models: ProviderModelInfo[], request: unknown): ProviderModelInfo | null {
  const normalized = String(request ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    return null;
  }
  const index = Number.parseInt(normalized, 10) - 1;
  return models[index] ?? null;
}

export function resolveSessionModelForEffort(models: ProviderModelInfo[], requestedModel: unknown): ProviderModelInfo | null {
  if (requestedModel) {
    const matched = findModelByToken(models, requestedModel);
    if (matched) {
      return matched;
    }
  }
  return models.find((model) => model.isDefault) ?? models[0] ?? null;
}

export function resolveEffortForModel(model: ProviderModelInfo | null, requestedEffort: unknown): string | null {
  if (!requestedEffort) {
    return null;
  }
  const supportedEfforts = Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
  if (supportedEfforts.length === 0) {
    return null;
  }
  const normalized = String(requestedEffort).trim().toLowerCase();
  const matched = supportedEfforts.find((effort) => String(effort ?? '').trim().toLowerCase() === normalized);
  return matched ? String(matched) : null;
}

export function formatReasoningEffortLabel(effort: unknown): string {
  const raw = String(effort ?? '').trim();
  if (!raw) {
    return raw;
  }
  const normalized = raw.toLowerCase();
  const labels: Record<string, string> = {
    none: '关闭',
    minimal: '极低',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '超高',
    auto: '自动',
  };
  const label = labels[normalized];
  return label ? `${label}（${raw}）` : raw;
}

export function formatSupportedEfforts(model: ProviderModelInfo | null, i18n: Translator): string {
  const supportedEfforts = Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
  return supportedEfforts.length > 0
    ? supportedEfforts.map((effort) => formatReasoningEffortLabel(effort)).join(', ')
    : i18n.t('coordinator.model.unsupportedEffortFallback');
}

export function formatModelSourceLabel(source: ModelSourceKind, i18n: Translator): string {
  switch (source) {
    case 'session':
      return i18n.t('coordinator.model.source.session');
    case 'profile_default':
      return i18n.t('coordinator.model.source.profileDefault');
    case 'provider_default':
      return i18n.t('coordinator.model.source.providerDefault');
    case 'provider_first':
      return i18n.t('coordinator.model.source.providerFirst');
    default:
      return i18n.t('coordinator.model.source.unset');
  }
}

export function formatModelEffortSourceLabel(source: ModelEffortSourceKind, i18n: Translator): string {
  switch (source) {
    case 'session':
      return i18n.t('coordinator.model.source.session');
    case 'model_default':
      return i18n.t('coordinator.model.source.modelDefault');
    default:
      return i18n.t('coordinator.model.source.unset');
  }
}

export function parseConcatenatedModelEffortToken(
  token: unknown,
  models: ProviderModelInfo[],
): { model: string; effort: string } | null {
  const normalizedToken = String(token ?? '').trim().toLowerCase();
  if (!normalizedToken) {
    return null;
  }
  for (const model of models) {
    const supportedEfforts = Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
    if (supportedEfforts.length === 0) {
      continue;
    }
    const modelTokens = [
      String(model.id ?? ''),
      String(model.model ?? ''),
      String(model.displayName ?? ''),
    ].map((value) => value.trim().toLowerCase()).filter(Boolean);
    for (const effort of supportedEfforts) {
      const normalizedEffort = String(effort ?? '').trim().toLowerCase();
      if (!normalizedEffort || !normalizedToken.endsWith(normalizedEffort)) {
        continue;
      }
      const modelPart = normalizedToken.slice(0, -normalizedEffort.length);
      if (!modelPart || !modelTokens.includes(modelPart)) {
        continue;
      }
      return {
        model: String(model.model ?? model.id ?? model.displayName ?? ''),
        effort: String(effort),
      };
    }
  }
  return null;
}

export function resolveModelDescription(
  model: ProviderModelInfo | null,
  modelId: string | null | undefined,
  i18n: Translator,
): string {
  const resolvedModelId = String(modelId ?? model?.model ?? model?.id ?? '').trim();
  if (!resolvedModelId) {
    return String(model?.description ?? '').trim();
  }
  const key = `coordinator.models.description.${resolvedModelId}`;
  const localized = i18n.t(key);
  if (localized === key) {
    return String(model?.description ?? '').trim();
  }
  return localized;
}

export function renderModelLines(models: ProviderModelInfo[], {
  activeModelId = null,
  i18n,
}: {
  activeModelId?: string | null;
  i18n: Translator;
}): string[] {
  return models.map((model, index) => {
    const modelId = String(model.model ?? model.id ?? '').trim();
    const displayName = String(model.displayName ?? '').trim();
    const reasonings = Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length > 0
      ? ` (${model.supportedReasoningEfforts.join(', ')})`
      : '';
    const description = resolveModelDescription(model, modelId, i18n);
    const currentMarker = activeModelId && modelId === activeModelId
      ? ` ${i18n.t('coordinator.models.currentSuffix')}`
      : '';
    const defaultMarker = model.isDefault ? ` ${i18n.t('coordinator.models.defaultSuffix')}` : '';
    if (!displayName || displayName === modelId) {
      return `${index + 1}. ${modelId}${currentMarker}${defaultMarker}${reasonings}${description ? ` - ${description}` : ''}`;
    }
    return `${index + 1}. ${modelId}${currentMarker}${defaultMarker} ${displayName}${reasonings}${description ? ` - ${description}` : ''}`;
  });
}

export function renderModelCatalogLines(
  {
    providerProfileId,
    models,
    effectiveModelState,
  }: {
    providerProfileId: string;
    models: ProviderModelInfo[];
    effectiveModelState: EffectiveModelState;
  },
  i18n: Translator,
): string[] {
  return [
    i18n.t('coordinator.models.listTitle', { providerProfileId }),
    i18n.t('coordinator.model.current', { value: effectiveModelState.modelValue }),
    i18n.t('coordinator.model.currentSource', {
      value: formatModelSourceLabel(effectiveModelState.modelSource, i18n),
    }),
    i18n.t('coordinator.models.helpHeader'),
    ...(models.length === 0
      ? [i18n.t('coordinator.models.empty')]
      : renderModelLines(models, {
        activeModelId: effectiveModelState.modelId,
        i18n,
      })),
    i18n.t('coordinator.model.usageHint'),
  ];
}

export function renderCurrentModelStateLines(
  providerProfileId: string,
  effectiveModelState: EffectiveModelState,
  i18n: Translator,
): string[] {
  const lines = [
    i18n.t('coordinator.model.providerProfile', { value: providerProfileId }),
    i18n.t('coordinator.model.current', { value: effectiveModelState.modelValue }),
    i18n.t('coordinator.model.currentSource', {
      value: formatModelSourceLabel(effectiveModelState.modelSource, i18n),
    }),
  ];
  if (effectiveModelState.description) {
    lines.push(i18n.t('coordinator.model.currentDescription', {
      value: effectiveModelState.description,
    }));
  }
  lines.push(
    i18n.t('coordinator.model.currentEffort', {
      value: formatReasoningEffortLabel(effectiveModelState.effortValue),
    }),
    i18n.t('coordinator.model.currentEffortSource', {
      value: formatModelEffortSourceLabel(effectiveModelState.effortSource, i18n),
    }),
  );
  if (effectiveModelState.defaultReasoningEffort) {
    lines.push(i18n.t('coordinator.model.defaultEffort', {
      value: formatReasoningEffortLabel(effectiveModelState.defaultReasoningEffort),
    }));
  }
  lines.push(
    i18n.t('coordinator.model.supportedEfforts', {
      value: effectiveModelState.supportedEffortsText,
    }),
    i18n.t('coordinator.model.noArgHint', { providerProfileId }),
  );
  return lines;
}

export function resolveEffectiveModelSelection({
  models,
  settings,
  providerProfile,
  i18n,
}: {
  models: ProviderModelInfo[] | null | undefined;
  settings?: { model?: unknown; reasoningEffort?: unknown } | null;
  providerProfile?: { config?: unknown } | null;
  i18n: Translator;
}): EffectiveModelState {
  const resolvedModels = Array.isArray(models) ? models : [];
  const explicitModel = normalizeConfiguredModelToken(settings?.model);
  const profileDefaultModel = resolveProviderProfileDefaultModel(providerProfile);
  const providerDefaultModel = resolvedModels.find((model) => model?.isDefault) ?? resolvedModels[0] ?? null;

  let modelInfo: ProviderModelInfo | null = null;
  let modelSource: ModelSourceKind = 'unset';
  if (explicitModel) {
    modelInfo = findModelByToken(resolvedModels, explicitModel) ?? buildSyntheticModelInfo(explicitModel);
    modelSource = 'session';
  } else if (profileDefaultModel) {
    modelInfo = findModelByToken(resolvedModels, profileDefaultModel) ?? buildSyntheticModelInfo(profileDefaultModel);
    modelSource = 'profile_default';
  } else if (providerDefaultModel?.isDefault) {
    modelInfo = providerDefaultModel;
    modelSource = 'provider_default';
  } else if (providerDefaultModel) {
    modelInfo = providerDefaultModel;
    modelSource = 'provider_first';
  }

  const modelId = resolveModelIdentifier(modelInfo);
  const modelValue = modelId ?? i18n.t('coordinator.model.currentDefault');
  const description = modelInfo ? resolveModelDescription(modelInfo, modelId ?? undefined, i18n) : '';
  const explicitEffort = normalizeConfiguredModelToken(settings?.reasoningEffort);
  const defaultReasoningEffort = normalizeConfiguredModelToken(modelInfo?.defaultReasoningEffort);
  const effortValue = explicitEffort ?? defaultReasoningEffort ?? i18n.t('common.default');
  const effortSource: ModelEffortSourceKind = explicitEffort
    ? 'session'
    : defaultReasoningEffort
      ? 'model_default'
      : 'unset';

  return {
    models: resolvedModels,
    modelInfo,
    modelId,
    modelValue,
    modelSource,
    description,
    effortValue,
    effortSource,
    defaultReasoningEffort,
    supportedEffortsText: formatSupportedEfforts(modelInfo, i18n),
  };
}
