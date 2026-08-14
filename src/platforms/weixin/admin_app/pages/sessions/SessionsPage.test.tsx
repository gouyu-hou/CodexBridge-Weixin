import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AdminApi } from '../../api/adminApi';
import type { AdminAccount, AdminSession } from '../../types/admin';
import { SessionsPage } from './SessionsPage';

const accounts: AdminAccount[] = [
  { accountId: 'wx-owner', displayName: '主账号', primary: true },
  { accountId: 'wx-friend', displayName: '朋友', primary: false },
];

const sessions: AdminSession[] = Array.from({ length: 12 }, (_, index) => ({
  id: `session-${index + 1}`,
  accountIds: [index % 2 === 0 ? 'wx-owner' : 'wx-friend'],
  archived: index === 1,
  codexThreadId: `thread-${String(index + 1).padStart(3, '0')}-very-long-identifier`,
  cwd: `D:/projects/project-${index + 1}`,
  model: 'gpt-5.6',
  preview: `最近问题 ${index + 1}`,
  title: `会话 ${index + 1}`,
  updatedAt: `2026-08-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
}));

function createApi() {
  return {
    getSessions: vi.fn(async () => ({ sessions, total: sessions.length, returned: sessions.length })),
    getSessionHistory: vi.fn(async () => ({
      sessionPath: 'C:/Users/test/.codex/sessions/thread.jsonl',
      total: 2,
      messages: [
        { role: 'user', text: '请检查发布流程', timestamp: '2026-08-14T10:00:00.000Z' },
        { role: 'assistant', text: '发布验证已通过', timestamp: '2026-08-14T10:00:02.000Z' },
      ],
    })),
    updateSession: vi.fn(async () => ({ ok: true })),
    deleteSession: vi.fn(async () => ({ ok: true })),
  } as unknown as AdminApi;
}

describe('SessionsPage', () => {
  it('filters sessions through the API and paginates stable rows', async () => {
    const api = createApi();
    render(<SessionsPage accounts={accounts} api={api} />);

    expect(await screen.findByText('会话 1')).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(11);
    await userEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('会话 11')).toBeVisible();

    await userEvent.type(screen.getByRole('searchbox', { name: '搜索会话' }), '发布');
    await userEvent.selectOptions(screen.getByLabelText('微信账号'), 'wx-friend');
    await userEvent.selectOptions(screen.getByLabelText('排序'), 'updatedAsc');
    await userEvent.click(screen.getByRole('button', { name: '筛选' }));

    await waitFor(() => expect(api.getSessions).toHaveBeenLastCalledWith({
      accountId: 'wx-friend',
      query: '发布',
      sort: 'updatedAsc',
    }));
  });

  it('opens searchable history and keeps full thread ids accessible', async () => {
    const api = createApi();
    render(<SessionsPage accounts={accounts} api={api} />);

    await screen.findByText('会话 1');
    const firstRow = screen.getByText('会话 1').closest('tr');
    expect(firstRow).not.toBeNull();
    expect(within(firstRow!).getByText('thread-001-very-long-identifier')).toHaveAttribute(
      'title',
      'thread-001-very-long-identifier',
    );
    await userEvent.click(within(firstRow!).getByRole('button', { name: '查看会话 1 的历史' }));

    expect(await screen.findByRole('dialog', { name: '会话历史' })).toBeVisible();
    expect(screen.getByText('请检查发布流程')).toBeVisible();
    await userEvent.type(screen.getByRole('searchbox', { name: '搜索历史消息' }), '发布');
    await userEvent.click(screen.getByRole('button', { name: '搜索历史' }));
    await waitFor(() => expect(api.getSessionHistory).toHaveBeenLastCalledWith('session-1', '发布'));
  });

  it('archives directly and requires confirmation before deletion', async () => {
    const api = createApi();
    render(<SessionsPage accounts={accounts} api={api} />);

    await screen.findByText('会话 1');
    await userEvent.click(screen.getByRole('button', { name: '归档会话 1' }));
    await waitFor(() => expect(api.updateSession).toHaveBeenCalledWith('session-1', { archived: true }));

    await userEvent.click(screen.getByRole('button', { name: '删除会话 1' }));
    expect(screen.getByRole('dialog', { name: '删除会话' })).toBeVisible();
    expect(api.deleteSession).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith('session-1'));
  });
});
