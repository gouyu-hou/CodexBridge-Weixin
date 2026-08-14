import { AlertTriangle, CheckCircle2, MonitorSmartphone, Terminal } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';

const commands = [
  ['/status', '查看当前会话、模型、项目目录与权限'],
  ['/project D:\\你的项目路径', '指定电脑上的项目目录'],
  ['/allow 1', '单次批准第 1 个待审批操作'],
  ['/stop', '停止当前回复或执行任务'],
  ['/retry', '重试上一条任务'],
  ['/new', '准备一条新会话'],
  ['/threads', '查看历史会话列表'],
  ['/up', '连续暂存图片和文件'],
] as const;

export function PhoneGuidePage() {
  return (
    <div className="page-stack phone-guide-page">
      <section className="guide-intro">
        <span className="guide-intro__icon"><MonitorSmartphone /></span>
        <div>
          <h2>手机微信使用 Codex</h2>
          <p>微信消息由本机 CodexBridge 转发给电脑上的 Codex。电脑必须保持开机、联网，并持续运行本软件。</p>
        </div>
      </section>
      <div className="guide-flow" aria-label="首次使用流程">
        {['配置模型', '添加微信账号', '发送测试消息', '指定项目目录'].map((label, index) => (
          <div key={label}><span>{index + 1}</span><strong>{label}</strong></div>
        ))}
      </div>
      <Panel title="推荐操作顺序">
        <ol className="guide-steps">
          <li><CheckCircle2 /><span>在“模型供应商”选择 Provider Profile 和列表中的模型，并确认连接可用。</span></li>
          <li><CheckCircle2 /><span>在“用户入口”生成二维码，用微信扫码完成账号接入。</span></li>
          <li><CheckCircle2 /><span>在微信发送“你好”，收到回复后再开启项目控制。</span></li>
          <li><CheckCircle2 /><span>发送 <code>/project D:\你的项目路径</code>，然后描述目标、范围和验证方式。</span></li>
        </ol>
      </Panel>
      <Panel title="常用命令" subtitle="命令可直接发送到与桥接账号的微信会话">
        <div className="command-list">
          {commands.map(([command, description]) => (
            <div key={command}><code>{command}</code><span>{description}</span></div>
          ))}
        </div>
      </Panel>
      <Panel title="故障排查">
        <div className="guide-troubleshooting">
          <div><Terminal /><span><strong>一直显示正在输入</strong><small>先发送 /status，再用 /stop 中断；必要时在管理后台重启桥接。</small></span></div>
          <div><AlertTriangle /><span><strong>出现 429 / 502 / 503</strong><small>检查 Provider、API key、额度和 Base URL，稍后再用 /retry。</small></span></div>
          <div><AlertTriangle /><span><strong>手机不再回复</strong><small>确认电脑未睡眠、网络正常、软件仍在运行，并检查“运行日志”。</small></span></div>
        </div>
      </Panel>
    </div>
  );
}
