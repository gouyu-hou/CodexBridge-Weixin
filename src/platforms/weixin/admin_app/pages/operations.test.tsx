import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DiagnosticsPage } from './diagnostics/DiagnosticsPage';
import { MetricsPage } from './metrics/MetricsPage';
import { OverviewPage } from './overview/OverviewPage';
import { RuntimePage } from './runtime/RuntimePage';
import type { AdminMetrics, AdminState, DiagnosticsResult } from '../types/admin';

const state: AdminState = {
  accounts: [
    { accountId: 'wx-1', displayName: '主账号', enabled: true, primary: true, role: 'owner' },
  ],
  bridge: { activeTurns: 2, maxConcurrentTurns: 8, running: true, startedAt: '2026-08-14T10:00:00Z' },
  logs: { totalBytes: 2048 },
  stateDir: 'D:/CodexBridgeData',
};

const metrics: AdminMetrics = {
  deliveriesFailed: 1,
  deliveriesSucceeded: 19,
  errorsRecentHour: 2,
  messagesReceived: 128,
  pendingDeliveryRetries: 1,
  turnsCompleted: 80,
  turnsFailed: 3,
};

describe('operational pages', () => {
  it('renders the overview hierarchy and retries pending delivery', async () => {
    const onRetryDelivery = vi.fn();
    render(
      <OverviewPage
        loading={false}
        metrics={metrics}
        retrying={false}
        state={state}
        onRetryDelivery={onRetryDelivery}
      />,
    );

    expect(screen.getByText('128')).toBeVisible();
    expect(screen.getByText('主账号')).toBeVisible();
    expect(document.getElementById('accounts-body')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '重试待投递消息' }));
    expect(onRetryDelivery).toHaveBeenCalledOnce();
  });

  it('requires confirmation before resetting metrics', async () => {
    const onReset = vi.fn();
    render(<MetricsPage metrics={metrics} resetting={false} onReset={onReset} />);

    await userEvent.click(screen.getByRole('button', { name: '重置统计' }));
    expect(screen.getByRole('dialog', { name: '重置用量统计' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '确认重置' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('renders runtime compatibility markers and service facts', () => {
    render(<RuntimePage state={state} />);
    expect(document.getElementById('metric-turns')).toHaveTextContent('2 / 8');
    expect(document.getElementById('status-updated')).toBeInTheDocument();
    expect(screen.getByText('D:/CodexBridgeData')).toBeVisible();
  });

  it('runs diagnostics and renders status plus details', async () => {
    const result: DiagnosticsResult = {
      summary: { status: 'warn', ok: 3, warned: 1, failed: 0, text: '存在一项提醒' },
      checks: [{ id: 'provider', title: '模型连接', status: 'warn', detail: '需要重新验证' }],
    };
    const onRun = vi.fn();
    render(<DiagnosticsPage result={result} running={false} onRun={onRun} />);

    expect(screen.getByText('存在一项提醒')).toBeVisible();
    expect(screen.getByText('模型连接')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '运行诊断' }));
    expect(onRun).toHaveBeenCalledOnce();
  });
});
