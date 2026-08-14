import { useCallback, useMemo, useState } from 'react';
import { Play, RotateCw } from 'lucide-react';
import { createAdminApi, sanitizeAdminError, type AdminApi } from './api/adminApi';
import { Button } from './components/ui/Button';
import { InlineAlert } from './components/ui/Feedback';
import { useToast } from './context/ToastContext';
import { useAdminRoute } from './hooks/useAdminRoute';
import { useAsyncResource } from './hooks/useAsyncResource';
import { usePageLifecycle } from './hooks/usePageLifecycle';
import { useTheme } from './hooks/useTheme';
import { AdminShell } from './layouts/AdminShell';
import { AccountsPage } from './pages/accounts/AccountsPage';
import { BackupPage } from './pages/backup/BackupPage';
import { DiagnosticsPage } from './pages/diagnostics/DiagnosticsPage';
import { PhoneGuidePage } from './pages/guide/PhoneGuidePage';
import { MetricsPage } from './pages/metrics/MetricsPage';
import { LogsPage } from './pages/logs/LogsPage';
import { OverviewPage } from './pages/overview/OverviewPage';
import { ProviderPage } from './pages/provider/ProviderPage';
import { RuntimePage } from './pages/runtime/RuntimePage';
import { SessionsPage } from './pages/sessions/SessionsPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { UpdatesPage } from './pages/updates/UpdatesPage';
import { getAdminRoute } from './routes/adminRoutes';
import type { DiagnosticsResult } from './types/admin';

type AppProps = {
  api?: AdminApi;
};

export function App({ api: injectedApi }: AppProps = {}) {
  const api = useMemo(() => injectedApi ?? createAdminApi(), [injectedApi]);
  const { navigate, route } = useAdminRoute();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();
  usePageLifecycle(api);
  const loadState = useCallback(() => api.getState(), [api]);
  const loadMetrics = useCallback(() => api.getMetrics(), [api]);
  const stateResource = useAsyncResource(loadState);
  const metricsResource = useAsyncResource(loadMetrics);
  const [bridgeCommand, setBridgeCommand] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);

  const reportError = (value: unknown) => toast.error(sanitizeAdminError(value instanceof Error ? value.message : value));

  const refreshAll = async () => {
    await Promise.all([stateResource.refresh(), metricsResource.refresh()]);
  };

  const runBridgeCommand = async () => {
    setBridgeCommand(true);
    try {
      if (stateResource.data?.bridge?.running) {
        await api.restartBridge();
        toast.success('微信桥接已重启');
      } else {
        await api.startBridge();
        toast.success('微信桥接已启动');
      }
      await stateResource.refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setBridgeCommand(false);
    }
  };

  const retryDelivery = async () => {
    setRetrying(true);
    try {
      await api.retryDeliveryOutbox();
      toast.success('待投递消息已进入重试队列');
      await metricsResource.refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setRetrying(false);
    }
  };

  const resetMetrics = async () => {
    setResetting(true);
    try {
      await api.resetMetrics();
      toast.success('用量统计已重置');
      await metricsResource.refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setResetting(false);
    }
  };

  const runDiagnostics = async () => {
    setDiagnosing(true);
    try {
      const result = await api.runDiagnostics();
      setDiagnostics(result);
      toast.success('诊断已完成');
    } catch (error) {
      reportError(error);
    } finally {
      setDiagnosing(false);
    }
  };

  let page: React.ReactNode;
  if (route === 'overview') {
    page = (
      <OverviewPage
        loading={stateResource.loading}
        metrics={metricsResource.data}
        retrying={retrying}
        state={stateResource.data}
        onRetryDelivery={() => { void retryDelivery(); }}
      />
    );
  } else if (route === 'runtime') {
    page = <RuntimePage state={stateResource.data} />;
  } else if (route === 'users') {
    page = (
      <AccountsPage
        accounts={stateResource.data?.accounts ?? []}
        api={api}
        profiles={stateResource.data?.providerProfiles ?? []}
        onChanged={() => { void stateResource.refresh(); }}
      />
    );
  } else if (route === 'metrics') {
    page = <MetricsPage metrics={metricsResource.data} resetting={resetting} onReset={() => { void resetMetrics(); }} />;
  } else if (route === 'provider') {
    page = (
      <ProviderPage
        api={api}
        state={stateResource.data ?? {}}
        onChanged={() => { void stateResource.refresh(); }}
      />
    );
  } else if (route === 'diagnostics') {
    page = <DiagnosticsPage result={diagnostics} running={diagnosing} onRun={() => { void runDiagnostics(); }} />;
  } else if (route === 'sessions') {
    page = <SessionsPage accounts={stateResource.data?.accounts ?? []} api={api} />;
  } else if (route === 'logs') {
    page = <LogsPage api={api} />;
  } else if (route === 'settings') {
    page = <SettingsPage api={api} settings={stateResource.data?.settings ?? {}} onChanged={() => { void stateResource.refresh(); }} />;
  } else if (route === 'backup') {
    page = <BackupPage api={api} onChanged={() => { void stateResource.refresh(); }} />;
  } else if (route === 'phone-guide') {
    page = <PhoneGuidePage />;
  } else if (route === 'updates') {
    page = <UpdatesPage />;
  } else {
    const definition = getAdminRoute(route);
    page = <section className="page-placeholder" aria-label={definition.label}><p>{definition.subtitle}</p></section>;
  }

  const globalError = stateResource.error ?? metricsResource.error;
  const bridgeRunning = Boolean(stateResource.data?.bridge?.running);

  return (
    <AdminShell
      route={route}
      theme={theme}
      serviceState={bridgeRunning ? 'running' : stateResource.loading ? 'starting' : 'stopped'}
      pageAction={(
        <Button
          id={bridgeRunning ? 'bridge-restart' : 'bridge-start'}
          variant="primary"
          busy={bridgeCommand}
          icon={bridgeRunning ? <RotateCw /> : <Play />}
          onClick={() => { void runBridgeCommand(); }}
        >
          {bridgeRunning ? '重启微信桥接' : '启动微信桥接'}
        </Button>
      )}
      onNavigate={navigate}
      onRefresh={() => { void refreshAll(); }}
      onToggleTheme={toggleTheme}
    >
      {globalError && (
        <div className="global-alert">
          <InlineAlert tone="error" title="无法刷新管理数据">{sanitizeAdminError(globalError.message)}</InlineAlert>
        </div>
      )}
      {page}
    </AdminShell>
  );
}
