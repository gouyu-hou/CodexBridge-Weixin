import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PhoneGuidePage } from './PhoneGuidePage';

describe('PhoneGuidePage', () => {
  it('preserves the complete mobile workflow, command reference, and troubleshooting guide', () => {
    render(<PhoneGuidePage />);
    expect(screen.getByRole('heading', { name: '手机微信使用 Codex' })).toBeVisible();
    expect(screen.getAllByText('/project D:\\你的项目路径')).toHaveLength(2);
    expect(screen.getByText('/allow 1')).toBeVisible();
    expect(screen.getByText(/电脑必须保持开机、联网/)).toBeVisible();
    expect(screen.getByRole('heading', { name: '手机能做什么' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '审批和权限' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '图片和文件：多张一起发' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '会话管理：让历史对话好找' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '模型和供应商' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '所有常用命令速查' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '推荐任务模板' })).toBeVisible();
    expect(screen.getByText('/permissions full-access')).toBeVisible();
    expect(screen.getByText('/threads pin 2')).toBeVisible();
    expect(screen.getByText('/instructions')).toBeVisible();
    expect(screen.getByText('/login')).toBeVisible();
  });
});
