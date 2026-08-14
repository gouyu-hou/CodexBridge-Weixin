import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ToastProvider, useToast } from './ToastContext';

function ToastHarness() {
  const toast = useToast();
  return <button type="button" onClick={() => toast.success('设置已保存')}>保存</button>;
}

describe('ToastProvider', () => {
  it('shows bounded operation feedback and supports dismissal', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><ToastHarness /></ToastProvider>);

    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('status')).toHaveTextContent('设置已保存');
    await user.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByText('设置已保存')).not.toBeInTheDocument();
  });
});
