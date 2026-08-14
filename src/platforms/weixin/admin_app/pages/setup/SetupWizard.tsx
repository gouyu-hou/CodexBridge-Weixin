import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, KeyRound, MessageCircle, Terminal } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { sanitizeAdminError } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { SetupState } from '../../types/admin';

type SetupWizardProps = {
  api: AdminApi;
  onClose: () => void;
  onComplete: () => void;
  onOpenPairing: () => void;
  onOpenProvider: () => void;
  open: boolean;
  setup?: SetupState;
};

const steps = ['环境检查', '模型配置', '连通性测试', '微信绑定', '完成'];
const checkLabels: Array<[keyof NonNullable<SetupState['checks']>, string]> = [
  ['dataDir', '数据目录'],
  ['serviceEnvFile', '配置文件'],
  ['node', 'Node 环境'],
  ['codex', 'Codex CLI'],
  ['modelProvider', '模型配置'],
  ['weixinAccount', '微信入口'],
];

export function SetupWizard({
  api,
  onClose,
  onComplete,
  onOpenPairing,
  onOpenProvider,
  open,
  setup,
}: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [testTarget, setTestTarget] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const runTest = async (target: 'api-key' | 'weixin' | 'codex-command') => {
    setTestTarget(target);
    setMessage('');
    setError('');
    try {
      const result = await api.testSetup({ target });
      setMessage(String(result.message || '测试完成'));
    } catch (value) {
      setError(sanitizeAdminError(value instanceof Error ? value.message : value));
    } finally {
      setTestTarget('');
    }
  };

  const finish = async (skipped: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api.completeSetup({ skipped });
      onComplete();
      onClose();
    } catch (value) {
      setError(sanitizeAdminError(value instanceof Error ? value.message : value));
    } finally {
      setBusy(false);
    }
  };

  const checks = setup?.checks ?? {};
  return (
    <Dialog
      open={open}
      title="首次配置向导"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" busy={busy} onClick={() => { void finish(true); }}>稍后配置</Button>
          <span className="setup-wizard__footer-spacer" />
          <Button disabled={step === 0 || busy} onClick={() => setStep((current) => current - 1)}>上一步</Button>
          {step < steps.length - 1 ? (
            <Button variant="primary" disabled={busy} onClick={() => setStep((current) => current + 1)}>下一步</Button>
          ) : (
            <Button variant="primary" busy={busy} onClick={() => { void finish(false); }}>完成配置</Button>
          )}
        </>
      )}
    >
      <div className="setup-wizard">
        <ol className="setup-steps" aria-label="配置进度">
          {steps.map((label, index) => (
            <li key={label} data-active={String(index === step)} data-complete={String(index < step)}>
              <span>{index < step ? <CheckCircle2 aria-hidden="true" /> : index + 1}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>

        {error && <InlineAlert tone="error" title="操作失败">{error}</InlineAlert>}
        {message && <InlineAlert tone="success" title="测试结果">{message}</InlineAlert>}

        {step === 0 && (
          <section className="setup-panel" aria-label="环境检查">
            <div className="setup-panel__heading"><h3>运行环境</h3><p>确认本地运行时和数据目录已准备就绪。</p></div>
            <div className="setup-check-grid">
              {checkLabels.map(([key, label]) => {
                const check = checks[key];
                const ok = Boolean(check?.ok);
                return (
                  <div className="setup-check" key={key} data-ok={String(ok)}>
                    {ok ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
                    <div><strong>{label}</strong><span>{check?.label || (ok ? '通过' : '待检查')}</span><p>{check?.detail || '暂无检查信息'}</p></div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="setup-panel setup-panel--centered" aria-label="模型配置">
            <KeyRound aria-hidden="true" />
            <h3>配置模型供应商</h3>
            <p>从已支持的 Provider 中选择模型并验证密钥。模型仅允许从供应商返回的列表中选择。</p>
            <StatusBadge tone={checks.modelProvider?.ok ? 'success' : 'warning'}>{checks.modelProvider?.ok ? '已配置' : '需要配置'}</StatusBadge>
            <Button variant="primary" onClick={onOpenProvider}>前往模型配置</Button>
          </section>
        )}

        {step === 2 && (
          <section className="setup-panel" aria-label="连通性测试">
            <div className="setup-panel__heading"><h3>逐项测试</h3><p>测试只读取当前配置，不会修改运行参数。</p></div>
            <div className="setup-test-list">
              <div><KeyRound aria-hidden="true" /><span><strong>API 密钥</strong><small>验证 Provider 授权与模型访问</small></span><Button busy={testTarget === 'api-key'} onClick={() => { void runTest('api-key'); }}>测试 API 密钥</Button></div>
              <div><MessageCircle aria-hidden="true" /><span><strong>微信连接</strong><small>检查已绑定账号与消息通道</small></span><Button busy={testTarget === 'weixin'} onClick={() => { void runTest('weixin'); }}>测试微信连接</Button></div>
              <div><Terminal aria-hidden="true" /><span><strong>Codex 命令</strong><small>检查本机命令行运行时</small></span><Button busy={testTarget === 'codex-command'} onClick={() => { void runTest('codex-command'); }}>测试 Codex 命令</Button></div>
            </div>
          </section>
        )}

        {step === 3 && (
          <section className="setup-panel setup-panel--centered" aria-label="微信绑定">
            <MessageCircle aria-hidden="true" />
            <h3>绑定微信账号</h3>
            <p>生成二维码后使用微信扫码确认。已绑定账号可以直接跳过此步。</p>
            <StatusBadge tone={checks.weixinAccount?.ok ? 'success' : 'warning'}>{checks.weixinAccount?.ok ? '已绑定' : '尚未绑定'}</StatusBadge>
            <Button variant="primary" onClick={onOpenPairing}>绑定微信账号</Button>
          </section>
        )}

        {step === 4 && (
          <section className="setup-panel setup-panel--centered" aria-label="完成配置">
            <Circle className="setup-finish-mark" aria-hidden="true" />
            <h3>准备完成配置</h3>
            <p>完成后仍可通过顶部配置入口重新打开向导，所有设置也可以在对应页面继续调整。</p>
            <div className="setup-summary">
              <span>环境检查 <StatusBadge tone={checks.node?.ok && checks.codex?.ok ? 'success' : 'warning'}>{checks.node?.ok && checks.codex?.ok ? '通过' : '待确认'}</StatusBadge></span>
              <span>模型配置 <StatusBadge tone={checks.modelProvider?.ok ? 'success' : 'warning'}>{checks.modelProvider?.ok ? '完成' : '待配置'}</StatusBadge></span>
              <span>微信账号 <StatusBadge tone={checks.weixinAccount?.ok ? 'success' : 'warning'}>{checks.weixinAccount?.ok ? '已绑定' : '可稍后绑定'}</StatusBadge></span>
            </div>
          </section>
        )}
      </div>
    </Dialog>
  );
}
