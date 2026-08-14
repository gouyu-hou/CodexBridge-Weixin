import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { AdminState } from '../../types/admin';

export function RuntimePage({ state }: { state: AdminState | null }) {
  const bridge = state?.bridge;
  const activeTurns = Number(bridge?.activeTurns || 0);
  const maxTurns = Number(bridge?.maxConcurrentTurns || 0);
  return (
    <div className="page-stack">
      <Panel title="桥接进程" subtitle="进程状态与本地运行目录">
        <dl className="description-list">
          <div><dt>服务状态</dt><dd><StatusBadge tone={bridge?.running ? 'success' : 'warning'}>{bridge?.running ? '运行中' : '已停止'}</StatusBadge></dd></div>
          <div><dt>当前回合</dt><dd id="metric-turns">{activeTurns} / {maxTurns || '-'}</dd></div>
          <div><dt>启动时间</dt><dd>{bridge?.startedAt ? new Date(bridge.startedAt).toLocaleString('zh-CN') : '-'}</dd></div>
          <div><dt>数据目录</dt><dd className="mono-value">{state?.stateDir || '-'}</dd></div>
          <div><dt>账号数量</dt><dd>{state?.accounts?.length ?? 0}</dd></div>
          <div><dt>日志体积</dt><dd>{Number(state?.logs?.totalBytes || 0).toLocaleString('zh-CN')} B</dd></div>
        </dl>
        <div className="runtime-progress"><ProgressBar label="回合并发占用" value={activeTurns} max={Math.max(1, maxTurns)} /></div>
        <span className="visually-hidden" id="status-updated">状态已更新</span>
      </Panel>
    </div>
  );
}
