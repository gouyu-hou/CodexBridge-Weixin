import { useEffect, useMemo, useState } from 'react';
import { BellRing, Save } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { InlineAlert } from '../../components/ui/Feedback';
import { Switch, TextField } from '../../components/ui/Fields';
import { Panel } from '../../components/ui/Panel';
import type { AdminSettings } from '../../types/admin';

type SettingsPageProps = {
  api: AdminApi;
  onChanged: () => void;
  settings: AdminSettings;
};

type SettingsForm = {
  accountPollConcurrency: string;
  alertWebhookUrl: string;
  attachmentProcessingConcurrency: string;
  eventDispatchConcurrency: string;
  intervalMinutes: string;
  logCleanupEnabled: boolean;
  maxConcurrentTurns: string;
  maxMegabytes: string;
  retentionDays: string;
};

function formFromSettings(settings: AdminSettings): SettingsForm {
  const concurrency = settings.concurrency ?? {};
  const cleanup = settings.logCleanup ?? {};
  return {
    accountPollConcurrency: String(concurrency.accountPollConcurrency ?? 4),
    alertWebhookUrl: settings.alertWebhookUrl ?? '',
    attachmentProcessingConcurrency: String(concurrency.attachmentProcessingConcurrency ?? 3),
    eventDispatchConcurrency: String(concurrency.eventDispatchConcurrency ?? 12),
    intervalMinutes: String(cleanup.intervalMinutes ?? 60),
    logCleanupEnabled: cleanup.enabled !== false,
    maxConcurrentTurns: String(concurrency.maxConcurrentTurns ?? 3),
    maxMegabytes: String(Math.max(1, Math.round((cleanup.maxBytes ?? 10 * 1024 * 1024) / 1024 / 1024))),
    retentionDays: String(cleanup.retentionDays ?? 7),
  };
}

function validInteger(value: string, min: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

export function SettingsPage({ api, onChanged, settings }: SettingsPageProps) {
  const initial = useMemo(() => formFromSettings(settings), [settings]);
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  useEffect(() => setForm(initial), [initial]);

  const setValue = (key: keyof SettingsForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
    setMessage('');
  };

  const numberFields: Array<{
    key: keyof SettingsForm;
    label: string;
    max: number;
    min: number;
  }> = [
    { key: 'maxConcurrentTurns', label: '最大同时回复数', min: 1, max: 64 },
    { key: 'eventDispatchConcurrency', label: '事件分发并发', min: 1, max: 64 },
    { key: 'attachmentProcessingConcurrency', label: '附件处理并发', min: 1, max: 64 },
    { key: 'accountPollConcurrency', label: '账号轮询并发', min: 1, max: 64 },
    { key: 'retentionDays', label: '日志保留天数', min: 1, max: 365 },
    { key: 'maxMegabytes', label: '单个日志最大 MB', min: 1, max: 1024 },
    { key: 'intervalMinutes', label: '清理间隔分钟', min: 1, max: 1440 },
  ];

  const save = async () => {
    const invalid = numberFields.find((field) => !validInteger(String(form[field.key]), field.min, field.max));
    if (invalid) {
      setError(`请输入 ${invalid.min} 到 ${invalid.max} 之间的整数`);
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await api.updateSettings({
        alertWebhookUrl: form.alertWebhookUrl.trim(),
        concurrency: {
          maxConcurrentTurns: Number(form.maxConcurrentTurns),
          eventDispatchConcurrency: Number(form.eventDispatchConcurrency),
          attachmentProcessingConcurrency: Number(form.attachmentProcessingConcurrency),
          accountPollConcurrency: Number(form.accountPollConcurrency),
        },
        logCleanup: {
          enabled: form.logCleanupEnabled,
          retentionDays: Number(form.retentionDays),
          maxBytes: Number(form.maxMegabytes) * 1024 * 1024,
          intervalMinutes: Number(form.intervalMinutes),
        },
      });
      setMessage('配置已保存并即时生效');
      onChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  };

  const testWebhook = async () => {
    setTesting(true);
    setError('');
    setMessage('');
    try {
      const result = await api.testAlert({ url: form.alertWebhookUrl.trim() });
      setMessage(result.configured === false ? '请先填写 Webhook 地址' : result.ok ? '测试告警已发送' : '测试告警发送失败');
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="page-stack settings-page">
      {(error || message) && (
        <InlineAlert tone={error ? 'error' : 'success'} title={error ? '配置未保存' : '操作完成'}>{error || message}</InlineAlert>
      )}
      <Panel title="并发控制" subtitle="控制回复、事件、附件和账号轮询的并行数量">
        <div className="maintenance-form-grid">
          {numberFields.slice(0, 4).map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type="number"
              min={field.min}
              max={field.max}
              step="1"
              value={String(form[field.key])}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
          ))}
        </div>
      </Panel>
      <Panel title="日志保留" subtitle="自动限制本地日志数量和磁盘占用">
        <div className="maintenance-switch-row">
          <Switch checked={form.logCleanupEnabled} label="启用自动日志清理" onChange={(checked) => setValue('logCleanupEnabled', checked)} />
        </div>
        <div className="maintenance-form-grid">
          {numberFields.slice(4).map((field) => (
            <TextField
              key={field.key}
              label={field.label}
              type="number"
              min={field.min}
              max={field.max}
              step="1"
              value={String(form[field.key])}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
          ))}
        </div>
      </Panel>
      <Panel title="错误告警" subtitle="出现运行错误时向 HTTP/HTTPS Webhook 发送通知">
        <div className="webhook-control">
          <TextField label="Webhook 地址" placeholder="https://..." value={form.alertWebhookUrl} onChange={(event) => setValue('alertWebhookUrl', event.target.value)} />
          <Button busy={testing} icon={<BellRing />} onClick={() => { void testWebhook(); }}>测试 Webhook</Button>
        </div>
      </Panel>
      <div className="sticky-command-bar">
        <span>{dirty ? '有尚未保存的修改' : '所有配置已同步'}</span>
        <Button variant="primary" busy={saving} disabled={!dirty} icon={<Save />} onClick={() => { void save(); }}>保存配置</Button>
      </div>
    </div>
  );
}
