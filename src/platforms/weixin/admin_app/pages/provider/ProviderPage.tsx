import { useState } from 'react';
import type { AdminApi } from '../../api/adminApi';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AdminState, ProviderProfile } from '../../types/admin';
import { ProviderEditor } from './ProviderEditor';
import { ProviderUsage } from './ProviderUsage';

type ProviderPageProps = {
  api: AdminApi;
  onChanged: () => void;
  state: AdminState;
};

function getProfileId(profile: ProviderProfile) {
  return String(profile.providerProfileId || profile.id || '');
}

export function ProviderPage({ api, onChanged, state }: ProviderPageProps) {
  const profiles = state.providerProfiles ?? [];
  const current = state.settings?.modelProvider ?? {};
  const [profileId, setProfileId] = useState(
    current.profileId || getProfileId(profiles[0] ?? {}),
  );
  const columns: readonly DataTableColumn<ProviderProfile>[] = [
    { key: 'displayName', header: 'Provider', render: (profile) => profile.displayName || getProfileId(profile) },
    { key: 'providerProfileId', header: 'Profile ID', render: getProfileId },
    { key: 'providerKind', header: '类型', render: (profile) => profile.providerKind || '-' },
    { key: 'defaultModel', header: '默认模型', render: (profile) => profile.defaultModel || '-' },
    {
      key: 'id',
      header: '状态',
      render: (profile) => (
        <StatusBadge tone={getProfileId(profile) === current.profileId ? 'success' : 'neutral'}>
          {getProfileId(profile) === current.profileId ? '当前使用' : '可选'}
        </StatusBadge>
      ),
    },
  ];
  return (
    <div className="page-stack">
      <Panel title="Provider Profiles" subtitle={`共 ${profiles.length} 个可用配置`}>
        <DataTable columns={columns} emptyText="尚无 Provider Profile" rows={profiles} rowKey={getProfileId} />
      </Panel>
      <Panel title="模型设置" subtitle="模型只能从 Provider 返回的目录中选择">
        <ProviderEditor
          api={api}
          current={current}
          profileId={profileId}
          profiles={profiles}
          onChanged={onChanged}
          onSelectProfile={setProfileId}
        />
      </Panel>
      <Panel title="用量状态" subtitle="支持的 Provider 会显示额度窗口">
        <ProviderUsage api={api} profileId={profileId} />
      </Panel>
    </div>
  );
}
