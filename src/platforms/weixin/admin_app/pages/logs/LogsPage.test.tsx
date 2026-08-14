import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import { LogsPage } from './LogsPage';

const longLine = `[debug] ${'x'.repeat(600)}`;

function createApi(getLogs = vi.fn(async () => ({
  files: [{ label: 'bridge.log', path: 'D:/logs/bridge.log', size: 4096, lines: [] }],
  lines: [
    '[info] bridge started',
    '[warn] queue is busy',
    '[error] request failed',
    longLine,
  ],
  totalBytes: 4096,
}))) {
  return {
    getLogs,
    cleanupLogs: vi.fn(async () => ({
      ok: true,
      cleanup: { actions: ['removed old.log'] },
      logs: { lines: ['[info] bridge started'], totalBytes: 1024 },
    })),
  } as unknown as AdminApi;
}

describe('LogsPage', () => {
  it('filters retained log data and contains very long lines', async () => {
    const api = createApi();
    render(<LogsPage api={api} />);

    expect(await screen.findByText('[error] request failed')).toBeVisible();
    expect(screen.getByTestId('log-viewer')).toHaveClass('log-viewer');
    expect(screen.getByText(longLine)).toHaveClass('log-line');

    await userEvent.selectOptions(screen.getByLabelText('日志级别'), 'error');
    expect(screen.queryByText('[warn] queue is busy')).not.toBeInTheDocument();
    expect(screen.getByText('[error] request failed')).toBeVisible();

    await userEvent.selectOptions(screen.getByLabelText('日志级别'), 'all');
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索日志' }), 'queue');
    expect(screen.getByText('[warn] queue is busy')).toBeVisible();
    expect(screen.queryByText('[info] bridge started')).not.toBeInTheDocument();
  });

  it('refreshes without clearing old lines and confirms cleanup', async () => {
    let resolveRefresh: ((value: { lines: string[]; totalBytes: number }) => void) | undefined;
    const getLogs = vi.fn()
      .mockResolvedValueOnce({ lines: ['[info] retained'], totalBytes: 32 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRefresh = resolve; }));
    const api = createApi(getLogs);
    render(<LogsPage api={api} />);

    expect(await screen.findByText('[info] retained')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '刷新日志' }));
    expect(screen.getByText('[info] retained')).toBeVisible();
    resolveRefresh?.({ lines: ['[info] refreshed'], totalBytes: 40 });
    expect(await screen.findByText('[info] refreshed')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: '清理日志' }));
    expect(screen.getByRole('dialog', { name: '清理日志' })).toBeVisible();
    expect(api.cleanupLogs).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认清理' }));
    await waitFor(() => expect(api.cleanupLogs).toHaveBeenCalledOnce());
    expect(await screen.findByText('[info] bridge started')).toBeVisible();
  });
});
