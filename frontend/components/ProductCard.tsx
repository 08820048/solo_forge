'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Heart, ThumbsUp } from 'lucide-react';
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

interface ProductCardProps {
  product: Product;
}

export default function ProductCard({ product }: ProductCardProps) {
  const t = useTranslations('categories');
  const [favorited, setFavorited] = useState(() => readFavoritesFromStorage().includes(product.id));
  const [liked, setLiked] = useState(() => readLikesFromStorage().includes(product.id));

  const toggleFavorite = async () => {
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

    try {
      const action = prev ? 'unfavorite' : 'favorite';
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          product_id: product.id,
          user_id: getInteractionUserId(),
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFavorited(prev);
        if (prev) set.add(product.id);
        else set.delete(product.id);
        writeFavoritesToStorage(Array.from(set));
      }
    } catch {
      setFavorited(prev);
      if (prev) set.add(product.id);
      else set.delete(product.id);
      writeFavoritesToStorage(Array.from(set));
    }
  };

  const toggleLike = async () => {
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

    try {
      const action = prev ? 'unlike' : 'like';
      const response = await fetch('/api/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          product_id: product.id,
          user_id: getInteractionUserId(),
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setLiked(prev);
        if (prev) set.add(product.id);
        else set.delete(product.id);
        writeLikesToStorage(Array.from(set));
      }
    } catch {
      setLiked(prev);
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

          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            <button
              type="button"
              aria-label={liked ? '取消点赞' : '点赞'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void toggleLike();
              }}
              className="rounded-full w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <ThumbsUp
                size={16}
                strokeWidth={1.5}
                className={liked ? 'text-primary' : 'text-muted-foreground'}
                fill={liked ? 'currentColor' : 'none'}
              />
            </button>
            <button
              type="button"
              aria-label={favorited ? '取消收藏' : '收藏'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void toggleFavorite();
              }}
              className="rounded-full w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Heart
                size={16}
                strokeWidth={1.5}
                className={favorited ? 'text-primary' : 'text-muted-foreground'}
                fill={favorited ? 'currentColor' : 'none'}
              />
            </button>
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
