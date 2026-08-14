import { createRef, useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RefreshCw } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { DataTable } from './DataTable';
import { Dialog } from './Dialog';
import { InlineAlert } from './Feedback';
import { SelectField, Switch, TextField } from './Fields';
import { IconButton } from './IconButton';
import { Panel } from './Panel';
import { ProgressBar } from './ProgressBar';
import { StatusBadge } from './StatusBadge';

describe('admin UI primitives', () => {
  it('protects busy commands from duplicate clicks', async () => {
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>保存</Button>);
    const button = screen.getByRole('button', { name: '保存' });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('gives icon-only controls an accessible name and tooltip', () => {
    render(<IconButton label="刷新模型"><RefreshCw /></IconButton>);
    const button = screen.getByRole('button', { name: '刷新模型' });
    expect(button).toHaveAttribute('title', '刷新模型');
  });

  it('renders panel hierarchy and status text without relying on color alone', () => {
    render(
      <Panel title="服务状态" subtitle="最近一次检查">
        <StatusBadge tone="success">运行中</StatusBadge>
      </Panel>,
    );
    expect(screen.getByRole('heading', { name: '服务状态' })).toBeVisible();
    expect(screen.getByText('最近一次检查')).toBeVisible();
    expect(screen.getByText('运行中').closest('.status-badge')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByTestId('status-icon')).toBeVisible();
  });

  it('keeps tables stable while loading and presents an explicit empty state', () => {
    const columns = [{ key: 'name', header: '名称' }] as const;
    const { rerender } = render(
      <DataTable<{ name: string }> columns={columns} rows={[]} rowKey={(row) => row.name} loading />,
    );
    expect(screen.getAllByTestId('table-skeleton-row')).toHaveLength(3);

    rerender(
      <DataTable<{ name: string }> columns={columns} rows={[]} rowKey={(row) => row.name} emptyText="暂无账号" />,
    );
    expect(screen.getByText('暂无账号')).toBeVisible();
  });

  it('connects fields, help, errors, and switch semantics', async () => {
    const onChange = vi.fn();
    render(
      <>
        <TextField label="显示名称" error="名称不能为空" />
        <SelectField label="模型" options={[{ label: 'GPT', value: 'gpt' }]} />
        <Switch label="允许执行命令" checked={false} onChange={onChange} />
      </>,
    );
    expect(screen.getByLabelText('显示名称')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('名称不能为空')).toBeVisible();
    expect(screen.getByLabelText('模型')).toBeVisible();
    await userEvent.click(screen.getByRole('switch', { name: '允许执行命令' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('exposes alert tone and progress values to assistive technology', () => {
    render(
      <>
        <InlineAlert tone="warning" title="需要处理">有一项投递等待重试</InlineAlert>
        <ProgressBar label="并发占用" value={3} max={8} />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'warning');
    expect(screen.getByRole('progressbar', { name: '并发占用' })).toHaveAttribute('aria-valuenow', '3');
  });

  it('closes dialogs with Escape and restores focus to the invoker', async () => {
    const user = userEvent.setup();
    const triggerRef = createRef<HTMLButtonElement>();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>打开编辑</button>
          <Dialog open={open} title="编辑账号" onClose={() => setOpen(false)}>
            <button type="button">保存</button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: '打开编辑' }));
    const dialog = screen.getByRole('dialog', { name: '编辑账号' });
    expect(dialog).toBeVisible();
    expect(dialog.closest('.dialog-backdrop')?.parentElement).toBe(document.body);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(triggerRef.current).toHaveFocus();
  });
});
