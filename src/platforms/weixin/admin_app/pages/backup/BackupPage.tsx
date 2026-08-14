import { useState } from 'react';
import { Download, FileArchive, Upload } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { Panel } from '../../components/ui/Panel';
import type { JsonObject } from '../../types/admin';

type BackupPageProps = {
  api: AdminApi;
  onChanged: () => void;
};

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('无法读取备份文件'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsText(file);
  });
}

export function BackupPage({ api, onChanged }: BackupPageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [payload, setPayload] = useState<JsonObject | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const selectFile = (nextFile?: File) => {
    setPayload(null);
    setMessage('');
    if (!nextFile || !nextFile.name.toLocaleLowerCase().endsWith('.json')) {
      setFile(null);
      setError('仅支持 .json 备份文件');
      return;
    }
    setError('');
    setFile(nextFile);
  };

  const prepareImport = async () => {
    if (!file) {
      setError('请先选择备份 JSON 文件');
      return;
    }
    try {
      const parsed: unknown = JSON.parse(await readFile(file));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('备份根节点必须是 JSON 对象');
      setPayload(parsed as JsonObject);
      setConfirming(true);
      setError('');
    } catch (value) {
      setError(value instanceof Error ? value.message : '文件不是有效 JSON');
    }
  };

  const importNow = async () => {
    if (!payload) return;
    setImporting(true);
    setError('');
    try {
      const result = await api.importBackup(payload);
      const imported = result.imported && typeof result.imported === 'object' && !Array.isArray(result.imported)
        ? result.imported as JsonObject
        : {};
      setMessage(`导入完成：账号 ${Number(imported.accounts ?? 0)}，会话 ${Number(imported.bridgeSessions ?? 0)}`);
      setConfirming(false);
      setFile(null);
      setPayload(null);
      onChanged();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="page-stack backup-page">
      {(error || message) && <InlineAlert tone={error ? 'error' : 'success'} title={error ? '备份操作失败' : '导入完成'}>{error || message}</InlineAlert>}
      <Panel title="导出" subtitle="根据用途选择脱敏诊断或完整可恢复备份">
        <div className="backup-actions">
          <a className="backup-action" href="/api/export/diagnostic" download aria-label="导出脱敏诊断">
            <span className="backup-action__icon"><Download /></span>
            <span><strong>导出脱敏诊断</strong><small>用于排查问题，可安全提供给维护人员</small></span>
          </a>
          <a className="backup-action backup-action--sensitive" href="/api/export" download aria-label="导出完整备份">
            <span className="backup-action__icon"><FileArchive /></span>
            <span><strong>导出完整备份</strong><small>包含微信凭据与 Provider 密钥，请勿分享</small></span>
          </a>
        </div>
      </Panel>
      <Panel title="导入恢复" subtitle="同 ID 的账号、绑定、会话与配置将被覆盖">
        <div className="backup-import-row">
          <label className="file-drop">
            <Upload aria-hidden="true" />
            <span><strong>{file?.name ?? '选择备份 JSON 文件'}</strong><small>{file ? `${Math.max(1, Math.round(file.size / 1024))} KiB` : '仅支持 CodexBridge 导出的 .json 文件'}</small></span>
            <input aria-label="选择备份 JSON 文件" type="file" accept="application/json,.json" onChange={(event) => selectFile(event.target.files?.[0])} />
          </label>
          <Button variant="primary" disabled={!file} onClick={() => { void prepareImport(); }}>导入备份</Button>
        </div>
      </Panel>
      <Dialog
        open={confirming}
        title="确认导入备份"
        onClose={() => setConfirming(false)}
        footer={(
          <>
            <Button onClick={() => setConfirming(false)}>取消</Button>
            <Button variant="danger" busy={importing} onClick={() => { void importNow(); }}>确认导入</Button>
          </>
        )}
      >
        <p className="dialog-copy">导入会覆盖备份中同 ID 的账号、会话、绑定和运行配置。建议在继续前先导出当前完整备份。</p>
      </Dialog>
    </div>
  );
}
