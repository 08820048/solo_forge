'use client';

import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import { Link } from '@/i18n/routing';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { plainTextFromMarkdown } from '@/lib/utils';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';

/**
 * SloganText
 * 在产品列表里以纯文本展示 slogan，降低 JS 执行与渲染开销。
 */
function SloganText({ value }: { value: string }) {
  return <span>{plainTextFromMarkdown(value)}</span>;
}

/**
 * readFavoritesFromStorage
 * 从 localStorage 读取已收藏作品 id 列表。
 */
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

/**
 * writeFavoritesToStorage
 * 写入已收藏作品 id 列表到 localStorage，并广播更新事件。
 */
function writeFavoritesToStorage(ids: string[]) {
  try {
    localStorage.setItem('sf_favorites', JSON.stringify(ids));
    window.dispatchEvent(new Event('sf_favorites_updated'));
  } catch {}
}

/**
 * readLikesFromStorage
 * 从 localStorage 读取已点赞作品 id 列表。
 */
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

/**
 * writeLikesToStorage
 * 写入已点赞作品 id 列表到 localStorage，并广播更新事件。
 */
function writeLikesToStorage(ids: string[]) {
  try {
    localStorage.setItem('sf_likes', JSON.stringify(ids));
    window.dispatchEvent(new Event('sf_likes_updated'));
  } catch {}
}

/**
 * getAuthenticatedUserEmail
 * 获取已登录用户邮箱（未登录返回 null）。
 */
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

/**
 * sortProductsByPopularity
 * 按后端 popularity 规则（likes + favorites）排序，保证名次交换动画可见。
 */
function sortProductsByPopularity(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const scoreA = (a.likes ?? 0) + (a.favorites ?? 0);
    const scoreB = (b.likes ?? 0) + (b.favorites ?? 0);
    if (scoreA !== scoreB) return scoreB - scoreA;
    if ((a.favorites ?? 0) !== (b.favorites ?? 0)) return (b.favorites ?? 0) - (a.favorites ?? 0);
    if ((a.likes ?? 0) !== (b.likes ?? 0)) return (b.likes ?? 0) - (a.likes ?? 0);
    return a.id.localeCompare(b.id);
  });
}

interface Product {
  id: string;
  name: string;
  slogan: string;
  logo_url?: string;
  category: string;
  maker_name: string;
  maker_email?: string | null;
  website: string;
  likes: number;
  favorites: number;
}

type ApiError = {
  code: string;
  trace_id: string;
  degraded: boolean;
  hint?: string | null;
  detail?: string | null;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string; error?: ApiError | null };

type UmamiCoreStats = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison?: {
    pageviews: number;
    visitors: number;
    visits: number;
    bounces: number;
    totaltime: number;
  } | null;
};

/**
 * appendTraceIdToMessage
 * 将后端返回的 trace_id 拼到提示信息里，便于排查降级/错误。
 */
function appendTraceIdToMessage(message?: string | null, traceId?: string | null): string | null {
  const msg = (message || '').trim();
  const tid = (traceId || '').trim();
  if (!msg && !tid) return null;
  if (!tid) return msg || null;
  if (!msg) return `trace_id: ${tid}`;
  if (msg.includes(tid)) return msg;
  return `${msg} (trace_id: ${tid})`;
}

/**
 * isSameUserEmail
 * 判断两个邮箱是否属于同一用户（忽略大小写与空值）。
 */
