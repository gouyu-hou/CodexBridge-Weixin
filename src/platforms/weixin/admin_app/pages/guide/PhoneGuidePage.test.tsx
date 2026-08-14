import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhoneGuidePage } from './PhoneGuidePage';

describe('PhoneGuidePage', () => {
  it('shows the operational path, core commands, and computer dependency', () => {
    render(<PhoneGuidePage />);
    expect(screen.getByRole('heading', { name: '手机微信使用 Codex' })).toBeVisible();
    expect(screen.getAllByText('/project D:\\你的项目路径')).toHaveLength(2);
    expect(screen.getByText('/allow 1')).toBeVisible();
    expect(screen.getByText(/电脑必须保持开机、联网/)).toBeVisible();
  });
});
