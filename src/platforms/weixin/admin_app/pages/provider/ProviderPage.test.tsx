import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import type { AdminState } from '../../types/admin';
import { ProviderPage } from './ProviderPage';

const state: AdminState = {
  providerProfiles: [
    { providerProfileId: 'openai-default', displayName: 'OpenAI', providerKind: 'openai', defaultModel: 'gpt-5.6' },
    { providerProfileId: 'custom', displayName: 'Custom API', providerKind: 'openai-compatible', defaultModel: 'gpt-5.5' },
  ],
  settings: {
    modelProvider: {
      profileId: 'openai-default',
      providerName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.6',
      source: 'manual',
    },
  },
};

function createApi(usage: unknown = { status: 'unsupported' }) {
  return {
    getProviderModels: vi.fn(async () => ({
      models: [{ id: 'gpt-5.6', label: 'GPT-5.6' }, { id: 'gpt-5.5', label: 'GPT-5.5' }],
    })),
    getProviderUsage: vi.fn(async () => usage),
    updateSettings: vi.fn(async () => ({ ok: true })),
    syncCcswitch: vi.fn(async () => ({ ok: true, message: '同步成功' })),
  } as unknown as AdminApi;
}

describe('ProviderPage', () => {
  it('autoloads models and only saves a catalog model', async () => {
    const api = createApi();
    const onChanged = vi.fn();
    render(<ProviderPage api={api} state={state} onChanged={onChanged} />);

    await waitFor(() => expect(api.getProviderModels).toHaveBeenCalledWith('openai-default', false));
    expect(screen.getByRole('option', { name: 'GPT-5.6' })).toBeVisible();
    expect(screen.queryByRole('textbox', { name: '模型' })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('模型'), 'gpt-5.5');
    await userEvent.click(screen.getByRole('button', { name: '保存模型设置' }));

    expect(api.updateSettings).toHaveBeenCalledWith({
      modelProvider: expect.objectContaining({
        profileId: 'openai-default',
        model: 'gpt-5.5',
        modelIds: 'gpt-5.5',
      }),
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('supports explicit model and usage refresh without losing selection', async () => {
    const api = createApi({
      status: 'available',
      report: { provider: 'OpenAI', buckets: [{ name: '请求', windows: [{ name: '5 小时', usedPercent: 25, resetAfterSeconds: 3600 }] }] },
    });
    render(<ProviderPage api={api} state={state} onChanged={vi.fn()} />);
    await screen.findByRole('option', { name: 'GPT-5.6' });

    await userEvent.click(screen.getByRole('button', { name: '刷新模型目录' }));
    await userEvent.click(screen.getByRole('button', { name: '刷新用量' }));

    expect(api.getProviderModels).toHaveBeenLastCalledWith('openai-default', true);
    expect(api.getProviderUsage).toHaveBeenLastCalledWith('openai-default', true);
    expect(screen.getByText('剩余 75%')).toBeVisible();
  });

  it('renders unsupported usage as a neutral state and can sync CCSwitch', async () => {
    const api = createApi();
    render(<ProviderPage api={api} state={state} onChanged={vi.fn()} />);

    expect(await screen.findByText('当前 Provider 暂不支持用量查询')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '从 CCSwitch 同步' }));
    expect(api.syncCcswitch).toHaveBeenCalledWith({ persistSource: true });
  });
});