function isSameUserEmail(a?: string | null, b?: string | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

/**
 * formatDurationSeconds
 * 将秒数格式化为 hh:mm:ss 或 mm:ss 的可读文本。
 */
function formatDurationSeconds(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

/**
 * calcPercentChange
 * 计算相对变化百分比（prev 为 0 时返回 null）。
 */
function calcPercentChange(current: number, previous: number): number | null {
  const cur = Number.isFinite(current) ? current : 0;
  const prev = Number.isFinite(previous) ? previous : 0;
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

/**
 * formatChangeText
 * 将变化百分比格式化为可展示文本。
 */
function formatChangeText(value: number | null): string {
  if (value === null) return '—';
  const rounded = Math.round(value);
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

function ChangeIndicator({ value, positiveIsGood }: { value: number | null; positiveIsGood: boolean }) {
  if (value === null) return <span className="text-xs text-muted-foreground tabular-nums">—</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <span className="text-xs text-muted-foreground tabular-nums">0%</span>;
  const isUp = rounded > 0;
  const isGood = isUp === positiveIsGood;
  const colorClass = isGood ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
  return (
    <span className={['inline-flex items-center gap-1 text-xs font-medium tabular-nums', colorClass].join(' ')}>
      <i className={[isUp ? 'ri-arrow-up-line' : 'ri-arrow-down-line', 'text-[13px]'].join(' ')} aria-hidden="true" />
      <span>{formatChangeText(Math.abs(rounded)).replace(/^\+/, '')}</span>
    </span>
  );
}

type FeaturedProductsPayload = {
  products: Product[];
  next_refresh_at: string;
};

interface ProductGridProps {
  section: 'featured' | 'recent';
}

/**
 * ProductGrid
 * 首页产品区块：featured 展示 Umami 统计 + 产品卡片，recent 展示最新上架列表。
 */
export default function ProductGrid({ section }: ProductGridProps) {
  const t = useTranslations(`home.${section}`);
  const commonT = useTranslations('common');
  const categoryT = useTranslations('categories');
  const umamiT = useTranslations('home.umamiStats');
  const locale = useLocale();
  const reduceMotion = useReducedMotion();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [umamiStats, setUmamiStats] = useState<UmamiCoreStats | null>(null);
  const [umamiLoading, setUmamiLoading] = useState(false);
  const [umamiMessage, setUmamiMessage] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoritesFromStorage());
  const [likeIds, setLikeIds] = useState<string[]>(() => readLikesFromStorage());
  const [recentDir, setRecentDir] = useState<'desc' | 'asc'>('desc');
  const refetchFeaturedRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchProducts
     * 拉取产品列表（精选/最新），用于首页产品展示。
     */
    async function fetchProducts(silent?: boolean) {
      if (!silent) {
        setLoading(true);
        setListMessage(null);
      }
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
        if (section === 'featured') {
          const response = await fetch(`/api/home/featured?language=${encodeURIComponent(locale)}&limit=10`, {
            headers: { 'Accept-Language': locale },
            cache: 'no-store',
          });
          const json: ApiResponse<FeaturedProductsPayload> = await response.json();
          if (cancelled) return;

          if (!json.success) {
            const isDegraded = json.error?.degraded === true || json.error?.code === 'DB_DEGRADED';
            if (attempt < maxAttempts && (isRetryableMessage(json.message) || isDegraded)) {
              await delay(attempt);
              continue;
            }
            if (!silent) {
              setProducts([]);
              setListMessage(appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null));
              setLoading(false);
            }
            return;
          }

          const rawProducts = json.data?.products ?? [];
          const nextProducts = Array.isArray(rawProducts)
            ? rawProducts.map((p) => ({
                ...p,
                likes: typeof p.likes === 'number' ? p.likes : Number(p.likes ?? 0),
                favorites: typeof p.favorites === 'number' ? p.favorites : Number(p.favorites ?? 0),
              }))
            : [];

          const isDegraded = json.error?.degraded === true || json.error?.code === 'DB_DEGRADED';
          if (nextProducts.length === 0 && attempt < maxAttempts && (isRetryableMessage(json.message) || isDegraded)) {
            await delay(attempt);
            continue;
          }

          setProducts(nextProducts);
          if (!silent) {
            setListMessage(
              nextProducts.length === 0 ? appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null) : null
            );
            setLoading(false);
          }
          return;
        }

        const isRecent = section === 'recent';
        if (isRecent) {
          const response = await fetch(
            `/api/products?status=approved&language=${encodeURIComponent(locale)}&sort=created_at&dir=${encodeURIComponent(
              recentDir
            )}&limit=20&offset=0`,
            { headers: { 'Accept-Language': locale }, cache: 'no-store' }
          );
          const json: ApiResponse<unknown> = await response.json();
          if (cancelled) return;

          if (!json.success) {
            const isDegraded = json.error?.degraded === true || json.error?.code === 'DB_DEGRADED';
            if (attempt < maxAttempts && (isRetryableMessage(json.message) || isDegraded)) {
              await delay(attempt);
              continue;
            }
            setProducts([]);
            setListMessage(appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null));
            setLoading(false);
            return;
          }

          const rawProducts = json.data ?? [];
          const nextProducts = Array.isArray(rawProducts)
            ? rawProducts.map((p) => ({
                ...p,
                likes: typeof p.likes === 'number' ? p.likes : Number(p.likes ?? 0),
                favorites: typeof p.favorites === 'number' ? p.favorites : Number(p.favorites ?? 0),
              }))
            : [];

          const isDegraded = json.error?.degraded === true || json.error?.code === 'DB_DEGRADED';
          if (nextProducts.length === 0 && attempt < maxAttempts && (isRetryableMessage(json.message) || isDegraded)) {
            await delay(attempt);
            continue;
          }

          setProducts(nextProducts);
          setListMessage(
            nextProducts.length === 0 ? appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null) : null
          );
          setLoading(false);
          return;
        }

        const fetchWithOffset = async (nextOffset: number) => {
          const response = await fetch(
            `/api/products?status=approved&language=${locale}&limit=10&offset=${nextOffset}`,
            { headers: { 'Accept-Language': locale }, cache: 'no-store' }
          );
          const json: ApiResponse<unknown> = await response.json();
          const rawProducts = json.success ? (json.data ?? []) : [];
          const nextProducts = Array.isArray(rawProducts)
            ? rawProducts.map((p) => ({
                ...p,
                likes: typeof p.likes === 'number' ? p.likes : Number(p.likes ?? 0),
                favorites: typeof p.favorites === 'number' ? p.favorites : Number(p.favorites ?? 0),
              }))
            : [];
          return nextProducts as Product[];
        };

        const nextProducts = await fetchWithOffset(0);

        if (cancelled) return;
        setProducts(nextProducts);
        setListMessage(null);
        setLoading(false);
        return;
      } catch {
        if (attempt < maxAttempts) {
          await delay(attempt);
          continue;
        }
        if (!cancelled && !silent) {
          setProducts([]);
          setListMessage(null);
          setLoading(false);
        }
        return;
      }
      }
    }

    refetchFeaturedRef.current = section === 'featured' ? () => void fetchProducts(true) : null;

    void fetchProducts();

    let timer: ReturnType<typeof setInterval> | null = null;
    if (section === 'featured') {
      timer = setInterval(() => {
        if (!cancelled) void fetchProducts(true);
      }, 15_000);
    }

    return () => {
      cancelled = true;
      refetchFeaturedRef.current = null;
      if (timer) clearInterval(timer);
    };
  }, [locale, recentDir, section]);

  useEffect(() => {
    const onUpdate = () => setFavoriteIds(readFavoritesFromStorage());
    window.addEventListener('sf_favorites_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_favorites_updated', onUpdate as EventListener);
  }, []);

  useEffect(() => {
    const onUpdate = () => setLikeIds(readLikesFromStorage());
    window.addEventListener('sf_likes_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_likes_updated', onUpdate as EventListener);
  }, []);

  useEffect(() => {
    if (section !== 'featured') return;
    let cancelled = false;

    /**
     * fetchUmamiStats
     * 拉取 Umami 核心统计数据，用于首页展示。
     */
    async function fetchUmamiStats() {
      setUmamiLoading(true);
      setUmamiMessage(null);
      try {
        const response = await fetch(`/api/umami/core-stats?range=90d`, { headers: { 'Accept-Language': locale }, cache: 'no-store' });
        const json: ApiResponse<UmamiCoreStats> = await response.json();
        if (cancelled) return;
        if (!json.success) {
          setUmamiStats(null);
          setUmamiMessage(json.message || null);
          return;
        }
        setUmamiStats(json.data ?? null);
      } catch {
        if (!cancelled) {
          setUmamiStats(null);
          setUmamiMessage(null);
        }
      } finally {
        if (!cancelled) setUmamiLoading(false);
      }
    }

    fetchUmamiStats();

    return () => {
      cancelled = true;
    };
  }, [locale, section]);

  const adjustProductCount = (productId: string, field: 'likes' | 'favorites', delta: number) => {
    setProducts((cur) => {
      const next = cur.map((p) => {
        if (p.id !== productId) return p;
        const nextValue = Math.max(0, (p[field] ?? 0) + delta);
        return { ...p, [field]: nextValue };
      });
      if (section !== 'featured') return next;
      return sortProductsByPopularity(next);
    });
  };

  /**
   * toggleFavorite
   * 收藏/取消收藏作品（本地乐观更新 + 后端写入）。
   */
  const toggleFavorite = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }
    const product = products.find((p) => p.id === normalizedId);
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
      } else {
        refetchFeaturedRef.current?.();
      }
    } catch {
      setFavoriteIds(prev);
      writeFavoritesToStorage(prev);
      adjustProductCount(normalizedId, 'favorites', -delta);
    }
  };

  /**
   * toggleLike
   * 点赞/取消点赞作品（本地乐观更新 + 后端写入）。
   */
  const toggleLike = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }
    const product = products.find((p) => p.id === normalizedId);
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
      } else {
        refetchFeaturedRef.current?.();
      }
    } catch {
      setLikeIds(prev);
      writeLikesToStorage(prev);
      adjustProductCount(normalizedId, 'likes', -delta);
    }
  };

  if (section === 'recent') {
    return (
      <div className="animate-on-scroll">
        <div className="flex items-end justify-between gap-6 mb-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{t('title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRecentDir('desc')}
              className={[
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                recentDir === 'desc'
                  ? 'border-primary/20 bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              {t('sortNewest')}
            </button>
            <button
              type="button"
              onClick={() => setRecentDir('asc')}
              className={[
                'rounded-md border px-3 py-1.5 text-xs transition-colors',
                recentDir === 'asc'
                  ? 'border-primary/20 bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent',
              ].join(' ')}
            >
              {t('sortOldest')}
            </button>
            <Link
              href="/products"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {commonT('viewMore')}
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card animate-in fade-in-0 duration-300 animate-pulse">
            <div className="px-5 py-4 border-b border-border">
              <div className="h-4 w-32 bg-muted rounded" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: 15 }).map((_, idx) => (
                <div key={idx} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 shrink-0 bg-muted rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <div className="h-4 w-56 bg-muted rounded" />
                    <div className="mt-2 h-4 w-full bg-muted rounded" />
                    <div className="mt-3 h-3 w-28 bg-muted rounded" />
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <div className="w-8 h-8 bg-muted rounded-md" />
                    <div className="w-8 h-8 bg-muted rounded-md" />
                    <div className="w-8 h-8 bg-muted rounded-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : products.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground animate-in fade-in-0 duration-300">
            {listMessage || t('empty')}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
              <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
            </div>
            <div className="divide-y divide-border">
              {products.map((p) => {
                const selfActionDisabled = isSameUserEmail(p.maker_email ?? null, getAuthenticatedUserEmail());
                return (
                <div key={p.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    {p.logo_url ? (
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
                      <Badge variant="secondary" className="shrink-0">
                        {categoryT(p.category)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground line-clamp-1">
                      <SloganText value={p.slogan} />
                    </div>
                  </div>

                  <div className="shrink-0 flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        aria-label={favoriteIds.includes(p.id) ? '取消收藏' : '收藏'}
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
                          key={favoriteIds.includes(p.id) ? 'favorited' : 'unfavorited'}
                          className={[
                            `${favoriteIds.includes(p.id) ? 'ri-heart-3-fill' : 'ri-heart-3-line'} text-base transition-all duration-200`,
                            favoriteIds.includes(p.id)
                              ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                              : 'text-muted-foreground',
                          ].join(' ')}
                          aria-hidden="true"
                        />
                      </button>
                      <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">
                        {p.favorites}
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        aria-label={likeIds.includes(p.id) ? '取消点赞' : '点赞'}
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
                          key={likeIds.includes(p.id) ? 'liked' : 'unliked'}
                          className={[
                            `${likeIds.includes(p.id) ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-base transition-all duration-200`,
                            likeIds.includes(p.id)
                              ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                              : 'text-muted-foreground',
                          ].join(' ')}
                          aria-hidden="true"
                        />
                      </button>
                      <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{p.likes}</span>
                    </div>
                    {p.website ? (
                      <a
                        href={p.website}
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
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-6 text-center sm:hidden">
          <Link
            href="/products"
            className="inline-flex items-center px-6 py-3 border border-border text-base font-medium rounded-md text-foreground bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            {commonT('viewMore')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-on-scroll">
      <div className="mb-12 space-y-6">
        {section === 'featured' ? (
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-foreground">{umamiT('title')}</div>
              <div className="text-xs text-muted-foreground">{umamiT('subtitle')}</div>
            </div>
            {umamiLoading ? (
              <div className="mt-4 text-sm text-muted-foreground">{umamiT('loading')}</div>
            ) : !umamiStats ? (
              <div className="mt-4 text-sm text-muted-foreground">{umamiMessage || umamiT('empty')}</div>
            ) : (
              (() => {
                const prev = umamiStats.comparison ?? null;
                const bounceRate = umamiStats.visits > 0 ? (umamiStats.bounces / umamiStats.visits) * 100 : 0;
                const avgVisitSeconds = umamiStats.visits > 0 ? umamiStats.totaltime / umamiStats.visits : 0;
                const prevBounceRate =
                  prev && prev.visits > 0 ? (prev.bounces / prev.visits) * 100 : prev ? 0 : null;
                const prevAvgVisitSeconds = prev && prev.visits > 0 ? prev.totaltime / prev.visits : prev ? 0 : null;
                const pageviewsChange = prev ? calcPercentChange(umamiStats.pageviews, prev.pageviews) : null;
                const visitorsChange = prev ? calcPercentChange(umamiStats.visitors, prev.visitors) : null;
                const bounceRateChange =
                  prevBounceRate === null ? null : calcPercentChange(bounceRate, prevBounceRate);
                const avgVisitSecondsChange =
                  prevAvgVisitSeconds === null ? null : calcPercentChange(avgVisitSeconds, prevAvgVisitSeconds);

                return (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="rounded-xl border border-border bg-background px-4 py-4">
                      <div className="text-xs text-muted-foreground">{umamiT('visitors')}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <div className="text-lg font-semibold text-foreground tabular-nums">
                          {umamiStats.visitors.toLocaleString(locale)}
                        </div>
                        <ChangeIndicator value={visitorsChange} positiveIsGood />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-background px-4 py-4">
                      <div className="text-xs text-muted-foreground">{umamiT('pageviews')}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <div className="text-lg font-semibold text-foreground tabular-nums">
                          {umamiStats.pageviews.toLocaleString(locale)}
                        </div>
                        <ChangeIndicator value={pageviewsChange} positiveIsGood />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-background px-4 py-4">
                      <div className="text-xs text-muted-foreground">{umamiT('bounceRate')}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <div className="text-lg font-semibold text-foreground tabular-nums">
                          {Math.round(bounceRate)}%
                        </div>
                        <ChangeIndicator value={bounceRateChange} positiveIsGood={false} />
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-background px-4 py-4">
                      <div className="text-xs text-muted-foreground">{umamiT('avgVisitDuration')}</div>
                      <div className="mt-1 flex items-end justify-between gap-2">
                        <div className="text-lg font-semibold text-foreground tabular-nums">
                          {formatDurationSeconds(avgVisitSeconds)}
                        </div>
                        <ChangeIndicator value={avgVisitSecondsChange} positiveIsGood />
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        ) : null}

        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight">{t('title')}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>{t('subtitle')}</span>
            </div>
          </div>
          <div className="hidden sm:flex items-end gap-3">
            <Link
              href="/products"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {commonT('viewMore')}
            </Link>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card animate-in fade-in-0 duration-300 animate-pulse">
          <div className="px-5 py-4 border-b border-border">
            <div className="h-4 w-32 bg-muted rounded" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="px-5 py-4 flex items-center gap-4">
                <div className="w-10 h-10 shrink-0 bg-muted rounded-lg" />
                <div className="min-w-0 flex-1">
                  <div className="h-4 w-56 bg-muted rounded" />
                  <div className="mt-2 h-4 w-full bg-muted rounded" />
                  <div className="mt-3 h-3 w-28 bg-muted rounded" />
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <div className="w-8 h-8 bg-muted rounded-md" />
                  <div className="w-8 h-8 bg-muted rounded-md" />
                  <div className="w-8 h-8 bg-muted rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : products.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground animate-in fade-in-0 duration-300">
          {listMessage || t('empty')}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
            <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
          </div>
          <LayoutGroup id="featured-ranking">
            <motion.div layout initial={false} className="divide-y divide-border">
              {products.map((p) => {
                const selfActionDisabled = isSameUserEmail(p.maker_email ?? null, getAuthenticatedUserEmail());
                return (
                  <motion.div
                    key={p.id}
                    layout
                    transition={
                      reduceMotion
                        ? { duration: 0 }
                        : {
                            type: 'spring',
                            stiffness: 520,
                            damping: 44,
                            mass: 0.9,
                          }
                    }
                    className="px-5 py-4 flex items-center gap-4"
                  >
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    {p.logo_url ? (
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
                      <Badge variant="secondary" className="shrink-0">
                        {categoryT(p.category)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground line-clamp-1">
                      <SloganText value={p.slogan} />
                    </div>
                  </div>

                  <div className="shrink-0 flex items-start gap-3">
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        aria-label={favoriteIds.includes(p.id) ? '取消收藏' : '收藏'}
                        disabled={selfActionDisabled}
                        onClick={() => void toggleFavorite(p.id)}
                        className={[
                          'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background transition-all duration-200 active:scale-95',
                          selfActionDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:text-accent-foreground',
                        ].join(' ')}
                      >
                        <i
                          key={favoriteIds.includes(p.id) ? 'favorited' : 'unfavorited'}
                          className={[
                            `${favoriteIds.includes(p.id) ? 'ri-heart-3-fill' : 'ri-heart-3-line'} text-base transition-all duration-200`,
                            favoriteIds.includes(p.id)
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
                        aria-label={likeIds.includes(p.id) ? '取消点赞' : '点赞'}
                        disabled={selfActionDisabled}
                        onClick={() => void toggleLike(p.id)}
                        className={[
                          'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background transition-all duration-200 active:scale-95',
                          selfActionDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-accent hover:text-accent-foreground',
                        ].join(' ')}
                      >
                        <i
                          key={likeIds.includes(p.id) ? 'liked' : 'unliked'}
                          className={[
                            `${likeIds.includes(p.id) ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-base transition-all duration-200`,
                            likeIds.includes(p.id)
                              ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                              : 'text-muted-foreground',
                          ].join(' ')}
                          aria-hidden="true"
                        />
                      </button>
                      <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{p.likes}</span>
                    </div>
                    {p.website ? (
                      <a
                        href={p.website}
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
                  </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </LayoutGroup>
        </div>
      )}

      <div className="mt-6 text-center sm:hidden">
        <Link
          href="/products"
          className="inline-flex items-center px-6 py-3 border border-border text-base font-medium rounded-md text-foreground bg-background hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {commonT('viewMore')}
        </Link>
      </div>
    </div>
  );
}
