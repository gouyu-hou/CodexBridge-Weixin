import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ArchiveRestore,
  BookOpen,
  Bot,
  ChartNoAxesCombined,
  CircleGauge,
  FileClock,
  LayoutDashboard,
  Logs,
  Settings2,
  Users,
  Wrench,
} from 'lucide-react';

export type AdminRouteId =
  | 'overview'
  | 'users'
  | 'runtime'
  | 'diagnostics'
  | 'metrics'
  | 'settings'
  | 'updates'
  | 'provider'
  | 'phone-guide'
  | 'sessions'
  | 'logs'
  | 'backup';

export type AdminRouteGroup = 'workspace' | 'configuration' | 'maintenance';

export type AdminRoute = {
  group: AdminRouteGroup;
  icon: LucideIcon;
  id: AdminRouteId;
  label: string;
  subtitle: string;
};

export const ADMIN_ROUTE_GROUPS: ReadonlyArray<{
  id: AdminRouteGroup;
  label: string;
}> = [
  { id: 'workspace', label: '工作区' },
  { id: 'configuration', label: '配置' },
  { id: 'maintenance', label: '维护' },
];

export const ADMIN_ROUTES: readonly AdminRoute[] = [
  { id: 'overview', group: 'workspace', icon: LayoutDashboard, label: '概览', subtitle: '微信桥接服务和消息处理概况' },
  { id: 'users', group: 'workspace', icon: Users, label: '微信账号', subtitle: '管理已接入账号、权限和配对' },
  { id: 'sessions', group: 'workspace', icon: FileClock, label: '会话管理', subtitle: '查看和维护 Codex 会话' },
  { id: 'provider', group: 'configuration', icon: Bot, label: '模型与供应商', subtitle: '配置 Provider、模型目录和用量' },
  { id: 'settings', group: 'configuration', icon: Settings2, label: '运行配置', subtitle: '调整桥接服务的运行参数' },
  { id: 'metrics', group: 'configuration', icon: ChartNoAxesCombined, label: '用量统计', subtitle: '查看消息、回合和投递指标' },
  { id: 'runtime', group: 'maintenance', icon: CircleGauge, label: '运行状态', subtitle: '检查当前进程和并发状态' },
  { id: 'diagnostics', group: 'maintenance', icon: Wrench, label: '诊断修复', subtitle: '运行诊断并处理可恢复问题' },
  { id: 'logs', group: 'maintenance', icon: Logs, label: '运行日志', subtitle: '筛选和清理本地运行日志' },
  { id: 'updates', group: 'maintenance', icon: Activity, label: '软件更新', subtitle: '检查版本、安装进度和历史' },
  { id: 'backup', group: 'maintenance', icon: ArchiveRestore, label: '备份恢复', subtitle: '导出或恢复管理数据' },
  { id: 'phone-guide', group: 'maintenance', icon: BookOpen, label: '手机使用指南', subtitle: '查看手机端接入步骤' },
] as const;

const routeIds = new Set<AdminRouteId>(ADMIN_ROUTES.map((route) => route.id));

export function parseAdminRoute(hash: string): AdminRouteId {
  const value = hash.trim().replace(/^#/, '');
  return routeIds.has(value as AdminRouteId) ? value as AdminRouteId : 'overview';
}

export function getAdminRoute(route: string): AdminRoute {
  const id = parseAdminRoute(route);
  return ADMIN_ROUTES.find((entry) => entry.id === id) ?? ADMIN_ROUTES[0];
}
