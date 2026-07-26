import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSyntheticModelInfo,
  findModelByIndexToken,
  findModelByToken,
  formatModelEffortSourceLabel,
  formatModelSourceLabel,
  formatReasoningEffortLabel,
  formatSupportedEfforts,
  normalizeConfiguredModelToken,
  parseConcatenatedModelEffortToken,
  renderModelLines,
  resolveEffectiveModelSelection,
  resolveEffortForModel,
  resolveModelDescription,
  resolveModelIdentifier,
  resolveSessionModelForEffort,
} from '../../src/core/model_command.js';
import type { ProviderModelInfo } from '../../src/types/provider.js';
import { createI18n } from '../../src/i18n/index.js';

const i18n = createI18n('zh-CN');

function buildModel(overrides: Partial<ProviderModelInfo> = {}): ProviderModelInfo {
  return {
    id: 'model-config-id',
    model: 'gpt-5.2-codex',
    displayName: 'GPT-5.2 Codex',
    description: 'primary coding model',
    isDefault: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    ...overrides,
  };
}

test('normalizeConfiguredModelToken trims values and rejects empties', () => {
  assert.equal(normalizeConfiguredModelToken('  gpt-5.2  '), 'gpt-5.2');
  assert.equal(normalizeConfiguredModelToken(''), null);
  assert.equal(normalizeConfiguredModelToken('   '), null);
  assert.equal(normalizeConfiguredModelToken(null), null);
  assert.equal(normalizeConfiguredModelToken(undefined), null);
});

test('buildSyntheticModelInfo produces a bare model entry from the requested id', () => {
  const synthetic = buildSyntheticModelInfo(' custom-model ');
  assert.equal(synthetic.id, 'custom-model');
  assert.equal(synthetic.model, 'custom-model');
  assert.equal(synthetic.displayName, 'custom-model');
  assert.equal(synthetic.isDefault, false);
  assert.deepEqual(synthetic.supportedReasoningEfforts, []);
});

test('resolveModelIdentifier prefers model, falls back to id only for nullish model', () => {
  assert.equal(resolveModelIdentifier(buildModel()), 'gpt-5.2-codex');
  assert.equal(resolveModelIdentifier({ ...buildModel(), model: null } as any), 'model-config-id');
  assert.equal(resolveModelIdentifier(buildModel({ model: '' })), null);
  assert.equal(resolveModelIdentifier(null), null);
});

test('findModelByToken matches id, displayName, and config id case-insensitively', () => {
  const models = [
    buildModel(),
    buildModel({ id: 'second-id', model: 'deepseek-chat', displayName: 'DeepSeek Chat' }),
  ];
  assert.equal(findModelByToken(models, 'gpt-5.2-codex'), models[0]);
  assert.equal(findModelByToken(models, 'GPT-5.2 CODEX'), models[0]);
  assert.equal(findModelByToken(models, 'deepseek chat'.replace(' ', '-')), models[1]);
  assert.equal(findModelByToken(models, 'DeepSeek Chat'), models[1]);
  assert.equal(findModelByToken(models, 'second-id'), models[1]);
  assert.equal(findModelByToken(models, 'missing'), null);
});

test('findModelByIndexToken resolves 1-based indexes only', () => {
  const models = [buildModel(), buildModel({ model: 'deepseek-chat' })];
  assert.equal(findModelByIndexToken(models, '1'), models[0]);
  assert.equal(findModelByIndexToken(models, '2'), models[1]);
  assert.equal(findModelByIndexToken(models, '3'), null);
  assert.equal(findModelByIndexToken(models, '0'), null);
  assert.equal(findModelByIndexToken(models, 'abc'), null);
  assert.equal(findModelByIndexToken(models, ''), null);
});

test('resolveSessionModelForEffort prefers the requested model, then default, then first', () => {
  const defaultModel = buildModel({ model: 'default-model', isDefault: true });
  const other = buildModel({ model: 'other-model' });
  assert.equal(resolveSessionModelForEffort([other, defaultModel], 'other-model'), other);
  assert.equal(resolveSessionModelForEffort([other, defaultModel], null), defaultModel);
  assert.equal(resolveSessionModelForEffort([other], null), other);
  assert.equal(resolveSessionModelForEffort([], null), null);
});

