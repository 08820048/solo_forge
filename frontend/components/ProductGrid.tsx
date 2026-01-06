'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useEffect, useState } from 'react';
import ProductCard from './ProductCard';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

/**
 * requestAuth
 * 触发全局登录弹窗，并记录登录后回跳路径。
 */
function requestAuth(redirectPath: string) {
  try {
    sessionStorage.setItem('sf_post_login_redirect', redirectPath);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('sf_require_auth', { detail: { redirectPath } }));
  } catch {
    window.dispatchEvent(new Event('sf_require_auth'));
  }
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

type DeveloperWithFollowers = {
  email: string;
  name: string;
  avatar_url?: string | null;
  website?: string | null;
  followers: number;
};

type ApiError = {
  code: string;
  trace_id: string;
  degraded: boolean;
  hint?: string | null;
  detail?: string | null;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string; error?: ApiError | null };

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

type FeaturedProductsPayload = {
  products: Product[];
  next_refresh_at: string;
};

interface ProductGridProps {
  section: 'featured' | 'recent';
}

/**
 * ProductGrid
 * 首页产品区块：featured 展示「潜力新星」+ 产品卡片，recent 展示最新上架列表。
 */
export default function ProductGrid({ section }: ProductGridProps) {
  const t = useTranslations(`home.${section}`);
  const commonT = useTranslations('common');
  const categoryT = useTranslations('categories');
  const devT = useTranslations('home.risingStars');
  const locale = useLocale();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [listMessage, setListMessage] = useState<string | null>(null);
  const [risingStars, setRisingStars] = useState<DeveloperWithFollowers[]>([]);
  const [risingStarsLoading, setRisingStarsLoading] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoritesFromStorage());
  const [likeIds, setLikeIds] = useState<string[]>(() => readLikesFromStorage());
  const [developersVersion, setDevelopersVersion] = useState(0);
  const [nextRefreshAt, setNextRefreshAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [recentDir, setRecentDir] = useState<'desc' | 'asc'>('desc');

  const countdown = (() => {
    if (!nextRefreshAt) return null;
    const target = Date.parse(nextRefreshAt);
    if (!Number.isFinite(target)) return null;
    const diff = Math.max(0, target - nowMs);
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  })();

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchProducts
     * 拉取产品列表（精选/最新），用于首页产品展示。
     */
    async function fetchProducts() {
      setLoading(true);
      setListMessage(null);
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
          const response = await fetch(`/api/home/featured?language=${encodeURIComponent(locale)}`, {
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
            setProducts([]);
            setListMessage(appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null));
            setNextRefreshAt(null);
            setLoading(false);
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
          setListMessage(
            nextProducts.length === 0 ? appendTraceIdToMessage(json.message ?? null, json.error?.trace_id ?? null) : null
          );
          setNextRefreshAt(json.data?.next_refresh_at ?? null);
          setLoading(false);
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
            setNextRefreshAt(null);
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
          setNextRefreshAt(null);
          setLoading(false);
          return;
        }

        const fetchWithOffset = async (nextOffset: number) => {
          const response = await fetch(
            `/api/products?status=approved&language=${locale}&limit=6&offset=${nextOffset}`,
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
        setNextRefreshAt(null);
        setLoading(false);
        return;
      } catch {
        if (attempt < maxAttempts) {
          await delay(attempt);
          continue;
        }
        if (!cancelled) {
          setProducts([]);
          setListMessage(null);
          setNextRefreshAt(null);
          setLoading(false);
        }
        return;
      }
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [locale, recentDir, section]);

  useEffect(() => {
    if (section !== 'featured') return;
    if (!nextRefreshAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextRefreshAt, section]);

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
    const onDevelopersUpdated = () => setDevelopersVersion((v) => v + 1);
    window.addEventListener('sf_developers_updated', onDevelopersUpdated as EventListener);
    return () => window.removeEventListener('sf_developers_updated', onDevelopersUpdated as EventListener);
  }, []);

  useEffect(() => {
    if (section !== 'featured') return;
    let cancelled = false;

    /**
     * fetchRisingStars
     * 拉取最近加入的开发者（前 4 位），用于「潜力新星」模块。
     */
    async function fetchRisingStars() {
      setRisingStarsLoading(true);
      try {
        const response = await fetch(`/api/developers?kind=recent&limit=4`, { headers: { 'Accept-Language': locale } });
        const json: ApiResponse<DeveloperWithFollowers[]> = await response.json();
        if (cancelled) return;
        setRisingStars(json.success ? (json.data ?? []) : []);
      } catch {
        if (!cancelled) setRisingStars([]);
      } finally {
        if (!cancelled) setRisingStarsLoading(false);
      }
    }

    fetchRisingStars();

    return () => {
      cancelled = true;
    };
  }, [developersVersion, locale, section]);

  const adjustProductCount = (productId: string, field: 'likes' | 'favorites', delta: number) => {
    setProducts((cur) =>
      cur.map((p) => {
        if (p.id !== productId) return p;
        const nextValue = Math.max(0, (p[field] ?? 0) + delta);
        return { ...p, [field]: nextValue };
      })
    );
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
      requestAuth('/');
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
      requestAuth('/');
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
      }
    } catch {
      setLikeIds(prev);
      writeLikesToStorage(prev);
      adjustProductCount(normalizedId, 'likes', -delta);
    }
  };

  if (section === 'recent') {
    return (
      <div>
        <div className="flex items-end justify-between gap-6 mb-6">
          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight">{t('title')}</h2>
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
                  : 'border-border bg-background/70 text-muted-foreground hover:text-foreground hover:bg-accent',
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
                  : 'border-border bg-background/70 text-muted-foreground hover:text-foreground hover:bg-accent',
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
          <div className="sf-wash rounded-xl border border-border bg-card/50">
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
          <div className="py-20 text-center text-muted-foreground">{listMessage || t('empty')}</div>
        ) : (
          <div className="sf-wash rounded-xl border border-border bg-card/50">
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
                      <img
                        src={p.logo_url}
                        alt={p.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
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
                      <SloganMarkdown value={p.slogan} />
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
                          'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 transition-all duration-200 active:scale-95',
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
                          'rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 transition-all duration-200 active:scale-95',
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
                        className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                        aria-label="访问官网"
                      >
                        <i className="ri-global-line text-base" aria-hidden="true" />
                      </a>
                    ) : (
                      <span className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 text-muted-foreground">
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
    <div>
      <div className="mb-12 space-y-6">
        <div className="sf-wash rounded-xl border border-border bg-card/50 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-foreground">{devT('title')}</div>
            <div className="text-xs text-muted-foreground">{devT('subtitle')}</div>
          </div>
          {risingStarsLoading ? (
            <div className="mt-4 text-sm text-muted-foreground">{devT('loading')}</div>
          ) : risingStars.length === 0 ? (
            <div className="mt-4 text-sm text-muted-foreground">{devT('empty')}</div>
          ) : (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {risingStars.map((d) => {
                return (
                <div
                  key={d.email}
                  className="rounded-lg border border-border bg-background/40 px-3 py-3 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    {d.website ? (
                      <a
                        href={d.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 min-w-0 flex-1"
                      >
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden text-sm font-semibold text-muted-foreground">
                          {d.avatar_url ? (
                            <img
                              src={d.avatar_url}
                              alt={d.name || d.email}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            (d.name || d.email).trim().charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{devT('followers', { count: d.followers })}</div>
                        </div>
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center overflow-hidden text-sm font-semibold text-muted-foreground">
                          {d.avatar_url ? (
                            <img
                              src={d.avatar_url}
                              alt={d.name || d.email}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            (d.name || d.email).trim().charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{devT('followers', { count: d.followers })}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight">{t('title')}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground">
              <span>{t('subtitle')}</span>
              {countdown ? (
                <Badge className="shadow-sm">
                  <i className="ri-hourglass-fill" aria-hidden="true" />
                  <span>{t('refreshIn', { time: countdown })}</span>
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3">
            <Link
              href="/products"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {commonT('viewMore')}
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {loading
          ? Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className="sf-wash h-[260px] rounded-xl border border-border bg-card" />
            ))
          : products.length === 0
            ? (
                <div className="col-span-full py-20 text-center text-muted-foreground">
                  {listMessage || t('empty')}
                </div>
              )
            : products.map((product) => <ProductCard key={product.id} product={product} />)}
      </div>

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
