import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

afterEach(() => vi.restoreAllMocks());

describe('AppErrorBoundary', () => {
  it('renders sanitized recovery actions for an unknown render failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReload = vi.fn();
    const onDiagnostics = vi.fn();
    function Broken(): never {
      throw new Error('Bearer raw-secret render failed');
    }

    render(
      <AppErrorBoundary onReload={onReload} onDiagnostics={onDiagnostics}>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: '管理页面暂时无法显示' })).toBeVisible();
    expect(screen.getByText(/Bearer \[redacted\]/u)).toBeVisible();
    expect(screen.queryByText(/raw-secret/u)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '运行诊断' }));
    await userEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(onDiagnostics).toHaveBeenCalledOnce();
    expect(onReload).toHaveBeenCalledOnce();
  });
});
