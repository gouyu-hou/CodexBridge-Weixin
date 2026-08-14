import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { AdminApi } from './api/adminApi';
import { ToastProvider } from './context/ToastContext';

describe('App operational wiring', () => {
  it('loads shared state, runs bridge commands, and switches real pages', async () => {
    const api = {
      getState: vi.fn(async () => ({
        accounts: [],
        bridge: { activeTurns: 1, maxConcurrentTurns: 4, running: true },
        stateDir: 'D:/BridgeData',
      })),
      getMetrics: vi.fn(async () => ({ messagesReceived: 12, turnsCompleted: 8 })),
      heartbeat: vi.fn(async () => ({ ok: true })),
      closePage: vi.fn(async () => ({ ok: true })),
      shutdownService: vi.fn(async () => ({ ok: true })),
      restartBridge: vi.fn(async () => ({ ok: true })),
      retryDeliveryOutbox: vi.fn(async () => ({ ok: true })),
      resetMetrics: vi.fn(async () => ({ ok: true })),
      runDiagnostics: vi.fn(async () => ({ summary: { status: 'ok', text: '正常' }, checks: [] })),
    } as unknown as AdminApi;

    render(<ToastProvider><App api={api} /></ToastProvider>);

    await waitFor(() => expect(screen.getByText('12')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: '重启微信桥接' }));
    expect(api.restartBridge).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('link', { name: '运行状态' }));
    expect(screen.getByRole('heading', { name: '运行状态' })).toBeVisible();
    expect(screen.getByText('D:/BridgeData')).toBeVisible();
  });
});
