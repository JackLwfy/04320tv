import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { RecommendSection } from './douban-section';
import type { DoubanItem } from '@/lib/types';

function renderRecommendations(items: DoubanItem[]) {
  const client = new QueryClient();
  client.setQueryData(['hot-list', 'douban_movie_weekly'], { items });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(RecommendSection, { onPick: () => {}, onContinue: () => {} })));
  client.clear();
  return html;
}

describe('cinema recommendations', () => {
  it('explains an empty upstream list instead of presenting a blank shelf', () => {
    const html = renderRecommendations([]);
    expect(html).toContain('该榜单暂无内容');
    expect(html).toContain('继续观看');
    expect(html).not.toContain('cinema-poster-title');
  });

  it('uses actual titles and ratings, preserves search semantics and missing-cover fallback', () => {
    const html = renderRecommendations([
      { id: '1', title: '真实榜单影片', cover: '', rating: '8.2' },
      { id: '2', title: '<未评分>', cover: '' },
    ]);
    expect(html).toContain('aria-label="查找片源：真实榜单影片"');
    expect(html).toContain('暂无海报');
    expect(html).toContain('&lt;未评分&gt;');
    expect(html.match(/cinema-poster-rating/g)).toHaveLength(1);
    expect(html).toContain('8.2');
    expect(html).not.toContain('立即播放');
  });
});
