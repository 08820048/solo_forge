'use client';

import Image from 'next/image';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ProductCard from '@/components/ProductCard';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type DeveloperProfile = {
  email: string;
  name: string;
  avatar_url?: string | null;
  website?: string | null;
  sponsor_role?: string | null;
  sponsor_verified?: boolean;
};

type DeveloperCenterStats = {
  followers: number;
  total_likes: number;
  total_favorites: number;
};

type Product = {
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
};

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

function writeFollowedDevelopersToStorage(emails: string[]) {
  try {
    localStorage.setItem('sf_followed_developers', JSON.stringify(emails));
    window.dispatchEvent(new Event('sf_followed_developers_updated'));
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

function isSameUserEmail(a?: string | null, b?: string | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

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

type TabKey = 'products' | 'favorites';

/**
 * MakerProfilePage
 * 公开开发者主页：展示开发者资料、统计、作品与收藏。
 */
export default function MakerProfilePage({ params }: { params: Promise<{ email: string }> }) {
  const t = useTranslations('makerProfile');
  const navT = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();

  const resolvedParams = React.use(params);

  const targetEmail = useMemo(() => {
    const raw = String(resolvedParams.email || '').trim();
    try {
      return decodeURIComponent(raw).trim().toLowerCase();
    } catch {
      return raw.toLowerCase();
    }
  }, [resolvedParams.email]);

  const [tab, setTab] = useState<TabKey>('products');
  const [profile, setProfile] = useState<DeveloperProfile | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [stats, setStats] = useState<DeveloperCenterStats | null>(null);
  const [statsMessage, setStatsMessage] = useState<string | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsMessage, setProductsMessage] = useState<string | null>(null);
  const [productsLoading, setProductsLoading] = useState(true);

  const [favorites, setFavorites] = useState<Product[]>([]);
  const [favoritesMessage, setFavoritesMessage] = useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = useState(true);

  const [followedDevelopers, setFollowedDevelopers] = useState<string[]>(() => readFollowedDevelopersFromStorage());
  const currentUserEmail = getAuthenticatedUserEmail();

  const isFollowing = useMemo(() => {
    if (!targetEmail) return false;
    return followedDevelopers.map((v) => v.toLowerCase()).includes(targetEmail);
  }, [followedDevelopers, targetEmail]);

  const isSelf = useMemo(() => isSameUserEmail(targetEmail, currentUserEmail), [targetEmail, currentUserEmail]);

  useEffect(() => {
    const onUpdate = () => setFollowedDevelopers(readFollowedDevelopersFromStorage());
    window.addEventListener('sf_followed_developers_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_followed_developers_updated', onUpdate as EventListener);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchProfile() {
      setProfileLoading(true);
      setProfileMessage(null);
      try {
        const response = await fetch(`/api/developers?email=${encodeURIComponent(targetEmail)}`, {
          headers: { 'Accept-Language': locale },
        });
        const json = (await response.json().catch(() => null)) as ApiResponse<DeveloperProfile> | null;
        if (cancelled) return;

        if (!response.ok || !json?.success) {
          setProfile(null);
          setProfileMessage(json?.message || t('notFound'));
          return;
        }
        setProfile(json.data ?? null);
      } catch {
        if (!cancelled) {
          setProfile(null);
          setProfileMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    }

    if (targetEmail) void fetchProfile();
    else {
      setProfile(null);
      setProfileMessage(t('invalidEmail'));
      setProfileLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [locale, t, targetEmail]);

  useEffect(() => {
    let cancelled = false;

    async function fetchStats() {
      setStatsLoading(true);
      setStatsMessage(null);
      try {
        const response = await fetch(`/api/developers?email=${encodeURIComponent(targetEmail)}&kind=center_stats`, {
          headers: { 'Accept-Language': locale },
        });
        const json = (await response.json().catch(() => null)) as ApiResponse<DeveloperCenterStats> | null;
        if (cancelled) return;

        if (!response.ok || !json?.success) {
          setStats(null);
          setStatsMessage(json?.message || null);
          return;
        }
        setStats(json.data ?? { followers: 0, total_likes: 0, total_favorites: 0 });
      } catch {
        if (!cancelled) {
          setStats(null);
          setStatsMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }

    if (targetEmail) void fetchStats();
    else {
      setStats(null);
      setStatsMessage(null);
      setStatsLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [locale, t, targetEmail]);

  useEffect(() => {
    let cancelled = false;

    async function fetchProducts() {
      setProductsLoading(true);
      setProductsMessage(null);
      try {
        const params = new URLSearchParams();
        params.set('maker_email', targetEmail);
        params.set('status', 'approved');
        params.set('limit', '60');
        const response = await fetch(`/api/products?${params.toString()}`, { headers: { 'Accept-Language': locale } });
        const json = (await response.json().catch(() => null)) as ApiResponse<Product[]> | null;
        if (cancelled) return;

        if (!response.ok || !json?.success) {
          setProducts([]);
          setProductsMessage(json?.message || t('productsLoadFailed'));
          return;
        }
        setProducts(json.data ?? []);
      } catch {
        if (!cancelled) {
          setProducts([]);
          setProductsMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }

    if (targetEmail) void fetchProducts();
    else {
      setProducts([]);
      setProductsMessage(null);
      setProductsLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [locale, t, targetEmail]);

  useEffect(() => {
    let cancelled = false;

    async function fetchFavorites() {
      setFavoritesLoading(true);
      setFavoritesMessage(null);
      try {
        const params = new URLSearchParams();
        params.set('user_id', targetEmail);
        params.set('limit', '60');
        params.set('language', locale);
        const response = await fetch(`/api/products/favorites?${params.toString()}`, { headers: { 'Accept-Language': locale } });
        const json = (await response.json().catch(() => null)) as ApiResponse<Product[]> | null;
        if (cancelled) return;

        if (!response.ok || !json?.success) {
          setFavorites([]);
          setFavoritesMessage(json?.message || t('favoritesLoadFailed'));
          return;
        }
        setFavorites(json.data ?? []);
      } catch {
        if (!cancelled) {
          setFavorites([]);
          setFavoritesMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    if (targetEmail) void fetchFavorites();
    else {
      setFavorites([]);
      setFavoritesMessage(null);
      setFavoritesLoading(false);
    }

    return () => {
      cancelled = true;
    };
  }, [locale, t, targetEmail]);

  const toggleFollow = async () => {
    if (!targetEmail || isSelf) return;

    if (!currentUserEmail) {
      requestAuth(window.location.pathname || '/');
      return;
    }

    const prev = followedDevelopers;
    const prevSet = new Set(prev.map((v) => v.toLowerCase()));
    const willFollow = !prevSet.has(targetEmail);

    const nextSet = new Set(prevSet);
    if (willFollow) nextSet.add(targetEmail);
    else nextSet.delete(targetEmail);

    const next = Array.from(nextSet);
    setFollowedDevelopers(next);
    writeFollowedDevelopersToStorage(next);
    setStats((cur) =>
      cur ? { ...cur, followers: Math.max(0, cur.followers + (willFollow ? 1 : -1)) } : cur
    );

    try {
      const response = await fetch('/api/developers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: willFollow ? 'follow' : 'unfollow',
          email: targetEmail,
          user_id: currentUserEmail,
        }),
      });
      const json = (await response.json().catch(() => null)) as { success?: boolean } | null;
      if (!response.ok || !json?.success) {
        setFollowedDevelopers(prev);
        writeFollowedDevelopersToStorage(prev);
        setStats((cur) =>
          cur ? { ...cur, followers: Math.max(0, cur.followers + (willFollow ? -1 : 1)) } : cur
        );
      }
    } catch {
      setFollowedDevelopers(prev);
      writeFollowedDevelopersToStorage(prev);
      setStats((cur) => (cur ? { ...cur, followers: Math.max(0, cur.followers + (willFollow ? -1 : 1)) } : cur));
    }
  };

  const displayName = (profile?.name || targetEmail || '').trim();
  const avatarUrl = targetEmail ? getCurrentUserAvatarOverride(targetEmail, profile?.avatar_url ?? null) : null;
  const initial = (displayName || targetEmail || 'U').trim().slice(0, 1).toUpperCase();
  const sponsorVerified = Boolean(profile?.sponsor_verified);
  const sponsorRole = String(profile?.sponsor_role ?? '').trim();
  const sponsorBadgeText = sponsorRole ? `${t('sponsorBadge')} · ${sponsorRole}` : t('sponsorBadge');

  const fmt = (value: number | null | undefined) => (typeof value === 'number' ? value.toLocaleString() : '—');

  const openProductGrid = (list: Product[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {list.map((p) => (
        <ProductCard key={p.id} product={p} variant="productsList" />
      ))}
    </div>
  );

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
              <Link href="/leaderboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {navT('leaderboard')}
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 animate-on-scroll">
          <Card className="lg:col-span-2 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('profileTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {profileLoading ? (
                <div className="py-10 text-center text-muted-foreground">{t('loading')}</div>
              ) : !profile ? (
                <div className="py-10 text-center">
                  <div className="text-sm text-muted-foreground">{profileMessage || t('notFound')}</div>
                  <div className="mt-6 flex items-center justify-center gap-3">
                    <Button asChild variant="outline">
                      <Link href="/">{navT('home')}</Link>
                    </Button>
                    <Button variant="default" onClick={() => router.push('/products')}>
                      {navT('products')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 shrink-0 rounded-full bg-muted border border-border/60 flex items-center justify-center overflow-hidden">
                      {avatarUrl ? (
                        <Image
                          src={avatarUrl}
                          alt={displayName || targetEmail || 'User'}
                          width={44}
                          height={44}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          unoptimized
                          loader={({ src }) => src}
                        />
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">{initial}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-lg font-semibold text-foreground truncate">{displayName || targetEmail}</div>
                        {sponsorVerified ? (
                          <Badge variant="secondary" className="shrink-0 h-5 px-1.5 text-[10px]">
                            {sponsorBadgeText}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-sm text-muted-foreground truncate">{profile.email || targetEmail}</div>
                      {profile.website ? (
                        <a
                          href={profile.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t('visitWebsite')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" disabled={isSelf} onClick={() => void toggleFollow()}>
                      {isSelf ? t('selfLabel') : isFollowing ? t('unfollow') : t('follow')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('statsTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('followers')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{statsLoading && !stats ? '…' : fmt(stats?.followers)}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('totalLikes')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{statsLoading && !stats ? '…' : fmt(stats?.total_likes)}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('totalFavorites')}</div>
                  <div className="mt-1 text-lg font-semibold text-foreground">{statsLoading && !stats ? '…' : fmt(stats?.total_favorites)}</div>
                </div>
              </div>
              {statsMessage ? <div className="mt-3 text-xs text-destructive">{statsMessage}</div> : null}
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="border border-border">
            <TabsTrigger value="products">{t('tabs.products')}</TabsTrigger>
            <TabsTrigger value="favorites">{t('tabs.favorites')}</TabsTrigger>
          </TabsList>

          <TabsContent value="products" className="mt-6">
            {productsLoading ? (
              <div className="py-16 text-center text-muted-foreground">{t('loading')}</div>
            ) : products.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">{productsMessage || t('productsEmpty')}</div>
            ) : (
              openProductGrid(products)
            )}
          </TabsContent>

          <TabsContent value="favorites" className="mt-6">
            {favoritesLoading ? (
              <div className="py-16 text-center text-muted-foreground">{t('loading')}</div>
            ) : favorites.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">{favoritesMessage || t('favoritesEmpty')}</div>
            ) : (
              openProductGrid(favorites)
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
