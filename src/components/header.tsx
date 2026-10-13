'use client';

import Link from 'next/link';
import Image from 'next/image';
import { brandPath } from '@/lib/brand';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { useAuth } from './auth';

/** 顶部导航：Logo、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const { liveEnabled, settingsEnabled } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      <header className="cinema-header sticky top-0 z-40 bg-page/95 backdrop-blur border-b border-line">
        <div className="cinema-container cinema-header-inner">
          <Link href="/" aria-label="04320TV 首页" className="cinema-brand">
            <span className="cinema-logo">
              <Image src={`${brandPath}/logo-light.svg`} alt="04320TV" width={490} height={112} className="cinema-logo-light" priority />
              <Image src={`${brandPath}/logo-dark.svg`} alt="" aria-hidden="true" width={490} height={112} className="cinema-logo-dark" priority />
            </span>
            <span className="cinema-brand-caption">光影之间</span>
          </Link>
          <nav className="cinema-primary-nav" aria-label="主导航">
            <HeaderLink href="/" active={pathname === '/'}>发现</HeaderLink>
            {liveEnabled && <HeaderLink href="/live" active={pathname === '/live'}>直播</HeaderLink>}
          </nav>

          {showSearch && (
            <form
              className="flex-1 max-w-xl hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.resetActive();
                  }}
                  onFocus={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                  />
                )}
              </div>
            </form>
          )}

          <nav className="cinema-tools" aria-label="观影工具">
            <ThemeToggle />
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
            </IconButton>
            <IconButton label="下载管理" onClick={requestShowDownloadManager}>
              <Icon name="download" />
            </IconButton>
            {settingsEnabled && <IconButton label="设置" onClick={() => setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton>}
          </nav>
        </div>
      </header>

      {settingsEnabled && <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'cinema-nav-link',
        active ? 'is-active' : ''
      )}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="cinema-tool text-muted hover:text-content transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className="cinema-tool-icon">{children}</span>
      <span className="cinema-tool-label">{label === '下载管理' ? '下载' : label}</span>
    </button>
  );
}
