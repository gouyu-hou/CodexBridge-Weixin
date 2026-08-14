import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { SelectField, Switch, TextField } from '../../components/ui/Fields';
import { IconButton } from '../../components/ui/IconButton';
import type { AdminAccount, ProviderModel, ProviderProfile } from '../../types/admin';

type AccountEditorProps = {
  account: AdminAccount;
  api: AdminApi;
  onClose: () => void;
  onSaved: () => void;
  profiles: ProviderProfile[];
};

function profileId(profile: ProviderProfile) {
  return String(profile.providerProfileId || profile.id || '');
}

export function AccountEditor({ account, api, onClose, onSaved, profiles }: AccountEditorProps) {
  const initialProvider = account.modelProvider?.providerProfileId || profileId(profiles[0] ?? {});
  const [displayName, setDisplayName] = useState(account.displayName || '');
  const [group, setGroup] = useState(account.group || '');
  const [role, setRole] = useState(account.role || (account.primary ? 'owner' : 'member'));
  const [canChat, setCanChat] = useState(account.permissions?.canChat !== false);
  const [canUpload, setCanUpload] = useState(account.permissions?.canUpload !== false);
  const [canExecute, setCanExecute] = useState(Boolean(account.primary || account.permissions?.canExecuteCommands));
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState(account.modelProvider?.model || '');
  const [effort, setEffort] = useState(account.modelProvider?.reasoningEffort || '');
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadModels = async (refresh: boolean) => {
    if (!provider) return;
    setLoadingModels(true);
    setError('');
    try {
      const catalog = await api.getProviderModels(provider, refresh);
      const nextModels = catalog.models ?? [];
      setModels(nextModels);
      setModel((current) => nextModels.some((item) => item.id === current) ? current : (nextModels[0]?.id ?? ''));
    } catch (value) {
      setModels([]);
      setModel('');
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    void loadModels(false);
    // A provider change intentionally reloads its validated catalog.
  }, [provider]);

  const selectedModel = models.find((item) => item.id === model);
  const efforts = useMemo(
    () => ['', ...(selectedModel?.reasoningEfforts ?? ['low', 'medium', 'high', 'xhigh'])],
    [selectedModel],
  );

  const save = async () => {
    if (!model || !models.some((item) => item.id === model)) {
      setError('请选择模型目录中的有效模型');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.updateAccount(account.accountId, {
        displayName,
        group,
        role: account.primary ? 'owner' : role,
        permissions: {
          canChat,
          canUpload,
          canExecuteCommands: account.primary || canExecute,
        },
        modelProvider: {
          providerProfileId: provider,
          model,
          reasoningEffort: effort,
        },
      });
      onSaved();
      onClose();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      title="编辑账号"
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" busy={saving} disabled={loadingModels || !model} onClick={() => { void save(); }}>保存账号</Button>
        </>
      )}
    >
      <div className="account-editor">
        {error && <InlineAlert tone="error" title="无法保存">{error}</InlineAlert>}
        <div className="form-grid form-grid--two">
          <TextField label="显示名称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <TextField label="分组" value={group} placeholder="例如：朋友" onChange={(event) => setGroup(event.target.value)} />
        </div>
        <SelectField
          label="角色"
          value={role}
          disabled={Boolean(account.primary)}
          options={[
            { value: 'owner', label: '主账号' },
            { value: 'admin', label: '管理员' },
            { value: 'member', label: '普通用户' },
            { value: 'viewer', label: '只读用户' },
          ]}
          onChange={(event) => setRole(event.target.value)}
        />
        <div className="permission-grid">
          <Switch label="允许聊天" checked={canChat} onChange={setCanChat} />
          <Switch label="允许上传文件" checked={canUpload} onChange={setCanUpload} />
          <Switch label="允许执行命令" checked={canExecute} disabled={Boolean(account.primary)} onChange={setCanExecute} />
        </div>
        <div className="form-grid form-grid--provider">
          <SelectField
            label="Provider"
            value={provider}
            options={profiles.map((item) => ({ value: profileId(item), label: item.label || profileId(item) }))}
            onChange={(event) => {
              setProvider(event.target.value);
              setModels([]);
              setModel('');
            }}
          />
          <div className="model-field-with-action">
            <SelectField
              label="模型"
              value={model}
              disabled={loadingModels || models.length === 0}
              options={models.map((item) => ({ value: item.id, label: item.label || item.id }))}
              onChange={(event) => setModel(event.target.value)}
            />
            <IconButton label="刷新模型" disabled={loadingModels} onClick={() => { void loadModels(true); }}><RefreshCw /></IconButton>
          </div>
        </div>
        <SelectField
          label="推理强度"
          value={effort}
          options={efforts.map((value) => ({ value, label: value || '使用模型默认值' }))}
          onChange={(event) => setEffort(event.target.value)}
        />
      </div>
    </Dialog>
  );
}
