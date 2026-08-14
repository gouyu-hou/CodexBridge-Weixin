import { useEffect, useState } from 'react';
import { RefreshCw, Save, Shuffle } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { InlineAlert } from '../../components/ui/Feedback';
import { SelectField } from '../../components/ui/Fields';
import { IconButton } from '../../components/ui/IconButton';
import type { ModelProviderSettings, ProviderModel, ProviderProfile } from '../../types/admin';

type ProviderEditorProps = {
  api: AdminApi;
  current: ModelProviderSettings;
  onChanged: () => void;
  onSelectProfile: (id: string) => void;
  profileId: string;
  profiles: ProviderProfile[];
};

function getProfileId(profile: ProviderProfile) {
  return String(profile.providerProfileId || profile.id || '');
}

export function ProviderEditor({ api, current, onChanged, onSelectProfile, profileId, profiles }: ProviderEditorProps) {
  const profile = profiles.find((item) => getProfileId(item) === profileId);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const loadModels = async (refresh: boolean) => {
    if (!profileId) return;
    setLoading(true);
    setError('');
    try {
      const catalog = await api.getProviderModels(profileId, refresh);
      const next = catalog.models ?? [];
      setModels(next);
      const preferred = current.profileId === profileId ? current.model : profile?.defaultModel;
      setModel((selected) => {
        if (next.some((item) => item.id === selected)) return selected;
        if (preferred && next.some((item) => item.id === preferred)) return preferred;
        return next[0]?.id ?? '';
      });
    } catch (value) {
      setModels([]);
      setModel('');
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setModels([]);
    setModel('');
    void loadModels(false);
    // The selected profile owns its own validated model catalog.
  }, [profileId]);

  const save = async () => {
    if (!models.some((item) => item.id === model)) {
      setError('请选择模型目录中的有效模型');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateSettings({
        modelProvider: {
          ...current,
          profileId,
          providerId: profile?.providerKind || current.providerId,
          providerName: profile?.displayName || current.providerName,
          model,
          modelIds: model,
        },
      });
      onChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError('');
    try {
      await api.syncCcswitch({ persistSource: true });
      onChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="provider-editor">
      {error && <InlineAlert tone="error" title="Provider 操作失败">{error}</InlineAlert>}
      <div className="form-grid form-grid--provider-editor">
        <SelectField
          label="Provider Profile"
          value={profileId}
          options={profiles.map((item) => ({ value: getProfileId(item), label: item.displayName || getProfileId(item) }))}
          onChange={(event) => onSelectProfile(event.target.value)}
        />
        <div className="model-field-with-action">
          <SelectField
            label="模型"
            value={model}
            disabled={loading || models.length === 0}
            options={models.map((item) => ({ value: item.id, label: item.label || item.id }))}
            onChange={(event) => setModel(event.target.value)}
          />
          <IconButton label="刷新模型目录" disabled={loading} onClick={() => { void loadModels(true); }}><RefreshCw /></IconButton>
        </div>
      </div>
      <div className="provider-current-facts">
        <span>类型 <strong>{profile?.providerKind || '-'}</strong></span>
        <span>当前模型 <strong>{current.model || '-'}</strong></span>
        <span>密钥 <strong>{current.apiKeyConfigured ? current.apiKeyMasked || '已配置' : '未配置'}</strong></span>
      </div>
      <div className="panel-command-row provider-actions">
        <Button busy={syncing} icon={<Shuffle />} onClick={() => { void sync(); }}>从 CCSwitch 同步</Button>
        <Button variant="primary" busy={saving} disabled={!model || loading} icon={<Save />} onClick={() => { void save(); }}>保存模型设置</Button>
      </div>
    </div>
  );
}
