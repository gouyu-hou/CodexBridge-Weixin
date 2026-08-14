import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DesktopUpdateStatus, LightweightUpdateStatus, LightweightUpdaterBridge } from '../../types/electron';
import { UpdatesPage } from './UpdatesPage';

function createUpdater() {
  return {
    getStatus: vi.fn(async (): Promise<DesktopUpdateStatus> => ({
      supported: true,
      packaged: true,
      currentVersion: '0.1.8',
      latestVersion: '0.1.9',
      available: true,
      canCheck: true,
      canDownload: true,
      canInstall: false,
      releaseNotes: '修复微信连接稳定性',
    })),
    check: vi.fn(async () => ({ currentVersion: '0.1.8', latestVersion: '0.1.9', available: true, canDownload: true })),
    download: vi.fn(async () => ({ currentVersion: '0.1.8', latestVersion: '0.1.9', downloaded: true, canInstall: true, progress: { percent: 100 } })),
    install: vi.fn(async () => ({ ok: true })),
    onStatus: vi.fn(() => vi.fn()),
  };
}

function createLightweightUpdater(): LightweightUpdaterBridge {
  return {
    getStatus: vi.fn(async (): Promise<LightweightUpdateStatus> => ({
      supported: true,
      usingLightweight: true,
      builtInVersion: '0.1.8',
      currentVersion: '0.1.8-hotfix.2',
      currentRoot: 'C:/runtime/current',
      canCheck: true,
      canDownloadInstall: true,
      canRollback: true,
      history: [
        { id: '1', action: 'verify', result: 'success', version: '0.1.8-hotfix.2', keyId: 'release-2026', timestamp: '2026-08-14T10:00:00Z' },
        { id: '2', action: 'install', result: 'success', version: '0.1.8-hotfix.2', source: 'automatic', timestamp: '2026-08-14T10:00:02Z' },
      ],
    })),
    check: vi.fn(async () => ({ available: true, latestVersion: '0.1.8-hotfix.3', canDownloadInstall: true })),
    downloadInstall: vi.fn(async () => ({ currentVersion: '0.1.8-hotfix.3', usingLightweight: true, canRollback: true })),
    installLocal: vi.fn(async () => ({ currentVersion: '0.1.8-local', usingLightweight: true, canRollback: true })),
    pickLocal: vi.fn(async () => ({ canceled: false, path: 'C:/updates/hotfix.zip' })),
    rollback: vi.fn(async () => ({ currentVersion: null, usingLightweight: false, canRollback: false })),
  };
}

describe('UpdatesPage', () => {
  it('loads both update channels, displays history, and enables install after download', async () => {
    const updater = createUpdater();
    const lightweightUpdater = createLightweightUpdater();
    render(<UpdatesPage updater={updater} lightweightUpdater={lightweightUpdater} />);

    expect(await screen.findByText('0.1.9')).toBeVisible();
    expect(screen.getByText('release-2026')).toBeVisible();
    expect(screen.getByText('验签')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: '下载更新' }));
    await waitFor(() => expect(updater.download).toHaveBeenCalledOnce());
    await userEvent.click(screen.getByRole('button', { name: '重启安装' }));
    expect(screen.getByRole('dialog', { name: '安装新版本' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '确认重启安装' }));
    await waitFor(() => expect(updater.install).toHaveBeenCalledOnce());
  });

  it('installs a selected lightweight package and confirms rollback', async () => {
    const lightweightUpdater = createLightweightUpdater();
    render(<UpdatesPage updater={createUpdater()} lightweightUpdater={lightweightUpdater} />);

    expect(await screen.findAllByText('0.1.8-hotfix.2')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: '选择轻量更新包' }));
    expect(screen.getByDisplayValue('C:/updates/hotfix.zip')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '安装本地轻量包' }));
    await waitFor(() => expect(lightweightUpdater.installLocal).toHaveBeenCalledWith({ path: 'C:/updates/hotfix.zip' }));

    await userEvent.click(screen.getByRole('button', { name: '回退到内置版本' }));
    expect(screen.getByRole('dialog', { name: '回退轻量更新' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: '确认回退' }));
    await waitFor(() => expect(lightweightUpdater.rollback).toHaveBeenCalledOnce());
  });
});
