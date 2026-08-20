import type { ModelProviderSettings } from '../../types/admin';

export type ProviderPreset = {
  baseUrl: string;
  capabilities: string;
  key: string;
  label: string;
  model: string;
  models: readonly string[];
  profileId: string;
  providerId: string;
  providerName: string;
};

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: 'ztoken-codex',
    label: 'Z Token - Codex',
    profileId: 'openai-default',
    providerId: 'openai-compatible',
    providerName: 'Z Token - Codex',
    baseUrl: 'https://ztoken.app/',
    model: 'gpt-5.5',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2'],
    capabilities: 'default',
  },
  {
    key: 'ztoken-claude',
    label: 'Z Token - Claude',
    profileId: 'claude-code',
    providerId: 'claude-code',
    providerName: 'Z Token - Claude',
    baseUrl: 'https://ztoken.app/',
    model: 'claude-opus-4-8',
    models: ['claude-fable-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-sonnet-4-5-20250929', 'claude-sonnet-4-6'],
    capabilities: 'claude-code',
  },
  {
    key: 'official-codex',
    label: 'OpenAI',
    profileId: 'openai-official',
    providerId: 'openai-compatible',
    providerName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5.5',
    models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5', 'gpt-5-codex', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o3', 'o3-mini', 'o4-mini'],
    capabilities: 'default',
  },
  {
    key: 'official-claude-code',
    label: 'Claude',
    profileId: 'claude-official',
    providerId: 'claude',
    providerName: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-6',
    models: ['claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-haiku-4-5-20251001', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022'],
    capabilities: 'claude',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    profileId: 'deepseek',
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v3', 'deepseek-r1'],
    capabilities: 'deepseek',
  },
  {
    key: 'qwen',
    label: 'Qwen',
    profileId: 'qwen',
    providerId: 'qwen',
    providerName: 'Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-coder-flash',
    models: ['qwen3-coder-flash', 'qwen3-coder-plus', 'qwen3-max', 'qwen3-plus', 'qwen3-turbo', 'qwen-plus', 'qwen-turbo', 'qwen-long'],
    capabilities: 'qwen',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    profileId: 'openrouter',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-5.1',
    models: ['openai/gpt-5.1', 'openai/gpt-5', 'openai/gpt-4.1', 'anthropic/claude-opus-4', 'anthropic/claude-sonnet-4', 'deepseek/deepseek-chat-v3-0324', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro', 'qwen/qwen3-coder'],
    capabilities: 'openrouter',
  },
  {
    key: 'kimi',
    label: 'Kimi',
    profileId: 'kimi',
    providerId: 'kimi',
    providerName: 'Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'kimi-k2-0905-preview',
    models: ['kimi-k2-0905-preview', 'kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    capabilities: 'kimi',
  },
  {
    key: 'gemini',
    label: 'Gemini',
    profileId: 'gemini',
    providerId: 'gemini',
    providerName: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    capabilities: 'gemini',
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    profileId: 'minimax',
    providerId: 'minimax',
    providerName: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    model: 'MiniMax-M2.0',
    models: ['MiniMax-M2.0', 'MiniMax-M1', 'MiniMax-Text-01', 'abab6.5s-chat', 'abab6.5g-chat'],
    capabilities: 'minimax',
  },
  {
    key: 'iflow',
    label: 'iFlow',
    profileId: 'iflow',
    providerId: 'iflow',
    providerName: 'iFlow',
    baseUrl: 'https://apis.iflow.cn/v1',
    model: 'iflow-default',
    models: ['iflow-default', 'Qwen3-Coder', 'DeepSeek-V3', 'DeepSeek-R1', 'GLM-4.5'],
    capabilities: 'iflow',
  },
];

export const CUSTOM_PROVIDER_PRESET = 'custom';

export function findProviderPreset(settings: ModelProviderSettings): ProviderPreset | undefined {
  const capabilities = String(settings.capabilities || '').toLowerCase();
  const providerName = String(settings.providerName || '').toLowerCase();
  const baseUrl = String(settings.baseUrl || '').toLowerCase();
  const model = String(settings.model || '').toLowerCase();
  if (baseUrl.includes('ztoken.app')) {
    return PROVIDER_PRESETS.find((preset) => preset.key === (model.startsWith('claude-') ? 'ztoken-claude' : 'ztoken-codex'));
  }
  if (baseUrl.includes('api.openai.com')) {
    return PROVIDER_PRESETS.find((preset) => preset.key === 'official-codex');
  }
  return PROVIDER_PRESETS.find((preset) => (
    preset.key === capabilities
    || (preset.providerId !== 'openai-compatible' && preset.providerId === settings.providerId)
    || providerName.includes(preset.providerName.toLowerCase())
  ));
}
