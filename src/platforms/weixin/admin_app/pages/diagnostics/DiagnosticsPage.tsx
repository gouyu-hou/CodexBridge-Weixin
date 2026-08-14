import { Activity } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Panel } from '../../components/ui/Panel';
import { StatusBadge, type StatusTone } from '../../components/ui/StatusBadge';
import type { DiagnosticsResult } from '../../types/admin';

type DiagnosticsPageProps = {
  onRun: () => void;
  result: DiagnosticsResult | null;
  running: boolean;
};

function diagnosticTone(status: string | undefined): StatusTone {
  if (status === 'ok') return 'success';
  if (status === 'fail') return 'error';
  return 'warning';
}

function diagnosticLabel(status: string | undefined) {
  if (status === 'ok') return '正常';
  if (status === 'fail') return '需要处理';
  return '提醒';
}

export function DiagnosticsPage({ onRun, result, running }: DiagnosticsPageProps) {
  const summary = result?.summary;
  const checks = result?.checks ?? [];
  return (
    <div className="page-stack">
      <Panel
        title="系统诊断"
        subtitle="检查桥接、账号、Provider 和本地运行环境"
        actions={<Button variant="primary" busy={running} icon={<Activity />} onClick={onRun}>运行诊断</Button>}
      >
        <div className="diagnostic-summary">
          <StatusBadge tone={diagnosticTone(summary?.status)}>{diagnosticLabel(summary?.status)}</StatusBadge>
          <strong>{String(summary?.text || '尚未运行诊断')}</strong>
          <span>正常 {Number(summary?.ok || 0)} · 提醒 {Number(summary?.warned || 0)} · 失败 {Number(summary?.failed || 0)}</span>
        </div>
      </Panel>
      <Panel title="检查项目" subtitle={`共 ${checks.length} 项`}>
        <div className="diagnostic-list">
          {checks.length === 0 && <div className="empty-block">运行诊断后将在这里显示检查结果</div>}
          {checks.map((check) => (
            <details className="diagnostic-item" key={String(check.id || check.title)}>
              <summary>
                <span>{String(check.title || check.id || '诊断项目')}</span>
                <StatusBadge tone={diagnosticTone(check.status)}>{diagnosticLabel(check.status)}</StatusBadge>
              </summary>
              <div className="diagnostic-item__body">
                <p>{String(check.detail || '-')}</p>
                {check.reason && <small>{String(check.reason)}</small>}
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
