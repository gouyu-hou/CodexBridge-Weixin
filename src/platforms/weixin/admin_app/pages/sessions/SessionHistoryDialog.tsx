import { useCallback, useState } from 'react';
import { Search } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { InlineAlert } from '../../components/ui/Feedback';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import type { AdminSession } from '../../types/admin';

type SessionHistoryDialogProps = {
  api: AdminApi;
  onClose: () => void;
  session: AdminSession;
};

function formatTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function SessionHistoryDialog({ api, onClose, session }: SessionHistoryDialogProps) {
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const loadHistory = useCallback(
    () => api.getSessionHistory(session.id, appliedQuery),
    [api, appliedQuery, session.id],
  );
  const resource = useAsyncResource(loadHistory);
  const messages = resource.data?.messages ?? [];

  return (
    <Dialog open title="会话历史" onClose={onClose}>
      <div className="history-dialog">
        <div className="history-dialog__heading">
          <strong>{session.title || session.codexThreadId || session.id}</strong>
          <span>{resource.data?.total ? `${messages.length} / ${resource.data.total} 条消息` : 'Codex 原始会话记录'}</span>
        </div>
        <form className="filter-bar filter-bar--history" onSubmit={(event) => {
          event.preventDefault();
          setAppliedQuery(query.trim());
        }}>
          <label className="compact-field compact-field--grow">
            <span>搜索历史消息</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <Button type="submit" icon={<Search />}>搜索历史</Button>
        </form>
        {resource.error && (
          <InlineAlert tone="error" title="无法读取会话历史">{resource.error.message}</InlineAlert>
        )}
        {resource.loading ? (
          <div className="empty-block">正在加载历史...</div>
        ) : !resource.data?.sessionPath ? (
          <div className="empty-block">没有找到这条会话的 Codex 历史文件</div>
        ) : messages.length === 0 ? (
          <div className="empty-block">没有匹配的历史消息</div>
        ) : (
          <div className="history-list">
            {messages.map((message, index) => (
              <article className="history-message" data-role={message.role ?? 'assistant'} key={`${message.timestamp ?? 'message'}-${index}`}>
                <header>
                  <strong>{message.role === 'user' ? '用户' : '助手'}</strong>
                  <time>{formatTime(message.timestamp)}</time>
                </header>
                <p>{message.text ?? ''}</p>
              </article>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
