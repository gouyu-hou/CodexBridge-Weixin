import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import { SetupWizard } from './SetupWizard';

function createApi() {
  return {
    testSetup: vi.fn(async () => ({
      check: { status: 'ok' },
      message: '连接正常',
    })),
    completeSetup: vi.fn(async () => ({ ok: true })),
  } as unknown as AdminApi;
}

describe('SetupWizard', () => {
  it('renders setup checks and runs each connectivity test', async () => {
    const api = createApi();
    render(
      <SetupWizard
        api={api}
        open
        setup={{
          checks: {
            codex: { detail: 'codex 1.2.3', label: '可用', ok: true },
            dataDir: { detail: 'D:/BridgeData', label: '已创建', ok: true },
            modelProvider: { detail: 'OpenAI', label: '已配置', ok: true },
            node: { detail: 'Node 22', label: '可用', ok: true },
            serviceEnvFile: { detail: '.env', label: '已加载', ok: true },
            weixinAccount: { detail: '未绑定', label: '待处理', ok: false },
          },
          needsSetup: true,
        }}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        onOpenPairing={vi.fn()}
        onOpenProvider={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '首次配置向导' })).toBeVisible();
    expect(screen.getByText('D:/BridgeData')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '测试 API 密钥' }));

    await waitFor(() => expect(api.testSetup).toHaveBeenCalledWith({ target: 'api-key' }));
    expect(screen.getByText('连接正常')).toBeVisible();
  });

  it('opens provider and pairing flows, then completes or skips setup', async () => {
    const api = createApi();
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const onOpenPairing = vi.fn();
    const onOpenProvider = vi.fn();
    render(
      <SetupWizard
        api={api}
        open
        setup={{ needsSetup: true }}
        onClose={onClose}
        onComplete={onComplete}
        onOpenPairing={onOpenPairing}
        onOpenProvider={onOpenProvider}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '前往模型配置' }));
    expect(onOpenProvider).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '绑定微信账号' }));
    expect(onOpenPairing).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await userEvent.click(screen.getByRole('button', { name: '完成配置' }));
    await waitFor(() => expect(api.completeSetup).toHaveBeenCalledWith({ skipped: false }));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
