import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from './header';

const flags = vi.hoisted(() => ({ settingsEnabled: true, liveEnabled: false }));
vi.mock('./auth', () => ({ useAuth: () => flags }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('./source-manager', () => ({ SourceManagerDrawer: () => createElement('div', { 'data-settings-drawer': true }) }));

afterEach(() => { flags.settingsEnabled = true; });

function renderHeader() {
  const client = new QueryClient();
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Header)));
  client.clear();
  return html;
}

describe('settings visibility', () => {
  it('关闭时不渲染设置按钮或抽屉，其他工具保留', () => {
    flags.settingsEnabled = false;
    const html = renderHeader();
    expect(html).not.toContain('aria-label="设置"');
    expect(html).not.toContain('data-settings-drawer');
    expect(html).toContain('aria-label="观看历史"');
    expect(html).toContain('aria-label="下载管理"');
    expect(html).toContain('aria-label="04320TV 首页"');
  });

  it('开启时恢复设置按钮和抽屉', () => {
    const html = renderHeader();
    expect(html).toContain('aria-label="设置"');
    expect(html).toContain('data-settings-drawer');
  });
});