test('resolveEffortForModel matches supported efforts case-insensitively', () => {
  const model = buildModel({ supportedReasoningEfforts: ['low', 'medium', 'high'] });
  assert.equal(resolveEffortForModel(model, 'HIGH'), 'high');
  assert.equal(resolveEffortForModel(model, ' medium '), 'medium');
  assert.equal(resolveEffortForModel(model, 'xhigh'), null);
  assert.equal(resolveEffortForModel(model, ''), null);
  assert.equal(resolveEffortForModel(buildModel(), 'high'), null);
  assert.equal(resolveEffortForModel(null, 'high'), null);
});

test('formatReasoningEffortLabel localizes known efforts and passes through unknown ones', () => {
  assert.equal(formatReasoningEffortLabel('high'), '高（high）');
  assert.equal(formatReasoningEffortLabel('  minimal '), '极低（minimal）');
  assert.equal(formatReasoningEffortLabel('custom'), 'custom');
  assert.equal(formatReasoningEffortLabel(''), '');
  assert.equal(formatReasoningEffortLabel(null), '');
});

test('formatSupportedEfforts joins labels or falls back to the localized hint', () => {
  const model = buildModel({ supportedReasoningEfforts: ['low', 'high'] });
  assert.equal(formatSupportedEfforts(model, i18n), '低（low）, 高（high）');
  const fallback = formatSupportedEfforts(buildModel(), i18n);
  assert.ok(fallback);
  assert.ok(!fallback.includes('coordinator.model.unsupportedEffortFallback'), fallback);
});

test('formatModelSourceLabel resolves every source kind to localized text', () => {
  for (const source of ['session', 'profile_default', 'provider_default', 'provider_first', 'unset'] as const) {
    const label = formatModelSourceLabel(source, i18n);
    assert.ok(label);
    assert.ok(!label.includes('coordinator.model.source'), label);
  }
});

test('formatModelEffortSourceLabel resolves every effort source kind to localized text', () => {
  for (const source of ['session', 'model_default', 'unset'] as const) {
    const label = formatModelEffortSourceLabel(source, i18n);
    assert.ok(label);
    assert.ok(!label.includes('coordinator.model.source'), label);
  }
});

test('parseConcatenatedModelEffortToken splits merged model and effort tokens', () => {
  const models = [buildModel({ supportedReasoningEfforts: ['low', 'high'] })];
  assert.deepEqual(parseConcatenatedModelEffortToken('gpt-5.2-codexhigh', models), {
    model: 'gpt-5.2-codex',
    effort: 'high',
  });
  assert.deepEqual(parseConcatenatedModelEffortToken('MODEL-CONFIG-IDLOW', models), {
    model: 'gpt-5.2-codex',
    effort: 'low',
  });
  assert.equal(parseConcatenatedModelEffortToken('gpt-5.2-codex', models), null);
  assert.equal(parseConcatenatedModelEffortToken('high', models), null);
  assert.equal(parseConcatenatedModelEffortToken('', models), null);
  assert.equal(parseConcatenatedModelEffortToken('gpt-5.2-codexhigh', [buildModel()]), null);
});

test('resolveModelDescription falls back to the model description without a locale entry', () => {
  const model = buildModel({ model: 'no-locale-model', id: 'no-locale-id', description: 'raw description' });
  assert.equal(resolveModelDescription(model, 'no-locale-entry-model', i18n), 'raw description');
  assert.equal(resolveModelDescription(model, null, i18n), 'raw description');
  assert.equal(resolveModelDescription(null, null, i18n), '');
});

test('resolveModelDescription prefers the localized catalog entry when present', () => {
  const localized = resolveModelDescription(buildModel(), 'gpt-5.2-codex', i18n);
  assert.ok(localized);
  assert.notEqual(localized, 'primary coding model');
  assert.ok(!localized.includes('coordinator.models.description'), localized);
});

