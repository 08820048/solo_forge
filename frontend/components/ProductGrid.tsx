'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { useEffect, useState } from 'react';
import ProductCard from './ProductCard';
import { Badge } from '@/components/ui/badge';

/**
 * readFollowedDevelopersFromStorage
 * 从 localStorage 读取已关注开发者列表（email 数组）。
 */
function readFollowedDevelopersFromStorage(): string[] {
  try {
    const raw = localStorage.getItem('sf_followed_developers');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string') as string[];
  } catch {
    return [];
  }
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
 * writeFollowedDevelopersToStorage
 * 写入已关注开发者列表到 localStorage，并广播更新事件。
 */
function writeFollowedDevelopersToStorage(emails: string[]) {
  try {
    localStorage.setItem('sf_followed_developers', JSON.stringify(emails));
    window.dispatchEvent(new Event('sf_followed_developers_updated'));
  } catch {}
}

/**
 * getInteractionUserId
 * 获取交互用户标识：优先使用登录用户邮箱，否则生成匿名 id。
 */
function getInteractionUserId(): string {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}

  try {
    const existing = localStorage.getItem('sf_anon_id');
    if (existing) return existing;
    const next = `anon_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())}`;
    localStorage.setItem('sf_anon_id', next);
    return next;
  } catch {
    return `anon_${String(Date.now())}`;
  }
}

interface Product {
  id: string;
  name: string;
  slogan: string;
  logo_url?: string;
  category: string;
  maker_name: string;
  website: string;
}

