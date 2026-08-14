import { RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../components/ui/DataTable';
import { InlineAlert } from '../../components/ui/Feedback';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AdminAccount, AdminMetrics, AdminState } from '../../types/admin';

type OverviewPageProps = {
  loading: boolean;
  metrics: AdminMetrics | null;
  onRetryDelivery: () => void;
  retrying: boolean;
  state: AdminState | null;
};

const accountColumns: readonly DataTableColumn<AdminAccount>[] = [
  { key: 'displayName', header: '名称', render: (account) => account.displayName || '未命名账号' },
  { key: 'accountId', header: '账号' },
  { key: 'role', header: '角色', render: (account) => account.role || '普通用户' },
  {
    key: 'enabled',
    header: '状态',
    render: (account) => <StatusBadge tone={account.disabled ? 'warning' : 'success'}>{account.disabled ? '已停用' : '可用'}</StatusBadge>,
  },
];

function metricValue(value: unknown) {
  return Number(value || 0).toLocaleString('zh-CN');
}

export function OverviewPage({ loading, metrics, onRetryDelivery, retrying, state }: OverviewPageProps) {
  const accounts = state?.accounts ?? [];
  const pending = Number(metrics?.pendingDeliveryRetries || 0);
  const completed = Number(metrics?.turnsCompleted || 0);
  const failed = Number(metrics?.turnsFailed || 0);
  const totalDeliveries = Number(metrics?.deliveriesSucceeded || 0) + Number(metrics?.deliveriesFailed || 0);

  return (
    <div className="page-stack overview-page">
      {pending > 0 && (
        <InlineAlert tone="warning" title="有消息等待重新投递">
          当前有 {pending} 条消息尚未成功投递，可以在服务稳定后重试。
        </InlineAlert>
      )}

      <Panel title="服务概览" subtitle="当前进程与消息处理状态">
        <div className="overview-status-row">
          <div>
            <span className="eyebrow">微信桥接</span>
            <strong>{state?.bridge?.running ? '服务正在运行' : '服务未运行'}</strong>
          </div>
          <StatusBadge tone={state?.bridge?.running ? 'success' : 'warning'}>
            {state?.bridge?.running ? '运行中' : '已停止'}
          </StatusBadge>
        </div>
        <div className="metric-strip">
          <div><span>收到消息</span><strong>{metricValue(metrics?.messagesReceived)}</strong></div>
          <div><span>完成回合</span><strong>{metricValue(completed)}</strong></div>
          <div><span>失败回合</span><strong>{metricValue(failed)}</strong></div>
          <div><span>最近错误</span><strong>{metricValue(metrics?.errorsRecentHour)}</strong></div>
        </div>
        <div className="overview-progress-grid">
          <ProgressBar
            label="回合并发"
            value={Number(state?.bridge?.activeTurns || 0)}
            max={Number(state?.bridge?.maxConcurrentTurns || 1)}
          />
          <ProgressBar
            label="投递成功"
            value={Number(metrics?.deliveriesSucceeded || 0)}
            max={Math.max(1, totalDeliveries)}
          />
        </div>
        {pending > 0 && (
          <div className="panel-command-row">
            <Button busy={retrying} icon={<RotateCcw />} onClick={onRetryDelivery}>重试待投递消息</Button>
          </div>
        )}
      </Panel>

      <Panel title="已连接账号" subtitle={`共 ${accounts.length} 个微信账号`}>
        <DataTable
          bodyId="accounts-body"
          columns={accountColumns}
          emptyText="尚未添加微信账号"
          loading={loading}
          rows={accounts}
          rowKey={(account) => account.accountId}
        />
      </Panel>
    </div>
  );
}
