import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface CodexSwitchProviderState {
  codexHome: string;
  configPath: string;
  authPath: string;
  source: 'codex-config' | 'codex-auth' | 'none';
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  capabilities: string;
  apiKey: string;
  apiKeyEnv: string;
  fingerprint: string;
  errors: string[];
}

export function resolveCodexSwitchProviderState({
  codexHome = null,
  env = process.env,
}: {
  codexHome?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, unknown>;
} = {}): CodexSwitchProviderState {
  const home = resolveCodexHomePath(codexHome, env);
  const configPath = path.join(home, 'config.toml');
  const authPath = path.join(home, 'auth.json');
  const errors: string[] = [];
  const configText = readTextFile(configPath, errors);
  const auth = readJsonFile(authPath, errors);
  const config = parseCodexConfigToml(configText);
  const selectedProviderId = normalizeString(config.root.model_provider) || 'openai';
  const provider = config.modelProviders[selectedProviderId] ?? {};
  const envKey = normalizeString(provider.env_key) || 'OPENAI_API_KEY';
  const providerToken = normalizeString(provider.experimental_bearer_token)
    || normalizeString(provider.api_key)
    || normalizeString(provider.apiKey);
  const authApiKey = readAuthSecret(auth, envKey)
    || (envKey === 'OPENAI_API_KEY' ? '' : readAuthSecret(auth, 'OPENAI_API_KEY'));
  const envApiKey = normalizeString(env[envKey])
    || (envKey === 'OPENAI_API_KEY' ? '' : normalizeString(env.OPENAI_API_KEY));
  const apiKey = providerToken || authApiKey || envApiKey || '';
  const baseUrl = normalizeString(provider.base_url)
    || normalizeString(provider.baseUrl)
    || normalizeString(env.OPENAI_BASE_URL)
    || normalizeString(env.CODEX_COMPAT_BASE_URL)
    || 'https://api.openai.com/v1';
  const model = normalizeString(config.root.model)
    || normalizeString(provider.model)
    || normalizeString(env.CODEX_DEFAULT_MODEL)
    || normalizeString(env.CODEX_COMPAT_DEFAULT_MODEL)
    || '';
  const providerName = normalizeString(provider.name)
    || normalizeString(provider.display_name)
    || selectedProviderId;
  const endpoint = normalizeCcswitchProviderEndpoint({
    providerId: selectedProviderId,
    providerName,
    baseUrl,
    model,
  });
  const resolvedModel = normalizeProviderModel(endpoint.capabilities, model);

  return {
    codexHome: home,
    configPath,
    authPath,
    source: apiKey ? (providerToken ? 'codex-config' : 'codex-auth') : 'none',
    providerId: normalizeProviderId(selectedProviderId) || 'openai-compatible',
    providerName: endpoint.providerName || providerName,
    baseUrl: endpoint.baseUrl,
    model: resolvedModel,
    capabilities: endpoint.capabilities,
    apiKey,
    apiKeyEnv: envKey,
    fingerprint: [
      selectedProviderId,
      endpoint.providerName || providerName,
      endpoint.baseUrl,
      resolvedModel,
      maskFingerprintSecret(apiKey),
      envKey,
    ].join('|'),
    errors,
  };
}

function readAuthSecret(auth: Record<string, unknown> | null, key: string) {
  if (!auth || !key) {
    return '';
  }
  return normalizeString(auth[key])
    || normalizeString((auth.tokens as Record<string, unknown> | null | undefined)?.[key]);
}

export function parseCodexConfigToml(text: string): {
  root: Record<string, string>;
  modelProviders: Record<string, Record<string, string>>;
} {
  const root: Record<string, string> = {};
  const modelProviders: Record<string, Record<string, string>> = {};
  let section = '';
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }
    const sectionMatch = line.match(/^\[([^\]]+)\]$/u);
    if (sectionMatch) {
      section = sectionMatch[1]?.trim() ?? '';
      if (section.startsWith('model_providers.')) {
        const id = unquoteTomlString(section.slice('model_providers.'.length).trim());
        if (id) {
          modelProviders[id] ??= {};
        }
      }
      continue;
    }
    const equalAt = line.indexOf('=');
    if (equalAt <= 0) {
      continue;
    }
    const key = line.slice(0, equalAt).trim();
    const value = parseTomlScalar(line.slice(equalAt + 1).trim());
    if (!key || value === null) {
      continue;
    }
    if (!section) {
      root[key] = value;
      continue;
    }
    if (section.startsWith('model_providers.')) {
      const id = unquoteTomlString(section.slice('model_providers.'.length).trim());
      if (id) {
        modelProviders[id] ??= {};
        modelProviders[id][key] = value;
      }
    }
  }
  return { root, modelProviders };
}

function resolveCodexHomePath(
  codexHome: string | null,
  env: NodeJS.ProcessEnv | Record<string, unknown>,
) {
  const explicit = normalizeString(codexHome) || normalizeString(env.CODEX_HOME);
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.join(os.homedir(), '.codex');
}

function readTextFile(filePath: string, errors: string[]) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      errors.push(`${filePath}: ${formatError(error)}`);
    }
    return '';
  }
}

function readJsonFile(filePath: string, errors: string[]): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      errors.push(`${filePath}: ${formatError(error)}`);
    }
    return null;
  }
}

function stripTomlComment(line: string) {
  let quoted = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      if (quoted && quote === char) {
        quoted = false;
        quote = '';
      } else if (!quoted) {
        quoted = true;
        quote = char;
      }
      continue;
    }
    if (!quoted && char === '#') {
      return line.slice(0, index);
    }
  }
  return line;
}

