import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminShell } from './AdminShell';

function renderShell() {
  const onNavigate = vi.fn();
  render(
    <AdminShell
      route="provider"
      theme="light"
      serviceState="running"
      onNavigate={onNavigate}
      onRefresh={vi.fn()}
      onToggleTheme={vi.fn()}
    >
      <div>页面内容</div>
    </AdminShell>,
  );
  return { onNavigate };
}

describe('AdminShell', () => {
  it('renders grouped navigation and marks the active route', () => {
    renderShell();

    expect(screen.getByRole('navigation', { name: '管理页面' })).toBeVisible();
    expect(screen.getByText('工作区')).toBeVisible();
    expect(screen.getByText('配置')).toBeVisible();
    expect(screen.getByText('维护')).toBeVisible();
    expect(screen.getByRole('link', { name: '模型与供应商' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { name: '模型与供应商' })).toBeVisible();
    expect(screen.getByText('页面内容')).toBeVisible();
    expect(screen.getByRole('button', { name: '支持项目' })).toHaveClass('support-button--compact');
  });

  it('opens the mobile drawer and navigates without queueing UI state', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderShell();

    await user.click(screen.getByRole('button', { name: '打开导航' }));
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-open', 'true');

    await user.click(screen.getByRole('link', { name: '会话管理' }));
    expect(onNavigate).toHaveBeenCalledWith('sessions');
    expect(screen.getByTestId('admin-sidebar')).toHaveAttribute('data-open', 'false');
  });

  it('exposes named theme and refresh icon controls', () => {
    renderShell();
    expect(screen.getByRole('button', { name: '切换到暗色主题' })).toBeVisible();
    expect(screen.getByRole('button', { name: '刷新当前页面' })).toBeVisible();
    expect(screen.getByText('运行中')).toBeVisible();
  });
});
