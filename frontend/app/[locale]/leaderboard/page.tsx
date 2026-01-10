'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isKnownRemoteImageUrl, plainTextFromMarkdown } from '@/lib/utils';

type WindowKey = 'day' | 'week' | 'month' | 'all';

interface Product {
  id: string;
  name: string;
  slogan: string;
  logo_url?: string | null;
  category: string;
  maker_name: string;
  maker_email?: string | null;
  website?: string | null;
  likes: number;
  favorites: number;
}

interface MakerRank {
  maker_name: string;
  maker_email: string;
  avatar_url?: string | null;
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

function readFavoritesFromStorage(): string[] {
  try {
    const raw = localStorage.getItem('sf_favorites');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string') as string[];
  } catch {
    return [];
  }
}

function writeFavoritesToStorage(ids: string[]) {
  try {
    localStorage.setItem('sf_favorites', JSON.stringify(ids));
    window.dispatchEvent(new Event('sf_favorites_updated'));
  } catch {}
}

function readLikesFromStorage(): string[] {
  try {
    const raw = localStorage.getItem('sf_likes');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string') as string[];
  } catch {
    return [];
  }
}

function writeLikesToStorage(ids: string[]) {
  try {
    localStorage.setItem('sf_likes', JSON.stringify(ids));
    window.dispatchEvent(new Event('sf_likes_updated'));
  } catch {}
}

function getAuthenticatedUserEmail(): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}
  return null;
}

function notify(message: string) {
  const text = (message || '').trim();
  if (!text) return;
  try {
    window.dispatchEvent(new CustomEvent('sf_notify', { detail: { message: text } }));
  } catch {}
}

