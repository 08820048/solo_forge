'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type SponsoredProduct = {
  id: string;
  name: string;
  slogan: string;
  website: string;
  maker_name: string;
};

type CategoryWithCount = {
  id: string;
  name_en: string;
  name_zh: string;
  icon?: string | null;
  color?: string | null;
  product_count: number;
};

function renderRank(rank: number) {
  if (rank === 1) {
    return (
      <span className="flex items-center gap-1 text-yellow-500">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="flex items-center gap-1 text-slate-300">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="flex items-center gap-1 text-amber-700">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  return <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>;
}

/**
 * HomeRightSidebar
 * 首页右侧栏：展示 3 个赞助位产品与热门分类排行榜（Top 10）。
 */
export default function HomeRightSidebar() {
  const locale = useLocale();
  const tSponsored = useTranslations('home.sponsored');
  const tRanking = useTranslations('home.categoryRanking');

  const [sponsorLoading, setSponsorLoading] = useState(true);
  const [sponsorList, setSponsorList] = useState<SponsoredProduct[]>([]);
  const [sponsorMessage, setSponsorMessage] = useState<string | null>(null);

  const [rankingLoading, setRankingLoading] = useState(true);
  const [rankingList, setRankingList] = useState<CategoryWithCount[]>([]);
  const [rankingMessage, setRankingMessage] = useState<string | null>(null);

  const isZh = useMemo(() => locale.toLowerCase().startsWith('zh'), [locale]);

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchSponsors
     * 拉取首页赞助位产品（当前复用已上架产品列表，取前 3 个）。
     */
    async function fetchSponsors() {
      setSponsorLoading(true);
      setSponsorMessage(null);
      try {
        const response = await fetch(`/api/products?status=approved&language=${encodeURIComponent(locale)}&limit=3&offset=0`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<SponsoredProduct[]> = await response.json();
        if (cancelled) return;

        if (!json.success) {
          setSponsorList([]);
          setSponsorMessage(json.message ?? null);
          return;
        }
        setSponsorList((json.data ?? []).slice(0, 3));
      } catch {
        if (!cancelled) {
          setSponsorList([]);
          setSponsorMessage(null);
        }
      } finally {
        if (!cancelled) setSponsorLoading(false);
      }
    }

    fetchSponsors();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchRanking
     * 拉取热门分类排行榜（Top 10），按产品数量降序。
     */
    async function fetchRanking() {
      setRankingLoading(true);
      setRankingMessage(null);
      try {
        const response = await fetch(`/api/categories?kind=top&limit=10`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<CategoryWithCount[]> = await response.json();
        if (cancelled) return;

        if (!json.success) {
          setRankingList([]);
          setRankingMessage(json.message ?? null);
          return;
        }
        setRankingList((json.data ?? []).slice(0, 10));
      } catch {
        if (!cancelled) {
          setRankingList([]);
          setRankingMessage(null);
        }
      } finally {
        if (!cancelled) setRankingLoading(false);
      }
    }

    fetchRanking();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="lg:sticky lg:top-24 space-y-6">
      <div className="rounded-xl border border-border bg-card/50">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">{tSponsored('title')}</div>
            <Badge variant="secondary" className="shrink-0">
              {tSponsored('badge')}
            </Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{tSponsored('subtitle')}</div>
        </div>

        <div className="px-5 py-4">
          {sponsorLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{tSponsored('loading')}</div>
          ) : sponsorList.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{sponsorMessage || tSponsored('empty')}</div>
          ) : (
            <div className="space-y-3">
              {sponsorList.map((p) => (
                <div key={p.id} className="rounded-xl border border-border bg-background/40 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                        <Badge variant="outline" className="shrink-0">
                          {tSponsored('itemBadge')}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.slogan}</div>
                      <div className="mt-2 text-[11px] text-muted-foreground truncate">by {p.maker_name}</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <a
                      href={p.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {tSponsored('visit')}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/50">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold text-foreground">{tRanking('title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{tRanking('subtitle')}</div>
        </div>

        <div className="px-5 py-4">
          {rankingLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{tRanking('loading')}</div>
          ) : rankingList.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{rankingMessage || tRanking('empty')}</div>
          ) : (
            <div className="space-y-2">
              {rankingList.map((c, idx) => {
                const name = (isZh ? c.name_zh : c.name_en) || c.name_en || c.name_zh || String(c.id);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 shrink-0 flex items-center pt-0.5">{renderRank(idx + 1)}</div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">{name}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {tRanking('count', { count: c.product_count })}
                        </div>
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {c.product_count}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
