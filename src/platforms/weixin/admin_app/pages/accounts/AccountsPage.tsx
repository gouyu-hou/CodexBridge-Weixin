import { useState } from 'react';
import { Crown, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { IconButton } from '../../components/ui/IconButton';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AdminAccount, ProviderProfile } from '../../types/admin';
import { AccountEditor } from './AccountEditor';
import { PairingDialog } from './PairingDialog';

type AccountsPageProps = {
  accounts: AdminAccount[];
  api: AdminApi;
  onChanged: () => void;
  profiles: ProviderProfile[];
};

export function AccountsPage({ accounts, api, onChanged, profiles }: AccountsPageProps) {
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [pairing, setPairing] = useState(false);
  const [busyId, setBusyId] = useState('');

  const runAccountCommand = async (accountId: string, command: () => Promise<unknown>) => {
    setBusyId(accountId);
    try {
      await command();
      onChanged();
    } finally {
      setBusyId('');
    }
  };

  const columns: readonly DataTableColumn<AdminAccount>[] = [
    {
      key: 'displayName',
      header: '账号',
      render: (account) => (
        <div className="account-name-cell">
          <strong>{account.displayName || '未命名账号'}</strong>
          <span>{account.accountId}</span>
        </div>
      ),
    },
    {
      key: 'userId',
      header: '用户',
      render: (account) => {
        const userId = account.userId || '-';
        return <span className="account-table-value account-table-value--mono" title={userId}>{userId}</span>;
      },
    },
    {
      key: 'role',
      header: '角色',
      render: (account) => {
        const role = account.primary ? '主账号' : account.role || '普通用户';
        return <span className="account-table-value" title={role}>{role}</span>;
      },
    },
    {
      key: 'disabled',
      header: '状态',
      render: (account) => <StatusBadge tone={account.disabled ? 'warning' : 'success'}>{account.disabled ? '已停用' : '监听中'}</StatusBadge>,
    },
    {
      key: 'accountId',
      header: '操作',
      align: 'right',
      render: (account) => (
        <div className="table-actions">
          <IconButton label={`编辑${account.displayName || account.accountId}`} onClick={() => setEditing(account)}><Pencil /></IconButton>
          {!account.primary && (
            <>
              <IconButton
                label={`设为主账号${account.displayName || account.accountId}`}
                disabled={busyId === account.accountId}
                onClick={() => { void runAccountCommand(account.accountId, () => api.setPrimaryAccount(account.accountId)); }}
              ><Crown /></IconButton>
              <IconButton
                label={`${account.disabled ? '启用' : '停用'}${account.displayName || account.accountId}`}
                disabled={busyId === account.accountId}
                onClick={() => { void runAccountCommand(account.accountId, () => api.updateAccount(account.accountId, { disabled: !account.disabled })); }}
              ><Power /></IconButton>
              <IconButton tone="danger" label={`删除${account.displayName || account.accountId}`} onClick={() => setDeleting(account)}><Trash2 /></IconButton>
            </>
          )}
        </div>
      ),
    },
  ];

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await runAccountCommand(target.accountId, () => api.deleteAccount(target.accountId));
  };

  return (
    <div className="page-stack">
      <Panel
        title="微信账号"
        subtitle={`已接入 ${accounts.length} 个账号`}
        actions={<Button variant="primary" icon={<Plus />} onClick={() => setPairing(true)}>添加微信账号</Button>}
      >
        <DataTable className="accounts-table" columns={columns} emptyText="尚未添加微信账号" rows={accounts} rowKey={(account) => account.accountId} />
      </Panel>
      {editing && (
        <AccountEditor account={editing} api={api} profiles={profiles} onClose={() => setEditing(null)} onSaved={onChanged} />
      )}
      {pairing && <PairingDialog api={api} onClose={() => setPairing(false)} onPaired={onChanged} />}
      <Dialog
        open={Boolean(deleting)}
        title="删除微信账号"
        onClose={() => setDeleting(null)}
        footer={(
          <>
            <Button onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="danger" onClick={() => { void confirmDelete(); }}>确认删除</Button>
          </>
        )}
      >
        <p className="dialog-copy">将删除账号“{deleting?.displayName || deleting?.accountId}”及其本地入口配置。主账号不能删除。</p>
      </Dialog>
    </div>
  );
}