function isSameUserEmail(a?: string | null, b?: string | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

/**
 * SloganText
 * 在排行榜列表里以纯文本展示 slogan，避免大量列表项触发 Markdown 渲染。
 */
function SloganText({ value }: { value: string }) {
  return <span>{plainTextFromMarkdown(value)}</span>;
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
  const commonT = useTranslations('common');
  const locale = useLocale();

  const [windowKey, setWindowKey] = useState<WindowKey>('week');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [likeIds, setLikeIds] = useState<string[]>([]);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

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
        const next = json.success ? (json.data ?? null) : null;
        const normalized: LeaderboardData | null = next
          ? {
              top_products: Array.isArray(next.top_products)
                ? next.top_products.map((p) => ({
                    ...p,
                    likes: typeof p.likes === 'number' ? p.likes : Number((p as unknown as { likes?: unknown }).likes ?? 0),
                    favorites:
                      typeof p.favorites === 'number' ? p.favorites : Number((p as unknown as { favorites?: unknown }).favorites ?? 0),
                  }))
                : [],
              top_makers: Array.isArray(next.top_makers) ? next.top_makers : [],
            }
          : null;

        if (!cancelled) {
          setData(normalized);
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

  useEffect(() => {
    setFavoriteIds(readFavoritesFromStorage());
    const onUpdate = () => setFavoriteIds(readFavoritesFromStorage());
    window.addEventListener('sf_favorites_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_favorites_updated', onUpdate as EventListener);
  }, []);

  useEffect(() => {
    setLikeIds(readLikesFromStorage());
    const onUpdate = () => setLikeIds(readLikesFromStorage());
    window.addEventListener('sf_likes_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_likes_updated', onUpdate as EventListener);
  }, []);

  useEffect(() => {
    setCurrentUserEmail(getAuthenticatedUserEmail());
  }, []);

  const adjustProductCount = (productId: string, field: 'likes' | 'favorites', delta: number) => {
    setData((cur) => {
      if (!cur) return cur;
      const nextProducts = cur.top_products.map((p) => {
        if (p.id !== productId) return p;
        const nextValue = Math.max(0, (p[field] ?? 0) + delta);
        return { ...p, [field]: nextValue };
      });
      return { ...cur, top_products: nextProducts };
    });
  };

  const toggleFavorite = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }

    const product = data?.top_products.find((p) => p.id === normalizedId);
    if (isSameUserEmail(product?.maker_email ?? null, userEmail)) return;

    const prev = favoriteIds;
    const prevSet = new Set(prev);
    const isFavorited = prevSet.has(normalizedId);

    const nextSet = new Set(prevSet);
    if (isFavorited) nextSet.delete(normalizedId);
    else nextSet.add(normalizedId);

    const next = Array.from(nextSet);
    setFavoriteIds(next);
    writeFavoritesToStorage(next);
    const delta = isFavorited ? -1 : 1;
    adjustProductCount(normalizedId, 'favorites', delta);

    try {
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isFavorited ? 'unfavorite' : 'favorite',
          product_id: normalizedId,
          user_id: userEmail,
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFavoriteIds(prev);
        writeFavoritesToStorage(prev);
        adjustProductCount(normalizedId, 'favorites', -delta);
      }
    } catch {
      setFavoriteIds(prev);
      writeFavoritesToStorage(prev);
      adjustProductCount(normalizedId, 'favorites', -delta);
    }
  };

  const toggleLike = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }

    const product = data?.top_products.find((p) => p.id === normalizedId);
    if (isSameUserEmail(product?.maker_email ?? null, userEmail)) return;

    const prev = likeIds;
    const prevSet = new Set(prev);
    const isLiked = prevSet.has(normalizedId);

    const nextSet = new Set(prevSet);
    if (isLiked) nextSet.delete(normalizedId);
    else nextSet.add(normalizedId);

    const next = Array.from(nextSet);
    setLikeIds(next);
    writeLikesToStorage(next);
    const delta = isLiked ? -1 : 1;
    adjustProductCount(normalizedId, 'likes', delta);

    try {
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isLiked ? 'unlike' : 'like',
          product_id: normalizedId,
          user_id: userEmail,
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setLikeIds(prev);
        writeLikesToStorage(prev);
        adjustProductCount(normalizedId, 'likes', -delta);
      }
    } catch {
      setLikeIds(prev);
      writeLikesToStorage(prev);
      adjustProductCount(normalizedId, 'likes', -delta);
    }
  };

  const isEmpty = !data || (data.top_products.length === 0 && data.top_makers.length === 0);

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-20 sm:pt-24 pb-12">
        <div className="mb-10 animate-on-scroll">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground tracking-tight">{t('title')}</h1>
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
                <div className="py-24 text-center text-muted-foreground animate-in fade-in-0 duration-300">
                  {t('loading')}
                </div>
              ) : isEmpty ? (
                <div className="py-24 text-center text-muted-foreground animate-in fade-in-0 duration-300">
                  {message || t('empty')}
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                  <div className="lg:col-span-2 rounded-xl border border-border bg-card">
                    <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-foreground">{t('topProducts')}</h2>
                      <span className="text-xs text-muted-foreground">{t('windowLabel', { window: opt.label })}</span>
                    </div>
                    <div className="divide-y divide-border">
                      {data.top_products.map((p, idx) => (
                        <div key={p.id} className="px-5 py-4 flex items-center gap-4">
                          <div className="w-12 shrink-0 flex items-center">{renderRankBadge(idx + 1)}</div>
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
                              <span className="text-muted-foreground text-sm font-semibold">{p.name.trim().charAt(0).toUpperCase()}</span>
                            )}
                          </div>
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
                              <SloganText value={p.slogan} />
                            </div>
                          </div>
                          <div className="shrink-0 flex items-start gap-3">
                            {(() => {
                              const selfActionDisabled = isSameUserEmail(p.maker_email ?? null, currentUserEmail);
                              const favorited = favoriteIds.includes(p.id);
                              const liked = likeIds.includes(p.id);
                              const website = (p.website || '').trim();
                              const hasWebsite = Boolean(website);
                              return (
                                <>
                                  <div className="flex flex-col items-center">
                                    <button
                                      type="button"
                                      aria-label={favorited ? '取消收藏' : '收藏'}
                                      disabled={selfActionDisabled}
                                      onClick={() => void toggleFavorite(p.id)}
                                      className={[
                                        'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background transition-all duration-200 active:scale-95',
                                        selfActionDisabled
                                          ? 'opacity-50 cursor-not-allowed'
                                          : 'hover:bg-accent hover:text-accent-foreground',
                                      ].join(' ')}
                                    >
                                      <i
                                        key={favorited ? 'favorited' : 'unfavorited'}
                                        className={[
                                          `${favorited ? 'ri-heart-3-fill' : 'ri-heart-3-line'} text-base transition-all duration-200`,
                                          favorited
                                            ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                                            : 'text-muted-foreground',
                                        ].join(' ')}
                                        aria-hidden="true"
                                      />
                                    </button>
                                    <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{p.favorites}</span>
                                  </div>
                                  <div className="flex flex-col items-center">
                                    <button
                                      type="button"
                                      aria-label={liked ? '取消点赞' : '点赞'}
                                      disabled={selfActionDisabled}
                                      onClick={() => void toggleLike(p.id)}
                                      className={[
                                        'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background transition-all duration-200 active:scale-95',
                                        selfActionDisabled
                                          ? 'opacity-50 cursor-not-allowed'
                                          : 'hover:bg-accent hover:text-accent-foreground',
                                      ].join(' ')}
                                    >
                                      <i
                                        key={liked ? 'liked' : 'unliked'}
                                        className={[
                                          `${liked ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-base transition-all duration-200`,
                                          liked
                                            ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                                            : 'text-muted-foreground',
                                        ].join(' ')}
                                        aria-hidden="true"
                                      />
                                    </button>
                                    <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{p.likes}</span>
                                  </div>
                                  {hasWebsite ? (
                                    <a
                                      href={website}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                                      aria-label="访问官网"
                                    >
                                      <i className="ri-global-line text-base" aria-hidden="true" />
                                    </a>
                                  ) : (
                                    <span className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background text-muted-foreground">
                                      <i className="ri-global-line text-base" aria-hidden="true" />
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card">
                    <div className="px-5 py-4 border-b border-border">
                      <h2 className="text-sm font-semibold text-foreground">{t('topMakers')}</h2>
                    </div>
                    <div className="divide-y divide-border">
                      {data.top_makers.map((m, idx) => (
                        <div key={`${m.maker_name}-${idx}`} className="px-5 py-4 flex items-center gap-3">
                          <div className="w-12 shrink-0 flex items-center">{renderRankBadge(idx + 1)}</div>
                          {m.maker_email ? (
                            <Link
                              href={{ pathname: '/makers/[email]', params: { email: m.maker_email } }}
                              className="min-w-0 flex-1 flex items-center gap-3 hover:opacity-90 transition-opacity"
                            >
                              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden text-sm font-semibold text-muted-foreground">
                                {m.avatar_url ? (
                                  isKnownRemoteImageUrl(m.avatar_url) ? (
                                    <Image
                                      src={m.avatar_url}
                                      alt={m.maker_name || m.maker_email}
                                      width={40}
                                      height={40}
                                      className="w-full h-full object-cover"
                                      loading="lazy"
                                      referrerPolicy="no-referrer"
                                    />
                                  ) : (
                                    <Image
                                      src={m.avatar_url}
                                      alt={m.maker_name || m.maker_email}
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
                                  (m.maker_name || m.maker_email).trim().charAt(0).toUpperCase()
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-foreground font-medium truncate">{m.maker_name || m.maker_email}</div>
                                <div className="text-xs text-muted-foreground">{t('makerCount', { count: m.product_count })}</div>
                              </div>
                            </Link>
                          ) : (
                            <div className="min-w-0 flex-1">
                              <div className="text-foreground font-medium truncate">{m.maker_name}</div>
                              <div className="text-xs text-muted-foreground">{t('makerCount', { count: m.product_count })}</div>
                            </div>
                          )}
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
