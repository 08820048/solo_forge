'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState, type MouseEvent } from 'react';
import { isKnownRemoteImageUrl, plainTextFromMarkdown } from '@/lib/utils';

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
 * isSameUserEmail
 * 判断两个邮箱是否属于同一用户（忽略大小写与空值）。
 */
function isSameUserEmail(a?: string | null, b?: string | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

type DeveloperProfile = {
  email: string;
  name: string;
  avatar_url?: string | null;
  sponsor_role?: string | null;
  sponsor_verified?: boolean;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

const developerProfileCache = new Map<string, DeveloperProfile | null>();
const developerProfileInflight = new Map<string, Promise<DeveloperProfile | null>>();

function getCurrentUserAvatarOverride(email: string, fallbackAvatarUrl?: string | null): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return fallbackAvatarUrl ?? null;
    const parsed = JSON.parse(raw) as { email?: string; avatarUrl?: string } | null;
    const storedEmail = (parsed?.email || '').trim().toLowerCase();
    const avatarUrl = (parsed?.avatarUrl || '').trim();
    if (!storedEmail || storedEmail !== email.trim().toLowerCase()) return fallbackAvatarUrl ?? null;
    return avatarUrl || fallbackAvatarUrl || null;
  } catch {
    return fallbackAvatarUrl ?? null;
  }
}

async function fetchDeveloperProfile(email: string): Promise<DeveloperProfile | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  if (developerProfileCache.has(normalized)) return developerProfileCache.get(normalized) ?? null;
  const inflight = developerProfileInflight.get(normalized);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      const response = await fetch(`/api/developers?email=${encodeURIComponent(normalized)}`);
      const json = (await response.json().catch(() => null)) as ApiResponse<DeveloperProfile> | null;
      const profile = response.ok && json?.success ? (json.data ?? null) : null;
      developerProfileCache.set(normalized, profile);
      return profile;
    } catch {
      developerProfileCache.set(normalized, null);
      return null;
    } finally {
      developerProfileInflight.delete(normalized);
    }
  })();

  developerProfileInflight.set(normalized, promise);
  return promise;
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
  maker_sponsor_role?: string | null;
  maker_sponsor_verified?: boolean;
}

interface ProductCardProps {
  product: Product;
  variant?: 'homeFeatured' | 'productsList';
}

/**
 * SloganText
 * 在产品卡片里以纯文本展示 slogan，降低 Markdown 渲染成本。
 */
function SloganText({ value }: { value: string }) {
  return <span>{plainTextFromMarkdown(value)}</span>;
}

