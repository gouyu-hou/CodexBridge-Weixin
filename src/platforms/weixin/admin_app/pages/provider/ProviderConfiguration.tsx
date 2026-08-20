import { useState } from 'react';
import { Save } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { sanitizeAdminError } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { InlineAlert } from '../../components/ui/Feedback';
import { SelectField, TextField } from '../../components/ui/Fields';
import type { ModelProviderSettings } from '../../types/admin';
import {
  CUSTOM_PROVIDER_PRESET,
  PROVIDER_PRESETS,
  findProviderPreset,
  type ProviderPreset,
} from './providerPresets';

type ProviderConfigurationProps = {
  api: AdminApi;
  current: ModelProviderSettings;
  onChanged: () => void;
  onConfigured: (profileId: string) => void;
};

type ProviderDraft = {
  apiKey: string;
  baseUrl: string;
  capabilities: string;
  model: string;
  profileId: string;
  providerId: string;
  providerName: string;
  source: string;
};

function draftFromCurrent(current: ModelProviderSettings): ProviderDraft {
  return {
    apiKey: '',
    baseUrl: String(current.baseUrl || ''),
    capabilities: String(current.capabilities || 'default'),
    model: String(current.model || ''),
    profileId: String(current.profileId || ''),
    providerId: String(current.providerId || 'openai-compatible'),
    providerName: String(current.providerName || ''),
    source: String(current.source || 'manual'),
  };
}

function draftFromPreset(preset: ProviderPreset): ProviderDraft {
  return {
    apiKey: '',
    baseUrl: preset.baseUrl,
    capabilities: preset.capabilities,
    model: preset.model,
    profileId: preset.profileId,
    providerId: preset.providerId,
    providerName: preset.providerName,
    source: 'manual',
  };
}

function customDraft(): ProviderDraft {
  return {
    apiKey: '',
    baseUrl: '',
    capabilities: 'default',
    model: '',
    profileId: '',
    providerId: 'openai-compatible',
    providerName: '',
    source: 'manual',
  };
}

export function ProviderConfiguration({ api, current, onChanged, onConfigured }: ProviderConfigurationProps) {
  const detectedPreset = findProviderPreset(current);
  const [presetKey, setPresetKey] = useState(detectedPreset?.key ?? CUSTOM_PROVIDER_PRESET);
  const [draft, setDraft] = useState<ProviderDraft>(() => draftFromCurrent(current));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const preset = PROVIDER_PRESETS.find((item) => item.key === presetKey);

  const patchDraft = (patch: Partial<ProviderDraft>) => setDraft((value) => ({ ...value, ...patch }));
  const selectPreset = (key: string) => {
    setPresetKey(key);
    const selected = PROVIDER_PRESETS.find((item) => item.key === key);
    setDraft(selected ? draftFromPreset(selected) : customDraft());
    setError('');
  };

  const save = async () => {
    const profileId = draft.profileId.trim();
    const providerName = draft.providerName.trim();
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/u, '');
    const model = draft.model.trim();
    if (!profileId || !providerName || !model) {
      setError('请填写供应商名称、Profile ID 和模型');
      return;
    }
    if (!/^https?:\/\//iu.test(baseUrl)) {
      setError('Base URL 必须以 http:// 或 https:// 开头');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateSettings({
        modelProvider: {
          ...current,
          source: draft.source,
          profileId,
          providerId: draft.providerId.trim() || 'openai-compatible',
          providerName,
          baseUrl,
          model,
          modelIds: model,
          capabilities: draft.capabilities,
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        },
      });
      onConfigured(profileId);
      onChanged();
      setDraft((value) => ({ ...value, apiKey: '' }));
    } catch (value) {
      setError(sanitizeAdminError(value instanceof Error ? value.message : value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="provider-configuration">
      {error && <InlineAlert tone="error" title="Provider 配置未保存">{error}</InlineAlert>}
      <div className="form-grid provider-configuration__grid">
        <SelectField
          label="供应商预设"
          value={presetKey}
          options={[
            ...PROVIDER_PRESETS.map((item) => ({ value: item.key, label: item.label })),
            { value: CUSTOM_PROVIDER_PRESET, label: '自定义' },
          ]}
          onChange={(event) => selectPreset(event.target.value)}
        />
        <SelectField
          label="配置来源"
          value={draft.source}
          options={[{ value: 'manual', label: '手动配置' }, { value: 'ccswitch', label: '跟随 CCSwitch' }]}
          onChange={(event) => patchDraft({ source: event.target.value })}
        />
        <TextField label="供应商名称" value={draft.providerName} onChange={(event) => patchDraft({ providerName: event.target.value })} />
        <TextField label="Profile ID" value={draft.profileId} onChange={(event) => patchDraft({ profileId: event.target.value })} />
        <SelectField
          label="Provider 类型"
          value={draft.providerId}
          options={[
            { value: 'openai-compatible', label: 'OpenAI Compatible' },
            { value: 'claude', label: 'Claude' },
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'deepseek', label: 'DeepSeek' },
            { value: 'qwen', label: 'Qwen' },
            { value: 'openrouter', label: 'OpenRouter' },
            { value: 'kimi', label: 'Kimi' },
            { value: 'gemini', label: 'Gemini' },
            { value: 'minimax', label: 'MiniMax' },
            { value: 'iflow', label: 'iFlow' },
          ]}
          onChange={(event) => patchDraft({ providerId: event.target.value })}
        />
        {preset ? (
          <SelectField
            label="默认模型"
            value={draft.model}
            options={[...new Set([draft.model, ...preset.models])]
              .filter(Boolean)
              .map((model) => ({ value: model, label: model }))}
            onChange={(event) => patchDraft({ model: event.target.value })}
          />
        ) : (
          <TextField
            label="模型 ID"
            value={draft.model}
            help="首次保存后可在下方刷新供应商返回的模型目录"
            onChange={(event) => patchDraft({ model: event.target.value })}
          />
        )}
        <div className="provider-configuration__wide">
          <TextField label="接口地址 Base URL" value={draft.baseUrl} onChange={(event) => patchDraft({ baseUrl: event.target.value })} />
        </div>
        <div className="provider-configuration__wide">
          <TextField
            label="API Key"
            type="password"
            autoComplete="off"
            value={draft.apiKey}
            placeholder={current.apiKeyConfigured ? `留空则保留 ${current.apiKeyMasked || '当前密钥'}` : '输入供应商 API Key'}
            onChange={(event) => patchDraft({ apiKey: event.target.value })}
          />
        </div>
      </div>
      <div className="provider-configuration__footer">
        <span>保存后会重启微信桥接并刷新模型目录。</span>
        <Button variant="primary" busy={saving} icon={<Save />} onClick={() => { void save(); }}>保存 Provider 配置</Button>
      </div>
    </div>
  );
}