test('renderModelLines renders numbering, markers, efforts, and descriptions', () => {
  const models = [
    buildModel({
      model: 'model-a',
      displayName: 'Model A',
      description: 'first model',
      isDefault: true,
      supportedReasoningEfforts: ['low', 'high'],
    }),
    buildModel({ model: 'model-b', displayName: '', description: '' }),
  ];
  const lines = renderModelLines(models, { activeModelId: 'model-b', i18n });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith('1. model-a'), lines[0]);
  assert.ok(lines[0].includes('Model A'), lines[0]);
  assert.ok(lines[0].includes('(low, high)'), lines[0]);
  assert.ok(lines[0].includes('first model'), lines[0]);
  assert.ok(lines[1].startsWith('2. model-b'), lines[1]);
  assert.notEqual(lines[0], lines[1]);
  const activeMarkerOnSecond = lines[1] !== '2. model-b';
  assert.ok(activeMarkerOnSecond, lines[1]);
});

test('resolveEffectiveModelSelection prefers session model over profile and provider defaults', () => {
  const providerDefault = buildModel({ model: 'provider-default', isDefault: true });
  const listed = buildModel({ model: 'listed-model' });
  const state = resolveEffectiveModelSelection({
    models: [providerDefault, listed],
    settings: { model: 'listed-model', reasoningEffort: null },
    providerProfile: { config: { defaultModel: 'provider-default' } },
    i18n,
  });
  assert.equal(state.modelSource, 'session');
  assert.equal(state.modelId, 'listed-model');
  assert.equal(state.modelInfo, listed);
});

test('resolveEffectiveModelSelection builds a synthetic entry for unlisted session models', () => {
  const state = resolveEffectiveModelSelection({
    models: [buildModel({ model: 'listed-model', isDefault: true })],
    settings: { model: 'unlisted-model' },
    providerProfile: null,
    i18n,
  });
  assert.equal(state.modelSource, 'session');
  assert.equal(state.modelId, 'unlisted-model');
  assert.equal(state.modelInfo?.isDefault, false);
});

test('resolveEffectiveModelSelection falls back through profile default, provider default, and first model', () => {
  const providerDefault = buildModel({ model: 'provider-default', isDefault: true });
  const first = buildModel({ model: 'first-model' });

  const profileState = resolveEffectiveModelSelection({
    models: [providerDefault],
    settings: null,
    providerProfile: { config: { defaultModel: 'profile-default' } },
    i18n,
  });
  assert.equal(profileState.modelSource, 'profile_default');
  assert.equal(profileState.modelId, 'profile-default');

  const providerState = resolveEffectiveModelSelection({
    models: [first, providerDefault],
    settings: null,
    providerProfile: null,
    i18n,
  });
  assert.equal(providerState.modelSource, 'provider_default');
  assert.equal(providerState.modelId, 'provider-default');

  const firstState = resolveEffectiveModelSelection({
    models: [first],
    settings: null,
    providerProfile: null,
    i18n,
  });
  assert.equal(firstState.modelSource, 'provider_first');
  assert.equal(firstState.modelId, 'first-model');

  const emptyState = resolveEffectiveModelSelection({
    models: [],
    settings: null,
    providerProfile: null,
    i18n,
  });
  assert.equal(emptyState.modelSource, 'unset');
  assert.equal(emptyState.modelId, null);
  assert.ok(emptyState.modelValue);
});

test('resolveEffectiveModelSelection resolves effort value and source precedence', () => {
  const model = buildModel({
    model: 'effort-model',
    isDefault: true,
    supportedReasoningEfforts: ['low', 'high'],
    defaultReasoningEffort: 'low',
  });

  const sessionEffort = resolveEffectiveModelSelection({
    models: [model],
    settings: { reasoningEffort: 'high' },
    providerProfile: null,
    i18n,
  });
  assert.equal(sessionEffort.effortSource, 'session');
  assert.equal(sessionEffort.effortValue, 'high');

  const modelDefaultEffort = resolveEffectiveModelSelection({
    models: [model],
    settings: null,
    providerProfile: null,
    i18n,
  });
  assert.equal(modelDefaultEffort.effortSource, 'model_default');
  assert.equal(modelDefaultEffort.effortValue, 'low');
  assert.equal(modelDefaultEffort.defaultReasoningEffort, 'low');

  const unsetEffort = resolveEffectiveModelSelection({
    models: [buildModel({ model: 'plain-model', isDefault: true })],
    settings: null,
    providerProfile: null,
    i18n,
  });
  assert.equal(unsetEffort.effortSource, 'unset');
  assert.ok(unsetEffort.effortValue);
});
