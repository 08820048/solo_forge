'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import FlipClockCountdown from '@/components/ui/flip-clock-countdown';
import { isKnownRemoteImageUrl, plainTextFromMarkdown } from '@/lib/utils';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type SponsoredProduct = {
  id: string;
  name: string;
  slogan: string;
  website: string;
  maker_name: string;
  logo_url?: string | null;
};

type SponsoredProductsPayload = {
  products: SponsoredProduct[];
  next_refresh_at: string;
};

type CategoryWithCount = {
  id: string;
  name_en: string;
  name_zh: string;
  icon?: string | null;
  color?: string | null;
  product_count: number;
};

const categoryIconOverrides: Record<string, string> = {
  ai: 'robot-3-line',
  design: 'figma-line',
  developer: 'code-ai-line',
  education: 'school-line',
  finance: 'visa-line',
  games: 'gamepad-line',
  lifestyle: 'home-smile-line',
  marketing: 'bubble-chart-line',
  productivity: 'tools-line',
  writing: 'quill-pen-ai-line',
};

function normalizeRemixIconClass(raw?: string | null) {
  const name = (raw || '').trim();
  if (!name) return null;
  return name.startsWith('ri-') ? name : `ri-${name}`;
}

/**
 * SloganText
 * 侧栏列表项以纯文本展示 slogan，减少渲染成本。
 */
function SloganText({ value }: { value: string }) {
  return <span>{plainTextFromMarkdown(value)}</span>;
}

