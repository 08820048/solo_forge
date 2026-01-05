'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type WindowKey = 'day' | 'week' | 'month' | 'all';

interface Product {
  id: string;
  name: string;
  slogan: string;
  category: string;
  maker_name: string;
}

interface MakerRank {
  maker_name: string;
  product_count: number;
}

interface LeaderboardData {
  top_products: Product[];
  top_makers: MakerRank[];
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

function SloganMarkdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <span>{children}</span>,
        a: ({ href, children }) => (
          <a
            href={href ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (href) window.open(href, '_blank', 'noopener,noreferrer');
            }}
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground/90">{children}</code>
        ),
        ul: ({ children }) => <span>{children}</span>,
        ol: ({ children }) => <span>{children}</span>,
        li: ({ children }) => <span>• {children} </span>,
        h1: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        h2: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        h3: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        blockquote: ({ children }) => <span>{children}</span>,
        pre: ({ children }) => <span>{children}</span>,
        br: () => <span> </span>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

function renderRankBadge(rank: number) {
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
  return <span className="text-sm font-semibold text-muted-foreground">{rank}</span>;
}

/**
 * LeaderboardPage
 * 排行榜页：按时间窗口展示产品榜与开发者榜，便于用户快速发现热点作品。
 */
export default function LeaderboardPage() {
  const t = useTranslations('leaderboard');
  const categoryT = useTranslations('categories');
  const navT = useTranslations('nav');
  const locale = useLocale();

  const [windowKey, setWindowKey] = useState<WindowKey>('week');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const windowOptions = useMemo(
    () =>
      [
        { key: 'day', label: t('windows.day') },
        { key: 'week', label: t('windows.week') },
        { key: 'month', label: t('windows.month') },
        { key: 'all', label: t('windows.all') },
      ] as const,
    [t]
  );

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchLeaderboard
     * 拉取排行榜数据；失败时回退为空状态，确保页面可用。
     */
    async function fetchLeaderboard() {
      setLoading(true);
      try {
        const response = await fetch(`/api/leaderboard?window=${windowKey}&limit=20&language=${locale}`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<LeaderboardData> = await response.json();

        if (!cancelled) {
          setData(json.success ? (json.data ?? null) : null);
          setMessage(json.message ?? null);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setMessage(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchLeaderboard();

    return () => {
      cancelled = true;
    };
  }, [locale, windowKey]);

  const isEmpty = !data || (data.top_products.length === 0 && data.top_makers.length === 0);

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-24 pb-12">
        <div className="mb-10">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl sm:text-5xl font-bold text-foreground tracking-tight">{t('title')}</h1>
              <p className="mt-3 text-muted-foreground">{t('subtitle')}</p>
            </div>
            <div className="hidden sm:flex items-center gap-3">
              <Link href="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {navT('products')}
              </Link>
              <Link href="/submit" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {navT('submit')}
              </Link>
            </div>
          </div>
        </div>

        <Tabs value={windowKey} onValueChange={(v) => setWindowKey(v as WindowKey)}>
          <TabsList className="border border-border">
            {windowOptions.map((opt) => (
              <TabsTrigger key={opt.key} value={opt.key}>
                {opt.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {windowOptions.map((opt) => (
            <TabsContent key={opt.key} value={opt.key} className="mt-6">
              {loading ? (
                <div className="py-24 text-center text-muted-foreground">{t('loading')}</div>
              ) : isEmpty ? (
                <div className="py-24 text-center text-muted-foreground">{message || t('empty')}</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-2 rounded-xl border border-border bg-card/50">
                    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-foreground">{t('topProducts')}</h2>
                      <span className="text-xs text-muted-foreground">{t('windowLabel', { window: opt.label })}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {data.top_products.map((p, idx) => (
                        <div key={p.id} className="px-5 py-4 flex items-start gap-4">
                          <div className="w-12 shrink-0 flex items-center pt-0.5">{renderRankBadge(idx + 1)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <Link
                                href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                                className="text-foreground font-medium hover:underline truncate"
                              >
                                {p.name}
                              </Link>
                              <Badge variant="secondary">
                                {categoryT(p.category)}
                              </Badge>
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                              <SloganMarkdown value={p.slogan} />
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">by {p.maker_name}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card/50">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="text-sm font-semibold text-foreground">{t('topMakers')}</h2>
                    </div>
                    <div className="divide-y divide-border">
                      {data.top_makers.map((m, idx) => (
                        <div key={`${m.maker_name}-${idx}`} className="px-5 py-4 flex items-center gap-3">
                          <div className="w-12 shrink-0 flex items-center">{renderRankBadge(idx + 1)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground font-medium truncate">{m.maker_name}</div>
                            <div className="text-xs text-muted-foreground">{t('makerCount', { count: m.product_count })}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}
