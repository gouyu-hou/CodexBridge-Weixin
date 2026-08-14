import { useEffect, useState } from 'react';
import { Download, FolderOpen, RefreshCw, RotateCcw, UploadCloud } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { TextField } from '../../components/ui/Fields';
import { Panel } from '../../components/ui/Panel';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type {
  DesktopUpdateStatus,
  DesktopUpdaterBridge,
  LightweightUpdateHistory,
  LightweightUpdateStatus,
  LightweightUpdaterBridge,
} from '../../types/electron';

type UpdatesPageProps = {
  lightweightUpdater?: LightweightUpdaterBridge | null;
  updater?: DesktopUpdaterBridge | null;
};

function formatTime(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function desktopStatusLabel(status: DesktopUpdateStatus) {
  if (status.error) return '检查失败';
  if (status.checking) return '正在检查';
  if (status.downloading) return '正在下载';
  if (status.downloaded) return '已下载';
  if (status.available) return '发现新版本';
  if (status.lastCheckedAt) return '已是最新';
  if (status.packaged === false) return '开发模式';
  return '等待检查';
}

const actionLabels: Record<string, string> = {
  failure: '失败',
  install: '安装',
  rollback: '回滚',
  verify: '验签',
};

function historyTone(result?: string) {
  return result === 'success' ? 'success' : result === 'failure' ? 'error' : 'warning';
}

export function UpdatesPage({
  lightweightUpdater = window.codexbridgeLightweightUpdater ?? null,
  updater = window.codexbridgeUpdater ?? null,
}: UpdatesPageProps) {
  const [status, setStatus] = useState<DesktopUpdateStatus>({});
  const [lightStatus, setLightStatus] = useState<LightweightUpdateStatus>({});
  const [localPath, setLocalPath] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<'install' | 'rollback' | null>(null);

  useEffect(() => {
    let active = true;
    void updater?.getStatus().then((next) => { if (active) setStatus(next); }).catch((value: unknown) => {
      if (active) setError(value instanceof Error ? value.message : String(value));
    });
    void lightweightUpdater?.getStatus().then((next) => { if (active) setLightStatus(next); }).catch((value: unknown) => {
      if (active) setError(value instanceof Error ? value.message : String(value));
    });
    const unsubscribe = updater?.onStatus?.((next) => setStatus((current) => ({ ...current, ...next })));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [lightweightUpdater, updater]);

  const runDesktop = async (action: 'check' | 'download') => {
    if (!updater) return;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const next = await updater[action]();
      setStatus((current) => ({ ...current, ...next }));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy('');
    }
  };

  const runLight = async (action: 'check' | 'downloadInstall' | 'installLocal' | 'rollback') => {
    if (!lightweightUpdater) return;
    if (action === 'installLocal' && !localPath.trim()) {
      setError('请先选择或填写轻量更新包路径');
      return;
    }
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const next = action === 'installLocal'
        ? await lightweightUpdater.installLocal({ path: localPath.trim() })
        : await lightweightUpdater[action]();
      setLightStatus((current) => ({ ...current, ...next }));
      setMessage(action === 'rollback' ? '已回退到内置版本，请重新打开应用' : action === 'check' ? '轻量更新检查完成' : '轻量更新已安装，请重新打开应用');
      setConfirmation(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy('');
    }
  };

  const installDesktop = async () => {
    if (!updater) return;
    setBusy('install');
    setError('');
    try {
      await updater.install();
      setConfirmation(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy('');
    }
  };

  const pickLocal = async () => {
    if (!lightweightUpdater) return;
    setBusy('pick');
    try {
      const result = await lightweightUpdater.pickLocal();
      if (!result.canceled && result.path) setLocalPath(result.path);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusy('');
    }
  };

  const history = [...(lightStatus.history ?? [])].reverse();
  const percent = Math.round(Number(status.progress?.percent ?? (status.downloaded ? 100 : 0)));

  return (
    <div className="page-stack updates-page">
      {(error || message) && <InlineAlert tone={error ? 'error' : 'success'} title={error ? '更新操作失败' : '操作完成'}>{error || message}</InlineAlert>}
      <Panel title="安装版更新" subtitle="更新 Electron、Node、Codex runtime 与完整业务代码">
        <div className="update-facts">
          <div><span>当前版本</span><strong>{status.currentVersion ?? '-'}</strong></div>
          <div><span>最新版本</span><strong>{status.latestVersion ?? '-'}</strong></div>
          <div><span>更新状态</span><StatusBadge tone={status.error ? 'error' : status.downloaded ? 'success' : status.available ? 'info' : 'neutral'}>{updater ? desktopStatusLabel(status) : '桌面安装版不可用'}</StatusBadge></div>
          <div><span>上次检查</span><strong>{formatTime(status.lastCheckedAt)}</strong></div>
        </div>
        <div className="update-progress"><ProgressBar label="下载进度" value={percent} /></div>
        <div className="update-command-row">
          <Button busy={busy === 'check'} disabled={!updater || status.canCheck === false} icon={<RefreshCw />} onClick={() => { void runDesktop('check'); }}>检查更新</Button>
          <Button busy={busy === 'download'} disabled={!updater || status.canDownload === false || status.downloading || status.downloaded} icon={<Download />} onClick={() => { void runDesktop('download'); }}>下载更新</Button>
          <Button variant="primary" disabled={!updater || status.canInstall === false} icon={<UploadCloud />} onClick={() => setConfirmation('install')}>重启安装</Button>
        </div>
        <div className="release-notes"><span>版本说明</span><pre>{status.releaseNotes?.trim() || '暂无更新日志。'}</pre></div>
      </Panel>

      <Panel title="轻量代码更新" subtitle="只替换业务代码和页面，不重复下载桌面运行时">
        <div className="update-facts">
          <div><span>代码来源</span><strong>{lightStatus.usingLightweight ? '轻量代码包' : '内置安装包'}</strong></div>
          <div><span>当前版本</span><strong>{lightStatus.currentVersion || lightStatus.builtInVersion || '-'}</strong></div>
          <div><span>轻量状态</span><StatusBadge tone={lightStatus.error ? 'error' : lightStatus.available ? 'info' : lightStatus.usingLightweight ? 'success' : 'neutral'}>{lightStatus.error ? '有错误' : lightStatus.available ? '发现更新' : lightStatus.usingLightweight ? '已启用' : '未启用'}</StatusBadge></div>
          <div><span>上次操作</span><strong>{formatTime(lightStatus.lastActionAt)}</strong></div>
        </div>
        <div className="local-update-row">
          <TextField label="本地轻量包路径" value={localPath} placeholder="目录或 zip 文件路径" onChange={(event) => setLocalPath(event.target.value)} />
          <Button busy={busy === 'pick'} icon={<FolderOpen />} onClick={() => { void pickLocal(); }}>选择轻量更新包</Button>
        </div>
        <div className="update-command-row">
          <Button busy={busy === 'check'} disabled={!lightweightUpdater || lightStatus.canCheck === false} icon={<RefreshCw />} onClick={() => { void runLight('check'); }}>检查轻量更新</Button>
          <Button busy={busy === 'downloadInstall'} disabled={!lightweightUpdater || lightStatus.canDownloadInstall === false} icon={<Download />} onClick={() => { void runLight('downloadInstall'); }}>下载并安装轻量更新</Button>
          <Button variant="primary" busy={busy === 'installLocal'} disabled={!localPath.trim()} onClick={() => { void runLight('installLocal'); }}>安装本地轻量包</Button>
          <Button variant="danger" disabled={!lightweightUpdater || !lightStatus.canRollback} icon={<RotateCcw />} onClick={() => setConfirmation('rollback')}>回退到内置版本</Button>
        </div>
      </Panel>

      <Panel title="更新历史" subtitle="最近 20 条验签、安装、失败和回滚记录">
        {history.length ? (
          <div className="data-table-wrap"><table className="data-table update-history-table">
            <thead><tr><th>时间</th><th>操作</th><th>结果</th><th>版本</th><th>可信公钥</th><th>来源 / 错误</th></tr></thead>
            <tbody>{history.map((entry: LightweightUpdateHistory, index) => (
              <tr key={entry.id ?? `${entry.at ?? entry.timestamp ?? 'history'}-${index}`}>
                <td>{formatTime(entry.at ?? entry.timestamp)}</td>
                <td>{actionLabels[entry.action ?? ''] ?? entry.action ?? '-'}</td>
                <td><StatusBadge tone={historyTone(entry.result)}>{entry.result === 'success' ? '成功' : entry.result === 'failure' ? '失败' : '已跳过'}</StatusBadge></td>
                <td>{entry.version ?? '-'}</td>
                <td><code className="history-key" title={entry.keyId ?? ''}>{entry.keyId ?? '-'}</code></td>
                <td>{entry.errorMessage || entry.errorCode || entry.source || '-'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <div className="empty-block">暂无轻量更新历史</div>}
      </Panel>

      <Dialog
        open={confirmation === 'install'}
        title="安装新版本"
        onClose={() => setConfirmation(null)}
        footer={(
          <>
            <Button onClick={() => setConfirmation(null)}>取消</Button>
            <Button variant="primary" busy={busy === 'install'} onClick={() => { void installDesktop(); }}>确认重启安装</Button>
          </>
        )}
      ><p className="dialog-copy">应用将先停止微信桥接服务，然后重启并安装已下载的新版本。</p></Dialog>
      <Dialog
        open={confirmation === 'rollback'}
        title="回退轻量更新"
        onClose={() => setConfirmation(null)}
        footer={(
          <>
            <Button onClick={() => setConfirmation(null)}>取消</Button>
            <Button variant="danger" busy={busy === 'rollback'} onClick={() => { void runLight('rollback'); }}>确认回退</Button>
          </>
        )}
      ><p className="dialog-copy">将停用当前轻量代码包并恢复内置版本。回退后需要重新打开应用。</p></Dialog>
    </div>
  );
}
