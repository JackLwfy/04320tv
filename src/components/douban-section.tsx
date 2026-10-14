'use client';

import { useEffect, useRef, useState } from 'react';
import { trackAnalytics, setAnalyticsAttribution } from '@/lib/analytics-client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { DoubanItem } from '@/lib/types';
import { DoubanCard } from './video-card';
import { Icon } from './icon';
import { useAuth } from './auth';

const MOVIE_TAGS = ['热门', '最新', '经典', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本', '动画'];
const TV_TAGS = ['热门', '美剧', '英剧', '韩剧', '日剧', '国产剧', '港剧', '日本动画', '综艺', '纪录片'];
const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 首页推荐区：数据源由设置决定（豆瓣热门 / Bangumi 新番放送 / 影视热榜），二选一展示 */
type RecommendProps = { onPick: (title: string) => void; onContinue: () => void };

export function RecommendSection({ onPick, onContinue }: RecommendProps) {
  const doubanEnabled = useAppStore((s) => s.doubanEnabled);
  const recommendSource = useAppStore((s) => s.recommendSource);

  if (!doubanEnabled) return null;
  if (recommendSource === 'bangumi') return <BangumiView onPick={onPick} onContinue={onContinue} />;
  if (recommendSource === 'hot-list') return <HotListView onPick={onPick} onContinue={onContinue} />;
  return <DoubanView onPick={onPick} onContinue={onContinue} />;
}

/**
 * 豆瓣推荐：影视切换 + 标签筛选。
 * 一次性渲染全部条目：数据本就一次拉全（50 条），卡片图片又是 lazy 加载，
 * 视口外的图不会请求，因此不需要「加载更多」这类本地切片分页来打断浏览。
 */
function DoubanView({ onPick, onContinue }: RecommendProps) {
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [tag, setTag] = useState('热门');

  const query = useQuery({
    queryKey: ['douban', type, tag],
    queryFn: ({ signal }) => api.douban(type, tag, 0, 50, signal),
  });

  const tags = type === 'movie' ? MOVIE_TAGS : TV_TAGS;
  const items = query.data?.items ?? [];

  const switchType = (t: 'movie' | 'tv') => {
    if (t === type) return;
    setType(t);
    setTag('热门');
  };

  return (
    <section aria-label="影视推荐">
      <RecommendHeading title={type === 'movie' ? '发现好电影' : '发现好剧集'} subtitle="豆瓣推荐" onContinue={onContinue} onRefresh={() => void query.refetch()} refreshing={query.isFetching} />
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="flex gap-6">
            <TypeButton active={type === 'movie'} onClick={() => switchType('movie')}>
              电影
            </TypeButton>
            <TypeButton active={type === 'tv'} onClick={() => switchType('tv')}>
              剧集
            </TypeButton>
          </div>
        </div>
      </div>

      <div className="cinema-filter-row">
        {tags.map((t) => (
          <button
            key={t}
            className="cinema-filter"
            aria-pressed={t === tag}
            onClick={() => setTag(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该分类暂无推荐内容</p>
      ) : (
        <div className="cinema-recommend-grid">
          {items.map((item) => (
            <TrackedRecommendation key={item.id} item={item} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Bangumi 每日放送：星期筛选，一次拉全量无分页 */
function BangumiView({ onPick, onContinue }: RecommendProps) {
  const [weekday, setWeekday] = useState<number | 'all'>('all');

  const query = useQuery({
    queryKey: ['bangumi-calendar'],
    queryFn: ({ signal }) => api.bangumiCalendar(signal),
  });

  let items: DoubanItem[] = [];
  if (query.data) {
    items = weekday === 'all'
      ? query.data.days.flatMap((d) => d.items)
      : (query.data.days.find((d) => d.weekday === weekday)?.items ?? []);
  }

  return (
    <section aria-label="新番放送推荐">
      <RecommendHeading title="新番放送" subtitle="Bangumi" onContinue={onContinue} onRefresh={() => void query.refetch()} refreshing={query.isFetching} />
      <div className="cinema-filter-row">
        <ChipButton active={weekday === 'all'} onClick={() => setWeekday('all')}>
          全部
        </ChipButton>
        {WEEKDAYS.map((name, i) => (
          <ChipButton key={name} active={weekday === i + 1} onClick={() => setWeekday(i + 1)}>
            {name}
          </ChipButton>
        ))}
      </div>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : (
        <div className="cinema-recommend-grid">
          {items.map((item) => (
            <TrackedRecommendation key={item.id} item={item} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

const HOT_LISTS = [
  { id: 'douban_movie_weekly', label: '电影周榜' },
  { id: 'douban_tv_chinese', label: '国产剧周榜' },
  { id: 'douban_tv_global', label: '海外剧周榜' },
  { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' },
  { id: 'baidu_teleplay', label: '百度热播剧' },
];

/** 影视热榜（60s API）：豆瓣五个周榜 + 百度热播剧，chips 切换 */
function HotListView({ onPick, onContinue }: RecommendProps) {
  const [listId, setListId] = useState(HOT_LISTS[0].id);

  const query = useQuery({
    queryKey: ['hot-list', listId],
    queryFn: ({ signal }) => api.hotList(listId, signal),
  });

  const items = query.data?.items ?? [];

  return (
    <section aria-label="影视榜单推荐">
      <RecommendHeading title={listId === 'douban_movie_weekly' ? '本周电影榜' : HOT_LISTS.find((l) => l.id === listId)?.label || '影视热榜'} subtitle="榜单推荐" onContinue={onContinue} onRefresh={() => void query.refetch()} refreshing={query.isFetching}>
      <div className="cinema-filter-row cinema-inline-filters">
        {HOT_LISTS.map((l) => (
          <ChipButton key={l.id} active={listId === l.id} onClick={() => setListId(l.id)}>
            {l.label}
          </ChipButton>
        ))}
      </div>
      </RecommendHeading>

      {query.isError ? (
        <p className="text-center text-sm text-faint py-8">推荐内容加载失败，可稍后重试或在设置中关闭</p>
      ) : query.isLoading ? (
        <GridSkeleton />
      ) : items.length === 0 ? (
        <p className="text-center text-sm text-faint py-8">该榜单暂无内容，可刷新重试或切换榜单</p>
      ) : (
        <div className="cinema-recommend-grid">
          {items.map((item) => (
            <TrackedRecommendation key={item.id} item={item} onPick={onPick} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrackedRecommendation({ item, onPick }: { item: DoubanItem; onPick: (title: string) => void }) {
  const { checked, verified } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const source = useAppStore((s) => s.recommendSource);
  const recommendationId = `${source}:${item.id}`;
  useEffect(() => {
    if (!checked || !verified || !ref.current || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!seen.current && entries.some((entry) => entry.intersectionRatio >= 0.5) && !document.hidden) {
        seen.current = true;
        trackAnalytics({ type: 'recommendation_impression', recommendationId, title: item.title });
        observer.disconnect();
      }
    }, { threshold: 0.5 });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [checked, verified, recommendationId, item.title]);
  return <div ref={ref}><DoubanCard item={item} onClick={() => { setAnalyticsAttribution({ recommendationId, searchId: undefined }); trackAnalytics({ type: 'recommendation_click', recommendationId, title: item.title }); onPick(item.title); }} /></div>;
}

function GridSkeleton() {
  return (
    <div className="cinema-recommend-grid" aria-label="正在加载推荐">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i}>
          <div className="aspect-[2/2.5] bg-chip animate-pulse" />
          <div className="h-3 mt-2 rounded bg-chip animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function ChipButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="cinema-filter"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TypeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="cinema-filter"
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function RecommendHeading({ title, subtitle, onContinue, onRefresh, refreshing, children }: {
  title: string; subtitle: string; onContinue: () => void; onRefresh: () => void; refreshing: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="cinema-recommend-heading">
      <h2>{title}</h2>
      <span className="cinema-recommend-subtitle">{subtitle}</span>
      {children}
      <div className="cinema-recommend-actions">
        <button type="button" onClick={onContinue}>继续观看</button>
        <button type="button" onClick={onRefresh} disabled={refreshing}>
          <Icon name="refresh" className={cn('w-4 h-4', refreshing && 'animate-spin motion-reduce:animate-none')} />
          {refreshing ? '刷新中' : '刷新榜单'}
        </button>
      </div>
    </div>
  );
}
