import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import type { AdminMetrics } from '../../types/admin';

type MetricsPageProps = {
  metrics: AdminMetrics | null;
  onReset: () => void;
  resetting: boolean;
};

export function MetricsPage({ metrics, onReset, resetting }: MetricsPageProps) {
  const [confirming, setConfirming] = useState(false);
  const completed = Number(metrics?.turnsCompleted || 0);
  const failed = Number(metrics?.turnsFailed || 0);
  const delivered = Number(metrics?.deliveriesSucceeded || 0);
  const deliveryFailed = Number(metrics?.deliveriesFailed || 0);
  const confirmReset = () => {
    setConfirming(false);
    onReset();
  };
  return (
    <div className="page-stack">
      <Panel
        title="累计用量"
        subtitle="从本次统计周期开始累计"
        actions={<Button icon={<RotateCcw />} onClick={() => setConfirming(true)}>重置统计</Button>}
      >
        <div className="metric-strip metric-strip--six">
          <div><span>收到消息</span><strong>{Number(metrics?.messagesReceived || 0).toLocaleString('zh-CN')}</strong></div>
          <div><span>完成回合</span><strong>{completed.toLocaleString('zh-CN')}</strong></div>
          <div><span>失败回合</span><strong>{failed.toLocaleString('zh-CN')}</strong></div>
          <div><span>投递成功</span><strong>{delivered.toLocaleString('zh-CN')}</strong></div>
          <div><span>投递失败</span><strong>{deliveryFailed.toLocaleString('zh-CN')}</strong></div>
          <div><span>最近错误</span><strong>{Number(metrics?.errorsRecentHour || 0).toLocaleString('zh-CN')}</strong></div>
        </div>
      </Panel>
      <Panel title="处理健康度" subtitle="成功与失败比例">
        <div className="metrics-progress-list">
          <ProgressBar label="回合成功" value={completed} max={Math.max(1, completed + failed)} />
          <ProgressBar label="消息投递" value={delivered} max={Math.max(1, delivered + deliveryFailed)} />
        </div>
      </Panel>
      <Dialog
        open={confirming}
        title="重置用量统计"
        onClose={() => setConfirming(false)}
        footer={(
          <>
            <Button onClick={() => setConfirming(false)}>取消</Button>
            <Button variant="danger" busy={resetting} onClick={confirmReset}>确认重置</Button>
          </>
        )}
      >
        <p className="dialog-copy">重置后当前累计指标会清零，此操作不会删除账号、会话或日志。</p>
      </Dialog>
    </div>
  );
}
