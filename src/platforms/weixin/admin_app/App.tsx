import { useAdminRoute } from './hooks/useAdminRoute';
import { useTheme } from './hooks/useTheme';
import { AdminShell } from './layouts/AdminShell';
import { getAdminRoute } from './routes/adminRoutes';

export function App() {
  const { navigate, route } = useAdminRoute();
  const { theme, toggleTheme } = useTheme();
  const routeDefinition = getAdminRoute(route);

  return (
    <AdminShell
      route={route}
      theme={theme}
      onNavigate={navigate}
      onRefresh={() => window.dispatchEvent(new CustomEvent('admin:refresh', { detail: route }))}
      onToggleTheme={toggleTheme}
    >
      <section className="page-placeholder" aria-label={routeDefinition.label}>
        <p>{routeDefinition.subtitle}</p>
      </section>
    </AdminShell>
  );
}
