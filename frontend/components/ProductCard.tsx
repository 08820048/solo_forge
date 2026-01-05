'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';

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
  website: string;
  likes: number;
  favorites: number;
}

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations('categories');
  const [favorited, setFavorited] = useState(() => readFavoritesFromStorage().includes(product.id));
  const [liked, setLiked] = useState(() => readLikesFromStorage().includes(product.id));
  const [favoriteCount, setFavoriteCount] = useState(() => product.favorites ?? 0);
  const [likeCount, setLikeCount] = useState(() => product.likes ?? 0);

  const toggleFavorite = async () => {
    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      requestAuth('/');
      return;
    }

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
      requestAuth('/');
      return;
    }

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
      <Card className="h-full bg-card/70 backdrop-blur-sm border-border hover:bg-card transition-all duration-300 hover:shadow-2xl hover:shadow-black/5 spotlight-group">
        <CardContent className="p-6 flex flex-col h-full relative overflow-hidden">
          {/* Background lines */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-4 top-0 w-px h-full bg-foreground/5"></div>
            <div className="absolute left-1/2 top-0 w-px h-full bg-foreground/5"></div>
            <div className="absolute left-3/4 top-0 w-px h-full bg-foreground/5"></div>
          </div>

          <div className="absolute right-4 top-4 z-20 flex items-start gap-3">
            <div className="flex flex-col items-center">
              <button
                type="button"
                aria-label={liked ? '取消点赞' : '点赞'}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleLike();
                }}
                className="rounded-full w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
              >
                <i
                  key={liked ? 'liked' : 'unliked'}
                  className={[
                    `${liked ? 'ri-thumb-up-fill' : 'ri-thumb-up-line'} text-base transition-all duration-200`,
                    liked ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]' : 'text-muted-foreground',
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
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void toggleFavorite();
                }}
                className="rounded-full w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
              >
                <i
                  key={favorited ? 'favorited' : 'unfavorited'}
                  className={[
                    `${favorited ? 'ri-heart-3-fill' : 'ri-heart-3-line'} text-base transition-all duration-200`,
                    favorited ? 'text-primary scale-110 animate-[sf-scale-in_0.18s_ease-out_forwards]' : 'text-muted-foreground',
                  ].join(' ')}
                  aria-hidden="true"
                />
              </button>
              <span className="mt-1 text-[10px] leading-none text-muted-foreground tabular-nums">{favoriteCount}</span>
            </div>
          </div>

          {/* Logo */}
          <div className="relative z-10 w-16 h-16 bg-secondary rounded-lg mb-4 flex items-center justify-center transition-all duration-300 group-hover:opacity-90 spotlight-border">
            <span className="text-secondary-foreground text-2xl font-bold font-sans">
              {product.name.charAt(0)}
            </span>
          </div>

          {/* Content */}
          <div className="relative z-10 flex-1">
            <h3 className="text-xl font-semibold text-foreground mb-2 font-sans tracking-tight">
              {product.name}
            </h3>
            <p className="text-muted-foreground mb-4 line-clamp-2 font-sans">
              {product.slogan}
            </p>
          </div>

          {/* Footer */}
          <div className="relative z-10 flex items-center justify-between pt-4 border-t border-border">
            <span className="text-sm text-muted-foreground font-sans">
              by {product.maker_name}
            </span>
            <Badge variant="secondary">
              {t(product.category)}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
