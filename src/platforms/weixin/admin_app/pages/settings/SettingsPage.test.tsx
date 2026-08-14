import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import type { AdminSettings } from '../../types/admin';
import { SettingsPage } from './SettingsPage';

const settings: AdminSettings = {
  alertWebhookUrl: 'https://alerts.example.test/hook',
  concurrency: {
    maxConcurrentTurns: 3,
    eventDispatchConcurrency: 12,
    attachmentProcessingConcurrency: 3,
    accountPollConcurrency: 4,
  },
  logCleanup: { enabled: true, retentionDays: 7, maxBytes: 10 * 1024 * 1024, intervalMinutes: 60 },
};

function createApi() {
  return {
    updateSettings: vi.fn(async () => ({ ok: true })),
    testAlert: vi.fn(async () => ({ ok: true, configured: true })),
  } as unknown as AdminApi;
}

describe('SettingsPage', () => {
  it('tracks dirty fields and saves the complete validated payload', async () => {
    const api = createApi();
    const onChanged = vi.fn();
    render(<SettingsPage api={api} settings={settings} onChanged={onChanged} />);

    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
    const turns = screen.getByRole('spinbutton', { name: '最大同时回复数' });
    await userEvent.clear(turns);
    await userEvent.type(turns, '8');
    expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));

    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith({
      alertWebhookUrl: 'https://alerts.example.test/hook',
      concurrency: {
        maxConcurrentTurns: 8,
        eventDispatchConcurrency: 12,
        attachmentProcessingConcurrency: 3,
        accountPollConcurrency: 4,
      },
      logCleanup: { enabled: true, retentionDays: 7, maxBytes: 10 * 1024 * 1024, intervalMinutes: 60 },
    }));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('blocks invalid numbers and tests the current webhook value', async () => {
    const api = createApi();
    render(<SettingsPage api={api} settings={settings} onChanged={vi.fn()} />);

    const turns = screen.getByRole('spinbutton', { name: '最大同时回复数' });
    await userEvent.clear(turns);
    await userEvent.type(turns, '0');
    await userEvent.click(screen.getByRole('button', { name: '保存配置' }));
    expect(await screen.findByText('请输入 1 到 64 之间的整数')).toBeVisible();
    expect(api.updateSettings).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '测试 Webhook' }));
    await waitFor(() => expect(api.testAlert).toHaveBeenCalledWith({ url: 'https://alerts.example.test/hook' }));
  });
});
