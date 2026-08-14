import { type ReactNode, useState } from 'react';
import {
  Heart,
  Menu,
  Moon,
  RefreshCw,
  Settings2,
  Sun,
  X,
} from 'lucide-react';
import type { AdminTheme } from '../hooks/useTheme';
import {
  ADMIN_ROUTE_GROUPS,
  ADMIN_ROUTES,
  getAdminRoute,
  type AdminRouteId,
} from '../routes/adminRoutes';

type ServiceState = 'running' | 'stopped' | 'starting' | 'error' | 'unknown';

type AdminShellProps = {
  children: ReactNode;
  onNavigate: (route: AdminRouteId) => void;
  onOpenSetup: () => void;
  onOpenSupport: () => void;
  onRefresh: () => void;
  onToggleTheme: () => void;
  pageAction?: ReactNode;
  route: AdminRouteId;
  serviceState?: ServiceState;
  theme: AdminTheme;
};

const serviceLabels: Record<ServiceState, string> = {
  error: '异常',
  running: '运行中',
  starting: '启动中',
  stopped: '已停止',
  unknown: '状态未知',
};

export function AdminShell({
  children,
  onNavigate,
  onOpenSetup,
  onOpenSupport,
  onRefresh,
  onToggleTheme,
  pageAction,
  route,
  serviceState = 'unknown',
  theme,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const currentRoute = getAdminRoute(route);

  const navigate = (nextRoute: AdminRouteId) => {
    setDrawerOpen(false);
    onNavigate(nextRoute);
  };

  return (
    <div className="admin-shell">
      <aside
        className="admin-sidebar"
        data-open={String(drawerOpen)}
        data-testid="admin-sidebar"
      >
        <div className="admin-brand">
          <img src="/favicon.png" alt="" />
          <div>
            <strong>CodexBridge</strong>
            <span>Weixin Admin</span>
          </div>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="关闭导航"
            title="关闭导航"
            onClick={() => setDrawerOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>

        <nav className="admin-navigation" aria-label="管理页面">
          {ADMIN_ROUTE_GROUPS.map((group) => (
            <div className="navigation-group" key={group.id}>
              <div className="navigation-label">{group.label}</div>
              {ADMIN_ROUTES.filter((entry) => entry.group === group.id).map((entry) => {
                const Icon = entry.icon;
                const active = entry.id === route;
                return (
                  <a
                    className="navigation-link"
                    data-active={String(active)}
                    href={`#${entry.id}`}
                    key={entry.id}
                    aria-current={active ? 'page' : undefined}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(entry.id);
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>{entry.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <button className="support-button support-button--compact setup-sidebar-button" type="button" onClick={onOpenSetup}>
          <Settings2 aria-hidden="true" />
          <span>配置向导</span>
        </button>
        <button className="support-button support-button--compact" type="button" onClick={onOpenSupport}>
          <Heart aria-hidden="true" />
          <span>支持项目</span>
        </button>
      </aside>

      {drawerOpen && (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="关闭导航"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div className="admin-workspace">
        <header className="admin-header">
          <button
            className="icon-button mobile-menu"
            type="button"
            aria-label="打开导航"
            title="打开导航"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <div className="page-heading">
            <h1>{currentRoute.label}</h1>
            <p>{currentRoute.subtitle}</p>
          </div>
          <div className="header-actions">
            <span className="service-badge" data-state={serviceState} id="service-state">{serviceLabels[serviceState]}</span>
            {pageAction}
            <button
              className="icon-button setup-header-button"
              type="button"
              aria-label="打开配置向导"
              title="打开配置向导"
              onClick={onOpenSetup}
            >
              <Settings2 aria-hidden="true" />
            </button>
            <button
              className="icon-button"
              type="button"
              aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
              title={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
              onClick={onToggleTheme}
            >
              {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
            </button>
            <button
              className="icon-button"
              id="refresh-btn"
              type="button"
              aria-label="刷新当前页面"
              title="刷新当前页面"
              onClick={onRefresh}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </div>
        </header>
        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
