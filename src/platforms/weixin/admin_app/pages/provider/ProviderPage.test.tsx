import { render, screen, waitFor, within } from '@testing-library/react';
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
  it('restores the built-in provider presets and prefills a selected provider', async () => {
    const api = createApi();
    render(<ProviderPage api={api} state={state} onChanged={vi.fn()} />);

    const preset = screen.getByLabelText('供应商预设');
    expect(within(preset).getByRole('option', { name: 'OpenAI' })).toBeVisible();
    expect(within(preset).getByRole('option', { name: 'DeepSeek' })).toBeVisible();
    expect(within(preset).getByRole('option', { name: 'Qwen' })).toBeVisible();
    expect(within(preset).getByRole('option', { name: 'OpenRouter' })).toBeVisible();
    expect(within(preset).getByRole('option', { name: '自定义' })).toBeVisible();

    await userEvent.selectOptions(preset, 'deepseek');

    expect(screen.getByLabelText('供应商名称')).toHaveValue('DeepSeek');
    expect(screen.getByLabelText('Profile ID')).toHaveValue('deepseek');
    expect(screen.getByLabelText('接口地址 Base URL')).toHaveValue('https://api.deepseek.com/v1');
    expect(screen.getByRole('option', { name: 'deepseek-chat' })).toBeVisible();
  });

  it('saves a preset provider while leaving a blank API key unchanged', async () => {
    const api = createApi();
    const onChanged = vi.fn();
    render(<ProviderPage api={api} state={state} onChanged={onChanged} />);

    await userEvent.selectOptions(screen.getByLabelText('供应商预设'), 'deepseek');
    await userEvent.selectOptions(screen.getByLabelText('默认模型'), 'deepseek-chat');
    await userEvent.click(screen.getByRole('button', { name: '保存 Provider 配置' }));

    expect(api.updateSettings).toHaveBeenCalledWith({
      modelProvider: expect.objectContaining({
        profileId: 'deepseek',
        providerId: 'deepseek',
        providerName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        modelIds: 'deepseek-chat',
        capabilities: 'deepseek',
        source: 'manual',
      }),
    });
    expect(api.updateSettings).not.toHaveBeenCalledWith({
      modelProvider: expect.objectContaining({ apiKey: expect.anything() }),
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('allows a custom provider and bootstrap model to be configured', async () => {
    const api = createApi();
    render(<ProviderPage api={api} state={state} onChanged={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText('供应商预设'), 'custom');
    await userEvent.clear(screen.getByLabelText('供应商名称'));
    await userEvent.type(screen.getByLabelText('供应商名称'), 'My Gateway');
    await userEvent.clear(screen.getByLabelText('Profile ID'));
    await userEvent.type(screen.getByLabelText('Profile ID'), 'my-gateway');
    await userEvent.clear(screen.getByLabelText('接口地址 Base URL'));
    await userEvent.type(screen.getByLabelText('接口地址 Base URL'), 'https://gateway.example.com/v1');
    await userEvent.type(screen.getByLabelText('模型 ID'), 'my-model');
    await userEvent.type(screen.getByLabelText('API Key'), 'secret-key');
    await userEvent.click(screen.getByRole('button', { name: '保存 Provider 配置' }));

    expect(api.updateSettings).toHaveBeenCalledWith({
      modelProvider: expect.objectContaining({
        profileId: 'my-gateway',
        providerId: 'openai-compatible',
        providerName: 'My Gateway',
        baseUrl: 'https://gateway.example.com/v1',
        model: 'my-model',
        modelIds: 'my-model',
        capabilities: 'default',
        apiKey: 'secret-key',
      }),
    });
  });

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
