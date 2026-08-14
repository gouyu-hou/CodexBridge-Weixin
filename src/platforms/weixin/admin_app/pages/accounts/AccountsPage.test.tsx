import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import type { AdminAccount, ProviderProfile } from '../../types/admin';
import { AccountsPage } from './AccountsPage';

const profiles: ProviderProfile[] = [
  { id: 'openai-default', label: 'OpenAI', provider: 'openai' },
  { id: 'custom', label: 'Custom', provider: 'openai-compatible' },
];

const accounts: AdminAccount[] = [
  {
    accountId: 'wx-owner',
    displayName: '我的账号',
    primary: true,
    role: 'owner',
    permissions: { canChat: true, canUpload: true, canExecuteCommands: true },
    modelProvider: { providerProfileId: 'openai-default', model: 'gpt-5.6', reasoningEffort: 'high' },
  },
  {
    accountId: 'wx-friend',
    displayName: '朋友',
    primary: false,
    role: 'member',
    permissions: { canChat: true, canUpload: false, canExecuteCommands: false },
    modelProvider: { providerProfileId: 'openai-default', model: 'gpt-5.6', reasoningEffort: 'medium' },
  },
];

function createApi() {
  return {
    getProviderModels: vi.fn(async () => ({
      models: [
        { id: 'gpt-5.6', label: 'GPT-5.6', reasoningEfforts: ['medium', 'high'] },
        { id: 'gpt-5.5', label: 'GPT-5.5', reasoningEfforts: ['low', 'medium', 'high'] },
      ],
    })),
    updateAccount: vi.fn(async () => ({ ok: true })),
    deleteAccount: vi.fn(async () => ({ ok: true })),
    setPrimaryAccount: vi.fn(async () => ({ ok: true })),
    startPairing: vi.fn(async () => ({ pairing: { status: 'waiting', qrImageDataUrl: 'data:image/png;base64,qr' } })),
    getPairing: vi.fn(async () => ({ pairing: { status: 'confirmed', accountId: 'wx-new' } })),
    cancelPairing: vi.fn(async () => ({ pairing: { status: 'cancelled' } })),
  } as unknown as AdminApi;
}

afterEach(() => vi.useRealTimers());

describe('AccountsPage', () => {
  it('protects the primary account and opens a catalog-backed editor', async () => {
    const api = createApi();
    render(<AccountsPage accounts={accounts} api={api} profiles={profiles} onChanged={vi.fn()} />);

    expect(screen.getByText('我的账号')).toBeVisible();
    expect(screen.queryByRole('button', { name: '删除我的账号' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '编辑朋友' }));
    expect(screen.getByRole('dialog', { name: '编辑账号' })).toBeVisible();
    await waitFor(() => expect(api.getProviderModels).toHaveBeenCalledWith('openai-default', false));
    expect(screen.getByRole('option', { name: 'GPT-5.6' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '模型' })).not.toBeInTheDocument();
  });

  it('saves nested permissions and validated model fields', async () => {
    const api = createApi();
    const onChanged = vi.fn();
    render(<AccountsPage accounts={accounts} api={api} profiles={profiles} onChanged={onChanged} />);

    await userEvent.click(screen.getByRole('button', { name: '编辑朋友' }));
    await screen.findByRole('option', { name: 'GPT-5.5' });
    await userEvent.click(screen.getByRole('switch', { name: '允许上传文件' }));
    await userEvent.selectOptions(screen.getByLabelText('模型'), 'gpt-5.5');
    await userEvent.click(screen.getByRole('button', { name: '保存账号' }));

    expect(api.updateAccount).toHaveBeenCalledWith('wx-friend', expect.objectContaining({
      permissions: { canChat: true, canUpload: true, canExecuteCommands: false },
      modelProvider: expect.objectContaining({ model: 'gpt-5.5', providerProfileId: 'openai-default' }),
    }));
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('polls pairing and stops after confirmation', async () => {
    vi.useFakeTimers();
    const api = createApi();
    render(<AccountsPage accounts={accounts} api={api} profiles={profiles} onChanged={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '添加微信账号' }));
    fireEvent.click(screen.getByRole('button', { name: '生成二维码' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByAltText('微信配对二维码')).toHaveAttribute('src', 'data:image/png;base64,qr');

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(api.getPairing).toHaveBeenCalledOnce();
    expect(screen.getByText('配对成功')).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    expect(api.getPairing).toHaveBeenCalledOnce();
  });
});
