import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveCodexSwitchProviderState } from '../../../src/providers/codex/ccswitch_sync.js';

function makeTempCodexHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-ccswitch-'));
}

test('resolveCodexSwitchProviderState reads Codex config and auth.json written by CCSwitch', () => {
  const codexHome = makeTempCodexHome();
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model_provider = "custom"',
    'model = "gpt-5.5"',
    '',
    '[model_providers.custom]',
    'name = "Z Token"',
    'base_url = "https://ztoken.example/v1"',
    'requires_openai_auth = true',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
    OPENAI_API_KEY: 'auth-key',
  }), 'utf8');

  const state = resolveCodexSwitchProviderState({ codexHome, env: {} });

  assert.equal(state.providerId, 'custom');
  assert.equal(state.providerName, 'Z Token');
  assert.equal(state.baseUrl, 'https://ztoken.example/v1');
  assert.equal(state.model, 'gpt-5.5');
  assert.equal(state.apiKey, 'auth-key');
  assert.equal(state.apiKeyEnv, 'OPENAI_API_KEY');
  assert.equal(state.source, 'codex-auth');
});

test('resolveCodexSwitchProviderState supports custom env_key secrets', () => {
  const codexHome = makeTempCodexHome();
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model_provider = "custom-key"',
    'model = "provider-model"',
    '',
    '[model_providers.custom-key]',
    'name = "Custom Key Provider"',
    'base_url = "https://provider.example"',
    'env_key = "CUSTOM_PROVIDER_API_KEY"',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
    tokens: {
      CUSTOM_PROVIDER_API_KEY: 'custom-auth-key',
    },
    OPENAI_API_KEY: 'fallback-openai-key',
  }), 'utf8');

  const state = resolveCodexSwitchProviderState({
    codexHome,
    env: {
      CUSTOM_PROVIDER_API_KEY: 'env-key',
    },
  });

  assert.equal(state.providerId, 'custom-key');
  assert.equal(state.apiKey, 'custom-auth-key');
  assert.equal(state.apiKeyEnv, 'CUSTOM_PROVIDER_API_KEY');
});

test('resolveCodexSwitchProviderState normalizes DeepSeek local proxy configs to canonical DeepSeek endpoint and model', () => {
  const codexHome = makeTempCodexHome();
  fs.writeFileSync(path.join(codexHome, 'config.toml'), [
    'model_provider = "deepseek"',
    'model = "gpt-5.5"',
    '',
    '[model_providers.deepseek]',
    'name = "DeepSeek"',
    'base_url = "http://127.0.0.1:15721/v1/responses"',
    'env_key = "DEEPSEEK_API_KEY"',
    '',
  ].join('\n'), 'utf8');
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({
    DEEPSEEK_API_KEY: 'deepseek-key',
  }), 'utf8');

  const state = resolveCodexSwitchProviderState({ codexHome, env: {} });

  assert.equal(state.providerName, 'DeepSeek');
  assert.equal(state.baseUrl, 'https://api.deepseek.com');
  assert.equal(state.model, 'deepseek-v4-flash');
  assert.equal(state.capabilities, 'deepseek');
  assert.equal(state.apiKey, 'deepseek-key');
});
