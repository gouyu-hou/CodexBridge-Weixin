import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import { BackupPage } from './BackupPage';

function createApi() {
  return { importBackup: vi.fn(async () => ({ ok: true, imported: { accounts: 2, bridgeSessions: 3 } })) } as unknown as AdminApi;
}

describe('BackupPage', () => {
  it('exposes diagnostic and full-backup downloads with clear sensitivity labels', () => {
    render(<BackupPage api={createApi()} onChanged={vi.fn()} />);
    expect(screen.getByRole('link', { name: '导出脱敏诊断' })).toHaveAttribute('href', '/api/export/diagnostic');
    expect(screen.getByRole('link', { name: '导出完整备份' })).toHaveAttribute('href', '/api/export');
    expect(screen.getByText(/包含微信凭据与 Provider 密钥/)).toBeVisible();
  });

  it('rejects non-JSON files and confirms a valid import before mutation', async () => {
    const api = createApi();
    const onChanged = vi.fn();
    render(<BackupPage api={api} onChanged={onChanged} />);
    const input = screen.getByLabelText('选择备份 JSON 文件');

    fireEvent.change(input, { target: { files: [new File(['plain'], 'backup.txt', { type: 'text/plain' })] } });
    expect(await screen.findByText('仅支持 .json 备份文件')).toBeVisible();

    fireEvent.change(input, { target: { files: [new File(['{"version":1}'], 'backup.json', { type: 'application/json' })] } });
    await userEvent.click(screen.getByRole('button', { name: '导入备份' }));
    expect(await screen.findByRole('dialog', { name: '确认导入备份' })).toBeVisible();
    expect(api.importBackup).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认导入' }));
    await waitFor(() => expect(api.importBackup).toHaveBeenCalledWith({ version: 1 }));
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