function parseTomlScalar(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) {
    return '';
  }
  if (normalized.startsWith('"') || normalized.startsWith("'")) {
    return unquoteTomlString(normalized);
  }
  if (normalized === 'true' || normalized === 'false') {
    return normalized;
  }
  return normalized.replace(/,+$/u, '').trim();
}

function unquoteTomlString(raw: string) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const body = value.slice(1, -1);
    if (value.startsWith("'")) {
      return body;
    }
    return body.replace(/\\(["\\/bfnrt])/gu, (_match, token: string) => {
      if (token === 'n') return '\n';
      if (token === 'r') return '\r';
      if (token === 't') return '\t';
      if (token === 'b') return '\b';
      if (token === 'f') return '\f';
      return token;
    });
  }
  return value;
}

function normalizeProviderId(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return '';
  }
  return normalized.replace(/[^A-Za-z0-9_-]+/gu, '-').replace(/^-+|-+$/gu, '') || '';
}

function normalizeProviderModel(capabilities: string, model: string) {
  const normalized = normalizeString(model);
  const lower = normalized.toLowerCase();
  if (capabilities === 'deepseek') {
    return lower.startsWith('deepseek-') ? normalized : 'deepseek-v4-flash';
  }
  if (capabilities === 'claude-code') {
    return lower.startsWith('claude-') ? normalized : 'claude-opus-4-8';
  }
  if (capabilities === 'qwen') {
    return lower.startsWith('qwen') ? normalized : 'qwen3-coder-flash';
  }
  if (capabilities === 'gemini') {
    return lower.startsWith('gemini-') ? normalized : 'gemini-2.5-flash';
  }
  if (capabilities === 'kimi') {
    return lower.startsWith('kimi-') || lower.startsWith('moonshot-') ? normalized : 'kimi-k2-0905-preview';
  }
  if (capabilities === 'minimax') {
    return lower.startsWith('minimax-') || lower.startsWith('abab') ? normalized : 'MiniMax-M2.0';
  }
  if (capabilities === 'iflow') {
    return normalized || 'qwen3-coder-flash';
  }
  if (capabilities === 'openrouter') {
    return normalized || 'openai/gpt-4o-mini';
  }
  return normalized;
}

function normalizeCcswitchProviderEndpoint({
  providerId,
  providerName,
  baseUrl,
  model,
}: {
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
}) {
  const normalizedBaseUrl = stripTrailingSlash(baseUrl);
  const providerHint = `${providerId} ${providerName} ${model}`.replace(/[\s_-]+/gu, '').toLowerCase();
  const isLocalResponsesProxy = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/.*)?\/v1\/responses$/iu.test(normalizedBaseUrl)
    || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/.*)?\/responses$/iu.test(normalizedBaseUrl);
  const useCanonicalProviderUrl = !normalizedBaseUrl || isLocalResponsesProxy;
  if (providerHint.includes('deepseek')) {
    return {
      providerName: 'DeepSeek',
      baseUrl: useCanonicalProviderUrl ? 'https://api.deepseek.com' : normalizedBaseUrl,
      capabilities: 'deepseek',
    };
  }
  if (providerHint.includes('qwen') || providerHint.includes('dashscope')) {
    return {
      providerName: 'Qwen',
      baseUrl: useCanonicalProviderUrl ? 'https://dashscope.aliyuncs.com/compatible-mode/v1' : normalizedBaseUrl,
      capabilities: 'qwen',
    };
  }
  if (providerHint.includes('openrouter')) {
    return {
      providerName: 'OpenRouter',
      baseUrl: useCanonicalProviderUrl ? 'https://openrouter.ai/api/v1' : normalizedBaseUrl,
      capabilities: 'openrouter',
    };
  }
  if (providerHint.includes('kimi') || providerHint.includes('moonshot')) {
    return {
      providerName: 'Kimi',
      baseUrl: useCanonicalProviderUrl ? 'https://api.moonshot.cn/v1' : normalizedBaseUrl,
      capabilities: 'kimi',
    };
  }
  if (providerHint.includes('gemini') || providerHint.includes('google')) {
    return {
      providerName: 'Gemini',
      baseUrl: useCanonicalProviderUrl ? 'https://generativelanguage.googleapis.com/v1beta/openai' : normalizedBaseUrl,
      capabilities: 'gemini',
    };
  }
  if (providerHint.includes('minimax')) {
    return {
      providerName: 'MiniMax',
      baseUrl: useCanonicalProviderUrl ? 'https://api.minimax.chat/v1' : normalizedBaseUrl,
      capabilities: 'minimax',
    };
  }
  if (providerHint.includes('iflow')) {
    return {
      providerName: 'iFlow',
      baseUrl: useCanonicalProviderUrl ? 'https://apis.iflow.cn/v1' : normalizedBaseUrl,
      capabilities: 'iflow',
    };
  }
  if (providerHint.includes('claude')) {
    return {
      providerName: 'Claude Code',
      baseUrl: normalizedBaseUrl,
      capabilities: 'claude-code',
    };
  }
  return {
    providerName,
    baseUrl: normalizedBaseUrl,
    capabilities: 'default',
  };
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function maskFingerprintSecret(value: string) {
  if (!value) {
    return '';
  }
  return `${value.slice(0, 4)}:${value.length}:${value.slice(-4)}`;
}

function normalizeString(value: unknown) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || '';
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