export default function ProductCard({ product, variant = 'homeFeatured' }: ProductCardProps) {
  const t = useTranslations('categories');
  const commonT = useTranslations('common');
  const router = useRouter();
  const [favorited, setFavorited] = useState(() => readFavoritesFromStorage().includes(product.id));
  const [liked, setLiked] = useState(() => readLikesFromStorage().includes(product.id));
  const [favoriteCount, setFavoriteCount] = useState(() => product.favorites ?? 0);
  const [likeCount, setLikeCount] = useState(() => product.likes ?? 0);
  const [makerProfile, setMakerProfile] = useState<DeveloperProfile | null>(null);
  const currentUserEmail = getAuthenticatedUserEmail();
  const selfActionDisabled = isSameUserEmail(product.maker_email ?? null, currentUserEmail);
  const websiteUrl = (product.website || '').trim();
  const hasWebsite = Boolean(websiteUrl);
  const isProductsList = variant === 'productsList';
  const makerEmail = (product.maker_email || '').trim().toLowerCase();

  useEffect(() => {
    if (!isProductsList) return;
    if (!makerEmail) return;
    let cancelled = false;
    void fetchDeveloperProfile(makerEmail).then((profile) => {
      if (cancelled) return;
      setMakerProfile(profile);
    });
    return () => {
      cancelled = true;
    };
  }, [isProductsList, makerEmail]);

  const makerDisplayName = (makerProfile?.name || product.maker_name || makerEmail || '').trim();
  const makerAvatarUrl = makerEmail ? getCurrentUserAvatarOverride(makerEmail, makerProfile?.avatar_url ?? null) : null;
  const makerInitial = (makerDisplayName || makerEmail || 'U').trim().slice(0, 1).toUpperCase();
  const sponsorVerified = Boolean(makerProfile?.sponsor_verified ?? product.maker_sponsor_verified);
  const sponsorRole = String(makerProfile?.sponsor_role ?? product.maker_sponsor_role ?? '').trim();
  const sponsorBadgeText = sponsorRole ? `${commonT('sponsorBadge')} · ${sponsorRole}` : commonT('sponsorBadge');

  const openMakerProfile = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!makerEmail) return;
    router.push({ pathname: '/makers/[email]', params: { email: makerEmail } });
  };

  const toggleFavorite = async () => {
    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }
    if (isSameUserEmail(product.maker_email ?? null, userEmail)) return;

    const ids = readFavoritesFromStorage();
    const set = new Set(ids);
    const prev = favorited;
    if (set.has(product.id)) {
      set.delete(product.id);
      setFavorited(false);
    } else {
      set.add(product.id);
      setFavorited(true);
    }
    writeFavoritesToStorage(Array.from(set));
    const delta = prev ? -1 : 1;
    setFavoriteCount((cur) => Math.max(0, cur + delta));

    try {
      const action = prev ? 'unfavorite' : 'favorite';
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          product_id: product.id,
          user_id: userEmail,
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFavorited(prev);
        setFavoriteCount((cur) => Math.max(0, cur - delta));
        if (prev) set.add(product.id);
        else set.delete(product.id);
        writeFavoritesToStorage(Array.from(set));
      }
    } catch {
      setFavorited(prev);
      setFavoriteCount((cur) => Math.max(0, cur - delta));
      if (prev) set.add(product.id);
      else set.delete(product.id);
      writeFavoritesToStorage(Array.from(set));
    }
  };

  const toggleLike = async () => {
    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      notify(commonT('loginRequiredAction'));
      return;
    }
    if (isSameUserEmail(product.maker_email ?? null, userEmail)) return;

    const ids = readLikesFromStorage();
    const set = new Set(ids);
    const prev = liked;
    if (set.has(product.id)) {
      set.delete(product.id);
      setLiked(false);
    } else {
      set.add(product.id);
      setLiked(true);
    }
    writeLikesToStorage(Array.from(set));
    const delta = prev ? -1 : 1;
    setLikeCount((cur) => Math.max(0, cur + delta));

    try {
      const action = prev ? 'unlike' : 'like';
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          product_id: product.id,
          user_id: userEmail,
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setLiked(prev);
        setLikeCount((cur) => Math.max(0, cur - delta));
        if (prev) set.add(product.id);
        else set.delete(product.id);
        writeLikesToStorage(Array.from(set));
      }
    } catch {
      setLiked(prev);
      setLikeCount((cur) => Math.max(0, cur - delta));
      if (prev) set.add(product.id);
      else set.delete(product.id);
      writeLikesToStorage(Array.from(set));
    }
  };

  return (
    <Link
      href={{ pathname: '/products/[slug]', params: { slug: product.id } }}
      className="group"
    >
      <Card className="h-full bg-card border-border hover:bg-card transition-colors duration-200 hover:shadow-sm">
        <CardContent className="p-5 sm:p-6 flex flex-col h-full relative overflow-hidden">
          <div className="absolute right-3 top-3 sm:right-4 sm:top-4 z-20 flex items-start gap-3">
            <div className="flex flex-col items-center">
              <button
                type="button"
                aria-label={liked ? '取消点赞' : '点赞'}
                disabled={selfActionDisabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleLike();
                }}
                className={[
                  'rounded-full w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center border border-border bg-background transition-colors duration-200 active:scale-95',
                  selfActionDisabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                <i
                  key={liked ? 'liked' : 'unliked'}
                  className={[
                    `${liked ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-[15px] sm:text-base transition-all duration-200`,
                    liked
                      ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                      : 'text-muted-foreground',
                  ].join(' ')}
                  aria-hidden="true"
                />
              </button>
              <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{likeCount}</span>
            </div>
            <div className="flex flex-col items-center">
              <button
                type="button"
                aria-label={favorited ? '取消收藏' : '收藏'}
                disabled={selfActionDisabled}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleFavorite();
                }}
                className={[
                  'rounded-full w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center border border-border bg-background transition-colors duration-200 active:scale-95',
                  selfActionDisabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-accent hover:text-accent-foreground',
                ].join(' ')}
              >
                <i
                  key={favorited ? 'favorited' : 'unfavorited'}
                  className={[
                    `${favorited ? 'ri-heart-3-fill' : 'ri-heart-3-line'} text-[15px] sm:text-base transition-all duration-200`,
                    favorited
                      ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]'
                      : 'text-muted-foreground',
                  ].join(' ')}
                  aria-hidden="true"
                />
              </button>
              <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{favoriteCount}</span>
            </div>
            <div className="flex flex-col items-center">
              {hasWebsite ? (
                <button
                  type="button"
                  aria-label="访问官网"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                      window.open(websiteUrl, '_blank', 'noopener,noreferrer');
                    } catch {}
                  }}
                  className="rounded-full w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center border border-border bg-background hover:bg-accent hover:text-accent-foreground transition-colors duration-200 active:scale-95"
                >
                  <i className="ri-global-line text-[15px] sm:text-base" aria-hidden="true" />
                </button>
              ) : (
                <span className="rounded-full w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center border border-border bg-background text-muted-foreground">
                  <i className="ri-global-line text-[15px] sm:text-base" aria-hidden="true" />
                </span>
              )}
              <span className="mt-1 text-[10px] leading-none text-transparent select-none">0</span>
            </div>
          </div>

          <div className="relative z-10 w-14 h-14 sm:w-16 sm:h-16 bg-secondary rounded-lg mb-3 sm:mb-4 flex items-center justify-center overflow-hidden">
            {product.logo_url ? (
              isKnownRemoteImageUrl(product.logo_url) ? (
                <Image
                  src={product.logo_url}
                  alt={product.name}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Image
                  src={product.logo_url}
                  alt={product.name}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  unoptimized
                  loader={({ src }) => src}
                />
              )
            ) : (
              <span className="text-secondary-foreground text-xl sm:text-2xl font-bold font-sans">
                {product.name.trim().charAt(0).toUpperCase()}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="relative z-10 flex-1">
            <div className="flex items-start gap-3 mb-2">
              <h3 className="min-w-0 flex-1 text-lg sm:text-xl font-semibold text-foreground font-sans tracking-tight truncate">
                {product.name}
              </h3>
              {!isProductsList ? (
                <Badge variant="secondary" className="shrink-0">
                  {t(product.category)}
                </Badge>
              ) : null}
            </div>
            <p className="text-muted-foreground mb-3 sm:mb-4 line-clamp-2 font-sans">
              <SloganText value={product.slogan} />
            </p>
          </div>

          {/* Footer */}
          {isProductsList ? (
            <div className="relative z-10 flex items-center justify-between pt-4 border-t border-border">
              <button
                type="button"
                onClick={openMakerProfile}
                disabled={!makerEmail}
                aria-label={makerDisplayName || makerEmail || 'maker'}
                className={[
                  'flex items-center gap-2 min-w-0 text-left',
                  makerEmail ? 'hover:opacity-90 transition-opacity' : 'opacity-70 cursor-not-allowed',
                ].join(' ')}
              >
                <div className="w-7 h-7 shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden text-[10px] font-semibold text-muted-foreground">
                  {makerAvatarUrl ? (
                    isKnownRemoteImageUrl(makerAvatarUrl) ? (
                      <Image
                        src={makerAvatarUrl}
                        alt={makerDisplayName || makerEmail}
                        width={28}
                        height={28}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Image
                        src={makerAvatarUrl}
                        alt={makerDisplayName || makerEmail}
                        width={28}
                        height={28}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        unoptimized
                        loader={({ src }) => src}
                      />
                    )
                  ) : (
                    makerInitial
                  )}
                </div>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm text-muted-foreground font-sans truncate">{makerDisplayName || makerEmail}</span>
                  {sponsorVerified ? (
                    <Badge variant="secondary" className="shrink-0 h-5 px-1.5 text-[10px]">
                      {sponsorBadgeText}
                    </Badge>
                  ) : null}
                </div>
              </button>
              <Badge variant="secondary">{t(product.category)}</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </Link>
  );
}
