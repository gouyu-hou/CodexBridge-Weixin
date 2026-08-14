import { useCallback, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Eye, Search, Trash2 } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { IconButton } from '../../components/ui/IconButton';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import type { AdminAccount, AdminSession } from '../../types/admin';
import { SessionHistoryDialog } from './SessionHistoryDialog';

const PAGE_SIZE = 10;

type SessionsPageProps = {
  accounts: readonly AdminAccount[];
  api: AdminApi;
};

type SessionFilters = {
  accountId: string;
  query: string;
  sort: string;
};

function formatTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function sessionName(session: AdminSession) {
  return session.title || session.codexThreadId || session.id;
}

export function SessionsPage({ accounts, api }: SessionsPageProps) {
  const [filters, setFilters] = useState<SessionFilters>({ accountId: '', query: '', sort: 'updatedDesc' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [page, setPage] = useState(0);
  const [historySession, setHistorySession] = useState<AdminSession | null>(null);
  const [deleteSession, setDeleteSession] = useState<AdminSession | null>(null);
  const [mutationId, setMutationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadSessions = useCallback(() => api.getSessions(appliedFilters), [api, appliedFilters]);
  const resource = useAsyncResource(loadSessions);
  const sessions = resource.data?.sessions ?? [];
  const pageCount = Math.max(1, Math.ceil(sessions.length / PAGE_SIZE));
  const visibleSessions = sessions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const accountNames = useMemo(
    () => new Map(accounts.map((account) => [account.accountId, account.displayName || account.accountId])),
    [accounts],
  );

  const mutate = async (session: AdminSession, action: 'archive' | 'delete') => {
    setMutationId(session.id);
    setError(null);
    try {
      if (action === 'delete') {
        await api.deleteSession(session.id);
      } else {
        await api.updateSession(session.id, { archived: !session.archived });
      }
      setDeleteSession(null);
      await resource.refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setMutationId(null);
    }
  };

  const columns: readonly DataTableColumn<AdminSession>[] = [
    {
      key: 'title',
      header: '标题 / 线程',
      render: (session) => (
        <div className="session-identity">
          <strong>{sessionName(session)}</strong>
          {session.preview && <span>{session.preview}</span>}
          <code title={session.codexThreadId ?? session.id}>{session.codexThreadId ?? session.id}</code>
        </div>
      ),
    },
    {
      key: 'accountIds',
      header: '微信账号',
      render: (session) => (session.accountIds ?? []).map((id) => accountNames.get(id) ?? id).join('、') || '-',
    },
    { key: 'model', header: '模型', render: (session) => session.model || '-' },
    { key: 'updatedAt', header: '更新时间', render: (session) => formatTime(session.updatedAt) },
    {
      key: 'archived',
      header: '状态',
      render: (session) => session.archived
        ? <StatusBadge tone="warning">已归档</StatusBadge>
        : session.pinned
          ? <StatusBadge tone="info">已置顶</StatusBadge>
          : <StatusBadge tone="success">正常</StatusBadge>,
    },
    {
      key: 'id',
      header: '操作',
      align: 'right',
      render: (session) => (
        <div className="table-actions">
          <IconButton label={`查看${sessionName(session)} 的历史`} onClick={() => setHistorySession(session)}><Eye /></IconButton>
          <IconButton
            label={`${session.archived ? '恢复' : '归档'}${sessionName(session)}`}
            disabled={mutationId === session.id}
            onClick={() => { void mutate(session, 'archive'); }}
          >
            {session.archived ? <ArchiveRestore /> : <Archive />}
          </IconButton>
          <IconButton label={`删除${sessionName(session)}`} tone="danger" onClick={() => setDeleteSession(session)}><Trash2 /></IconButton>
        </div>
      ),
    },
  ];

  return (
    <div className="page-stack sessions-page">
      <Panel title="会话管理" subtitle="查看微信关联会话、Codex 历史与本地记录状态">
        <form className="filter-bar" onSubmit={(event) => {
          event.preventDefault();
          setPage(0);
          setAppliedFilters({ ...filters, query: filters.query.trim() });
        }}>
          <label className="compact-field compact-field--grow">
            <span>搜索会话</span>
            <input type="search" value={filters.query} onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))} />
          </label>
          <label className="compact-field">
            <span>微信账号</span>
            <select value={filters.accountId} onChange={(event) => setFilters((current) => ({ ...current, accountId: event.target.value }))}>
              <option value="">全部账号</option>
              {accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName || account.accountId}</option>)}
            </select>
          </label>
          <label className="compact-field">
            <span>排序</span>
            <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>
              <option value="updatedDesc">最近更新</option>
              <option value="updatedAsc">最早更新</option>
              <option value="createdDesc">最近创建</option>
              <option value="titleAsc">标题 A-Z</option>
              <option value="titleDesc">标题 Z-A</option>
            </select>
          </label>
          <Button type="submit" variant="primary" icon={<Search />}>筛选</Button>
        </form>
        {(error || resource.error) && <InlineAlert tone="error" title="会话操作失败">{error ?? resource.error?.message}</InlineAlert>}
        <div className="table-summary">
          <span>{resource.data?.total ? `显示 ${resource.data.returned ?? sessions.length} / ${resource.data.total} 个会话` : '暂无会话'}</span>
          {resource.refreshing && <span>正在刷新...</span>}
        </div>
        <DataTable columns={columns} emptyText="没有找到匹配的会话" loading={resource.loading} rowKey={(session) => session.id} rows={visibleSessions} />
        <div className="pagination" aria-label="会话分页">
          <IconButton label="上一页" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft /></IconButton>
          <span>第 {Math.min(page + 1, pageCount)} / {pageCount} 页</span>
          <IconButton label="下一页" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight /></IconButton>
        </div>
      </Panel>

      {historySession && <SessionHistoryDialog api={api} session={historySession} onClose={() => setHistorySession(null)} />}
      <Dialog
        open={Boolean(deleteSession)}
        title="删除会话"
        onClose={() => setDeleteSession(null)}
        footer={(
          <>
            <Button onClick={() => setDeleteSession(null)}>取消</Button>
            <Button
              variant="danger"
              busy={Boolean(deleteSession && mutationId === deleteSession.id)}
              onClick={() => { if (deleteSession) void mutate(deleteSession, 'delete'); }}
            >确认删除</Button>
          </>
        )}
      >
        <p className="dialog-copy">只删除本地会话记录，不会删除 Codex 原始历史文件。此操作无法撤销。</p>
      </Dialog>
    </div>
  );
}
