import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AdminApi } from '../../api/adminApi';
import { IconButton } from '../../components/ui/IconButton';
import { ProgressBar } from '../../components/ui/ProgressBar';
import type { ProviderUsage as ProviderUsageData } from '../../types/admin';

type ProviderUsageProps = {
  api: AdminApi;
  profileId: string;
};

export function ProviderUsage({ api, profileId }: ProviderUsageProps) {
  const [data, setData] = useState<ProviderUsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = async (refresh: boolean) => {
    if (!profileId) return;
    setLoading(true);
    setError('');
    try {
      setData(await api.getProviderUsage(profileId, refresh));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    void load(false);
    // Usage follows the currently selected profile.
  }, [profileId]);

  const windows = data?.report?.buckets?.flatMap((bucket) =>
    (bucket.windows ?? []).map((windowInfo) => ({ bucket: bucket.name, ...windowInfo }))) ?? [];

  return (
    <div className="provider-usage">
      <div className="provider-usage__head">
        <div>
          <strong>Provider 用量</strong>
          <span>{data?.report?.provider || data?.providerKind || profileId}</span>
        </div>
        <IconButton label="刷新用量" disabled={loading || !profileId} onClick={() => { void load(true); }}><RefreshCw /></IconButton>
      </div>
      {error && <div className="provider-usage__empty">{error}</div>}
      {!error && data && data.status !== 'available' && (
        <div className="provider-usage__empty">当前 Provider 暂不支持用量查询</div>
      )}
      {!error && data?.status === 'available' && windows.length === 0 && (
        <div className="provider-usage__empty">当前 Provider 没有返回额度窗口</div>
      )}
      {windows.map((windowInfo, index) => {
        const used = Math.max(0, Math.min(100, Number(windowInfo.usedPercent || 0)));
        return (
          <div className="provider-usage__window" key={`${windowInfo.bucket}-${windowInfo.name}-${index}`}>
            <div className="provider-usage__meta">
              <span>{[windowInfo.bucket, windowInfo.name].filter(Boolean).join(' · ') || '用量窗口'}</span>
              <strong>剩余 {Math.round(100 - used)}%</strong>
            </div>
            <ProgressBar label="剩余额度" value={100 - used} max={100} />
          </div>
        );
      })}
    </div>
  );
}