function renderRank(rank: number) {
  if (rank === 1) {
    return (
      <span className="flex items-center text-yellow-500">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="flex items-center text-slate-300">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="flex items-center text-amber-700">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  return <span className="text-xs font-semibold text-muted-foreground">{rank}</span>;
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
  const [nextRefreshAt, setNextRefreshAt] = useState<string | null>(null);

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
      const maxAttempts = 3;
      const isRetryableMessage = (msg?: string | null) => {
        const m = (msg || '').toLowerCase();
        if (!m) return false;
        return (
          m.includes('降级') ||
          m.includes('超时') ||
          m.includes('不可用') ||
          m.includes('degraded') ||
          m.includes('timeout') ||
          m.includes('timed out') ||
          m.includes('unavailable')
        );
      };

      const delay = async (attempt: number) => {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(`/api/home/sponsored-right?language=${encodeURIComponent(locale)}`, {
            headers: { 'Accept-Language': locale },
            cache: 'no-store',
          });
          const json: ApiResponse<SponsoredProductsPayload> = await response.json();
          if (cancelled) return;

          if (!json.success) {
            if (attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setSponsorList([]);
            setSponsorMessage(json.message ?? null);
            setNextRefreshAt(null);
            setSponsorLoading(false);
            return;
          } else {
            const payload = json.data;
            const list = (payload?.products ?? []).slice(0, 3);
            if (list.length === 0 && attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setSponsorList(list);
            setNextRefreshAt(payload?.next_refresh_at || null);
            if (list.length === 0) setSponsorMessage(json.message ?? null);
          }

          if (!cancelled) {
            setSponsorLoading(false);
          }
          return;
        } catch {
          if (attempt < maxAttempts) {
            await delay(attempt);
          } else if (!cancelled) {
            setSponsorList([]);
            setSponsorMessage(null);
            setNextRefreshAt(null);
            setSponsorLoading(false);
          }
        }
      }

      if (!cancelled) {
        setSponsorLoading(false);
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
      const maxAttempts = 3;
      const isRetryableMessage = (msg?: string | null) => {
        const m = (msg || '').toLowerCase();
        if (!m) return false;
        return (
          m.includes('降级') ||
          m.includes('超时') ||
          m.includes('不可用') ||
          m.includes('degraded') ||
          m.includes('timeout') ||
          m.includes('timed out') ||
          m.includes('unavailable')
        );
      };

      const delay = async (attempt: number) => {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(`/api/categories?kind=top&limit=10`, {
            headers: { 'Accept-Language': locale },
            cache: 'no-store',
          });
          const json: ApiResponse<CategoryWithCount[]> = await response.json();
          if (cancelled) return;

          if (!json.success) {
            if (attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setRankingList([]);
            setRankingMessage(json.message ?? null);
          } else {
            const list = (json.data ?? []).slice(0, 10);
            if (list.length === 0 && attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setRankingList(list);
            if (list.length === 0) setRankingMessage(json.message ?? null);
          }

          if (!cancelled) setRankingLoading(false);
          return;
        } catch {
          if (attempt < maxAttempts) {
            await delay(attempt);
          } else if (!cancelled) {
            setRankingList([]);
            setRankingMessage(null);
            setRankingLoading(false);
          }
        }
      }

      if (!cancelled) setRankingLoading(false);
    }

    fetchRanking();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="animate-on-scroll lg:sticky lg:top-24 space-y-6">
      <div className="sf-wash rounded-xl border border-border bg-card/50">
        <div className="px-5 py-4 border-b border-border">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-sm font-semibold text-foreground whitespace-nowrap">{tSponsored('title')}</div>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <FlipClockCountdown target={nextRefreshAt} showDays={false} scale={0.32} className="shrink-0" />
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          {sponsorLoading ? (
            <div className="space-y-3 animate-in fade-in-0 duration-300">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-border bg-background/40 px-4 py-4 animate-pulse"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 shrink-0 rounded-lg bg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="mt-2 h-3 w-full rounded bg-muted" />
                      <div className="mt-2 h-3 w-4/5 rounded bg-muted" />
                    </div>
                    <div className="w-9 h-9 shrink-0 rounded-md bg-muted" />
                  </div>
                </div>
              ))}
              <div className="pt-1 text-center text-xs text-muted-foreground">{tSponsored('loading')}</div>
            </div>
          ) : sponsorList.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground animate-in fade-in-0 duration-300">
              {sponsorMessage || tSponsored('empty')}
            </div>
          ) : (
            <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
              {sponsorList.map((p) => (
                <div key={p.id} className="rounded-xl border border-border bg-background/40 px-4 py-4">
                  <div className="flex items-start gap-3">
                      <div className="w-10 h-10 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                        {p.logo_url ? (
                          isKnownRemoteImageUrl(p.logo_url) ? (
                            <Image
                              src={p.logo_url}
                              alt={p.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Image
                              src={p.logo_url}
                              alt={p.name}
                              width={40}
                              height={40}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              unoptimized
                              loader={({ src }) => src}
                            />
                          )
                        ) : (
                          <span className="text-muted-foreground text-sm font-semibold">
                            {p.name.trim().charAt(0).toUpperCase()}
                          </span>
                        )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{p.name}</div>
                        <Badge variant="outline" className="shrink-0">
                          {tSponsored('itemBadge')}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        <SloganText value={p.slogan} />
                      </div>
                    </div>

                    {p.website ? (
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={tSponsored('visit')}
                        className="shrink-0 inline-flex items-center justify-center rounded-md w-9 h-9 border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                      >
                        <i className="ri-global-line text-base" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="shrink-0 inline-flex items-center justify-center rounded-md w-9 h-9 border border-border bg-background/70 text-muted-foreground">
                        <i className="ri-global-line text-base" aria-hidden="true" />
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sf-wash rounded-xl border border-border bg-card/50">
        <div className="px-5 py-4 border-b border-border">
          <div className="text-sm font-semibold text-foreground">{tRanking('title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{tRanking('subtitle')}</div>
        </div>

        <div className="px-5 py-4">
          {rankingLoading ? (
            <div className="space-y-2 animate-in fade-in-0 duration-300">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3 animate-pulse"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-12 shrink-0 flex items-center">
                      <div className="h-4 w-6 rounded bg-muted" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-2/3 rounded bg-muted" />
                      <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="h-6 w-10 rounded bg-muted" />
                </div>
              ))}
              <div className="pt-1 text-center text-xs text-muted-foreground">{tRanking('loading')}</div>
            </div>
          ) : rankingList.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground animate-in fade-in-0 duration-300">
              {rankingMessage || tRanking('empty')}
            </div>
          ) : (
            <div className="space-y-2 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
              {rankingList.map((c, idx) => {
                const name = (isZh ? c.name_zh : c.name_en) || c.name_en || c.name_zh || String(c.id);
                const iconClass =
                  normalizeRemixIconClass(categoryIconOverrides[String(c.id).toLowerCase()] ?? c.icon) ??
                  'ri-price-tag-3-line';
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 shrink-0 flex items-center pt-0.5">{renderRank(idx + 1)}</div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <i className={[iconClass, 'text-sm text-muted-foreground'].join(' ')} aria-hidden="true" />
                          <div className="text-sm font-medium text-foreground truncate">{name}</div>
                        </div>
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
