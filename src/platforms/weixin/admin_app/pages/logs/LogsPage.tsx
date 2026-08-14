import { useCallback, useMemo, useState } from 'react';
import { Copy, RefreshCw, Search, Trash2 } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { IconButton } from '../../components/ui/IconButton';
import { Panel } from '../../components/ui/Panel';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import type { AdminLogs, JsonObject } from '../../types/admin';

type LogsPageProps = {
  api: AdminApi;
};

function logLevel(line: string) {
  const match = line.match(/\[(error|warn|warning|info|debug|trace)\]/iu);
  if (!match) return 'other';
  return match[1].toLowerCase() === 'warning' ? 'warn' : match[1].toLowerCase();
}

function responseLogs(value: JsonObject): AdminLogs | null {
  const logs = value.logs;
  return logs && typeof logs === 'object' && !Array.isArray(logs) ? logs as AdminLogs : null;
}

export function LogsPage({ api }: LogsPageProps) {
  const [level, setLevel] = useState('all');
  const [query, setQuery] = useState('');
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupLogs, setCleanupLogs] = useState<AdminLogs | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const loadLogs = useCallback(() => api.getLogs(500), [api]);
  const resource = useAsyncResource(loadLogs);
  const logs = cleanupLogs ?? resource.data;
  const lines = logs?.lines ?? logs?.files?.flatMap((file) => file.lines ?? []) ?? [];
  const filteredLines = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return lines.filter((line) => {
      if (level !== 'all' && logLevel(line) !== level) return false;
      return !normalizedQuery || line.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [level, lines, query]);

  const refresh = async () => {
    setOperationError(null);
    setOperationMessage(null);
    const next = await resource.refresh();
    if (next) setCleanupLogs(null);
  };

  const cleanup = async () => {
    setCleaning(true);
    setOperationError(null);
    try {
      const response = await api.cleanupLogs();
      const nextLogs = responseLogs(response);
      if (nextLogs) setCleanupLogs(nextLogs);
      setConfirmCleanup(false);
      const cleanupValue = response.cleanup;
      const cleanupRecord = cleanupValue && typeof cleanupValue === 'object' && !Array.isArray(cleanupValue)
        ? cleanupValue as JsonObject
        : null;
      const actionCount = cleanupRecord && Array.isArray(cleanupRecord.actions) ? cleanupRecord.actions.length : 0;
      setOperationMessage(actionCount ? `已清理 ${actionCount} 个日志文件` : '日志无需清理');
    } catch (value) {
      setOperationError(value instanceof Error ? value.message : String(value));
    } finally {
      setCleaning(false);
    }
  };

  const copyLogs = async () => {
    if (!filteredLines.length) return;
    try {
      await navigator.clipboard.writeText(filteredLines.join('\n'));
      setOperationMessage('日志已复制');
    } catch {
      setOperationError('无法访问系统剪贴板');
    }
  };

  return (
    <div className="page-stack logs-page">
      <Panel
        title="运行日志"
        subtitle={`${lines.length} 行 · ${Math.round((logs?.totalBytes ?? 0) / 1024)} KiB`}
        actions={(
          <div className="table-actions">
            <IconButton label="复制日志" disabled={!filteredLines.length} onClick={() => { void copyLogs(); }}><Copy /></IconButton>
            <IconButton label="刷新日志" disabled={resource.refreshing} onClick={() => { void refresh(); }}><RefreshCw /></IconButton>
            <IconButton label="清理日志" tone="danger" onClick={() => setConfirmCleanup(true)}><Trash2 /></IconButton>
          </div>
        )}
      >
        <div className="filter-bar filter-bar--logs">
          <label className="compact-field">
            <span>日志级别</span>
            <select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="all">全部级别</option>
              <option value="error">错误</option>
              <option value="warn">警告</option>
              <option value="info">信息</option>
              <option value="debug">调试</option>
              <option value="trace">跟踪</option>
              <option value="other">其他</option>
            </select>
          </label>
          <label className="compact-field compact-field--grow">
            <span>搜索日志</span>
            <span className="search-input"><Search aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></span>
          </label>
        </div>
        {(operationError || resource.error) && <InlineAlert tone="error" title="日志操作失败">{operationError ?? resource.error?.message}</InlineAlert>}
        {operationMessage && <InlineAlert tone="success" title="操作完成">{operationMessage}</InlineAlert>}
        <div className="log-viewer" data-testid="log-viewer" aria-label="日志内容" aria-busy={resource.refreshing || undefined}>
          {resource.loading ? (
            <div className="log-viewer__empty">正在加载日志...</div>
          ) : filteredLines.length ? filteredLines.map((line, index) => (
            <div className="log-line" data-level={logLevel(line)} key={`${index}-${line.slice(0, 32)}`}>{line}</div>
          )) : (
            <div className="log-viewer__empty">没有匹配的日志</div>
          )}
        </div>
      </Panel>

      <Dialog
        open={confirmCleanup}
        title="清理日志"
        onClose={() => setConfirmCleanup(false)}
        footer={(
          <>
            <Button onClick={() => setConfirmCleanup(false)}>取消</Button>
            <Button variant="danger" busy={cleaning} onClick={() => { void cleanup(); }}>确认清理</Button>
          </>
        )}
      >
        <p className="dialog-copy">将按照当前保留策略删除过期日志文件。当前正在使用的日志不会被删除。</p>
      </Dialog>
    </div>
  );
}