type DeveloperWithFollowers = {
  email: string;
  name: string;
  avatar_url?: string | null;
  website?: string | null;
  followers: number;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

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
  const [risingStars, setRisingStars] = useState<DeveloperWithFollowers[]>([]);
  const [risingStarsLoading, setRisingStarsLoading] = useState(false);
  const [followedDevelopers, setFollowedDevelopers] = useState<string[]>(() => readFollowedDevelopersFromStorage());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() => readFavoritesFromStorage());
  const [likeIds, setLikeIds] = useState<string[]>(() => readLikesFromStorage());

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchProducts
     * 拉取产品列表（精选/最新），用于首页产品展示。
     */
    async function fetchProducts() {
      setLoading(true);
      try {
        const offset = section === 'featured' ? 6 : 0;
        const limit = section === 'recent' ? 15 : 6;
        const response = await fetch(
          `/api/products?status=approved&language=${locale}&limit=${limit}&offset=${offset}`,
          { headers: { 'Accept-Language': locale } }
        );
        const json = await response.json();

        if (!cancelled) {
          setProducts(json.success ? json.data ?? [] : []);
        }
      } catch {
        if (!cancelled) {
          setProducts([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [locale, section]);

  useEffect(() => {
    const onUpdate = () => setFollowedDevelopers(readFollowedDevelopersFromStorage());
    window.addEventListener('sf_followed_developers_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_followed_developers_updated', onUpdate as EventListener);
  }, []);

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
  }, [locale, section]);

  /**
   * toggleFollowDeveloper
   * 关注/取消关注开发者（本地乐观更新 + 后端写入）。
   */
  const toggleFollowDeveloper = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    const prev = followedDevelopers;
    const prevSet = new Set(prev.map((e) => e.toLowerCase()));
    const isFollowing = prevSet.has(normalizedEmail);

    const nextSet = new Set(prevSet);
    if (isFollowing) nextSet.delete(normalizedEmail);
    else nextSet.add(normalizedEmail);

    const next = Array.from(nextSet);
    setFollowedDevelopers(next);
    writeFollowedDevelopersToStorage(next);
    setRisingStars((cur) =>
      cur.map((d) =>
        d.email.toLowerCase() === normalizedEmail
          ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? -1 : 1)) }
          : d
      )
    );

    try {
      const response = await fetch('/api/developers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isFollowing ? 'unfollow' : 'follow',
          email: normalizedEmail,
          user_id: getInteractionUserId(),
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFollowedDevelopers(prev);
        writeFollowedDevelopersToStorage(prev);
        setRisingStars((cur) =>
          cur.map((d) =>
            d.email.toLowerCase() === normalizedEmail
              ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? 1 : -1)) }
              : d
          )
        );
      }
    } catch {
      setFollowedDevelopers(prev);
      writeFollowedDevelopersToStorage(prev);
      setRisingStars((cur) =>
        cur.map((d) =>
          d.email.toLowerCase() === normalizedEmail
            ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? 1 : -1)) }
            : d
        )
      );
    }
  };

  /**
   * toggleFavorite
   * 收藏/取消收藏作品（本地乐观更新 + 后端写入）。
   */
  const toggleFavorite = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const prev = favoriteIds;
    const prevSet = new Set(prev);
    const isFavorited = prevSet.has(normalizedId);

    const nextSet = new Set(prevSet);
    if (isFavorited) nextSet.delete(normalizedId);
    else nextSet.add(normalizedId);

    const next = Array.from(nextSet);
    setFavoriteIds(next);
    writeFavoritesToStorage(next);

    try {
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isFavorited ? 'unfavorite' : 'favorite',
          product_id: normalizedId,
          user_id: getInteractionUserId(),
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFavoriteIds(prev);
        writeFavoritesToStorage(prev);
      }
    } catch {
      setFavoriteIds(prev);
      writeFavoritesToStorage(prev);
    }
  };

  /**
   * toggleLike
   * 点赞/取消点赞作品（本地乐观更新 + 后端写入）。
   */
  const toggleLike = async (productId: string) => {
    const normalizedId = productId.trim();
    if (!normalizedId) return;

    const prev = likeIds;
    const prevSet = new Set(prev);
    const isLiked = prevSet.has(normalizedId);

    const nextSet = new Set(prevSet);
    if (isLiked) nextSet.delete(normalizedId);
    else nextSet.add(normalizedId);

    const next = Array.from(nextSet);
    setLikeIds(next);
    writeLikesToStorage(next);

    try {
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isLiked ? 'unlike' : 'like',
          product_id: normalizedId,
          user_id: getInteractionUserId(),
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setLikeIds(prev);
        writeLikesToStorage(prev);
      }
    } catch {
      setLikeIds(prev);
      writeLikesToStorage(prev);
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
          <div className="hidden sm:flex items-center gap-3">
            <Link
              href="/products"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {commonT('viewMore')}
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border bg-card/50">
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
          <div className="py-20 text-center text-muted-foreground">{t('empty')}</div>
        ) : (
          <div className="rounded-xl border border-border bg-card/50">
            <div className="px-5 py-4 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('title')}</h3>
              <span className="text-xs text-muted-foreground">{t('subtitle')}</span>
            </div>
            <div className="divide-y divide-border">
              {products.map((p) => (
                <div key={p.id} className="px-5 py-4 flex items-center gap-4">
                  <div className="w-10 h-10 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                    {p.logo_url ? (
                      <div
                        className="w-full h-full bg-center bg-cover"
                        style={{ backgroundImage: `url(${p.logo_url})` }}
                        aria-label={p.name}
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
                    <div className="mt-1 text-sm text-muted-foreground line-clamp-1">{p.slogan}</div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={favoriteIds.includes(p.id) ? '取消收藏' : '收藏'}
                      onClick={() => void toggleFavorite(p.id)}
                      className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                    >
                      <i
                        key={favoriteIds.includes(p.id) ? 'favorited' : 'unfavorited'}
                        className={[
                          'ri-heart-3-line text-base transition-all duration-200',
                          favoriteIds.includes(p.id)
                            ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                            : 'text-muted-foreground',
                        ].join(' ')}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      aria-label={likeIds.includes(p.id) ? '取消点赞' : '点赞'}
                      onClick={() => void toggleLike(p.id)}
                      className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                    >
                      <i
                        key={likeIds.includes(p.id) ? 'liked' : 'unliked'}
                        className={[
                          'ri-thumb-up-line text-base transition-all duration-200',
                          likeIds.includes(p.id)
                            ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                            : 'text-muted-foreground',
                        ].join(' ')}
                        aria-hidden="true"
                      />
                    </button>
                    {p.website ? (
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                        aria-label="浏览"
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
              ))}
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
        <div className="rounded-xl border border-border bg-card/50 px-5 py-4">
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
              {risingStars.map((d) => (
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
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                          {(d.name || d.email).trim().charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{devT('followers', { count: d.followers })}</div>
                        </div>
                      </a>
                    ) : (
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                          {(d.name || d.email).trim().charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{devT('followers', { count: d.followers })}</div>
                        </div>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        void toggleFollowDeveloper(d.email);
                      }}
                      className="shrink-0 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                    >
                      <span
                        key={followedDevelopers.map((v) => v.toLowerCase()).includes(d.email.toLowerCase()) ? 'unfollow' : 'follow'}
                        className="inline-block animate-[sf-scale-in_0.18s_ease-out_forwards]"
                      >
                        {followedDevelopers.map((v) => v.toLowerCase()).includes(d.email.toLowerCase()) ? devT('unfollow') : devT('follow')}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight">{t('title')}</h2>
            <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
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
              <div
                key={idx}
                className="h-[260px] rounded-xl border border-border bg-card"
              />
            ))
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
