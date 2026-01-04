'use client';

import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/routing';
import SubmitForm from '@/components/SubmitForm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type TabKey = 'overview' | 'submit' | 'products' | 'favorites' | 'stats';

type UserInfo = { name?: string; email?: string; avatarUrl?: string };

type ProductStatus = 'pending' | 'approved' | 'rejected';

type Product = {
  id: string;
  name: string;
  slogan: string;
  website: string;
  category: string;
  tags: string[];
  maker_name: string;
  maker_email: string;
  language: string;
  status: ProductStatus;
  created_at: string;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

function readUserFromStorage(): UserInfo | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserInfo;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function formatDate(value: string, locale: string): string {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  } catch {
    return dt.toLocaleDateString();
  }
}

export default function DeveloperCenterPage() {
  const t = useTranslations('developer');
  const navT = useTranslations('nav');
  const categoryT = useTranslations('categories');
  const locale = useLocale();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<TabKey>('overview');
  const [user, setUser] = useState<UserInfo | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsMessage, setProductsMessage] = useState<string | null>(null);
  const [favoriteProducts, setFavoriteProducts] = useState<Product[]>([]);
  const [favoritesLoading, setFavoritesLoading] = useState(true);
  const [favoritesMessage, setFavoritesMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const nextTab = (searchParams.get('tab') || '').toLowerCase();
    if (nextTab === 'submit' || nextTab === 'products' || nextTab === 'favorites' || nextTab === 'stats' || nextTab === 'overview') {
      setTab(nextTab as TabKey);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    async function syncSession() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const sessionUser = data.session?.user;

        if (!cancelled) {
          if (!sessionUser) {
            setUser(null);
          } else {
            const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
            const nameRaw = (meta.full_name || meta.name || sessionUser.email || '') as string;
            const avatarRaw = (meta.avatar_url || meta.picture) as string | undefined;
            setUser({ name: String(nameRaw || ''), email: sessionUser.email ?? undefined, avatarUrl: avatarRaw ? String(avatarRaw) : undefined });
          }
        }
      } catch {
        if (!cancelled) setUser(readUserFromStorage());
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }

    syncSession();

    const onStorage = () => setUser(readUserFromStorage());
    window.addEventListener('storage', onStorage);
    window.addEventListener('sf_user_updated', onStorage as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sf_user_updated', onStorage as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchProducts() {
      setProductsLoading(true);
      setProductsMessage(null);
      try {
        const response = await fetch(`/api/products?limit=200&offset=0`, { headers: { 'Accept-Language': locale } });
        const json: ApiResponse<Product[]> = await response.json();
        if (!cancelled) {
          if (json.success) {
            setProducts(json.data ?? []);
          } else {
            setProducts([]);
            setProductsMessage(json.message ?? t('productsLoadFailed'));
          }
        }
      } catch {
        if (!cancelled) {
          setProducts([]);
          setProductsMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [locale, refreshKey, t]);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;

    async function fetchFavorites() {
      setFavoritesLoading(true);
      setFavoritesMessage(null);
      try {
        const response = await fetch(
          `/api/products/favorites?user_id=${encodeURIComponent(user.email)}&limit=200&language=${encodeURIComponent(locale)}`,
          { headers: { 'Accept-Language': locale } }
        );
        const json: ApiResponse<Product[]> = await response.json();
        if (cancelled) return;

        if (json.success) {
          setFavoriteProducts(json.data ?? []);
        } else {
          setFavoriteProducts([]);
          setFavoritesMessage(json.message ?? t('networkError'));
        }
      } catch {
        if (!cancelled) {
          setFavoriteProducts([]);
          setFavoritesMessage(t('networkError'));
        }
      } finally {
        if (!cancelled) setFavoritesLoading(false);
      }
    }

    fetchFavorites();

    return () => {
      cancelled = true;
    };
  }, [locale, refreshKey, t, user?.email]);

  const myProducts = useMemo(() => {
    if (!user?.email) return [];
    const email = user.email.toLowerCase();
    return products.filter((p) => (p.maker_email || '').toLowerCase() === email);
  }, [products, user?.email]);

  const stats = useMemo(() => {
    const total = myProducts.length;
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    const byCategory = new Map<string, number>();

    for (const p of myProducts) {
      if (p.status === 'approved') approved += 1;
      else if (p.status === 'rejected') rejected += 1;
      else pending += 1;

      byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
    }

    const topCategories = Array.from(byCategory.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    return { total, approved, pending, rejected, topCategories };
  }, [myProducts]);

  if (!sessionReady) {
    return (
        <div className="min-h-screen">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="py-24 text-center text-muted-foreground">{t('loading')}</div>
        </div>
      </div>
    );
  }

  if (!user?.email) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-12">
          <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
            <h1 className="text-3xl font-bold text-foreground tracking-tight">{t('title')}</h1>
            <p className="mt-3 text-muted-foreground">{t('loginRequired')}</p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="default">
                <Link href="/">{navT('home')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/submit">{navT('submit')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const statusBadge = (status: ProductStatus) => {
    if (status === 'approved') return <Badge variant="secondary">{t('status.approved')}</Badge>;
    if (status === 'rejected') return <Badge variant="destructive">{t('status.rejected')}</Badge>;
    return <Badge variant="outline">{t('status.pending')}</Badge>;
  };

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
              <Link href="/leaderboard" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                {navT('leaderboard')}
              </Link>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <Card className="lg:col-span-2 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('profile.title')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-foreground truncate">{user.name || t('profile.unnamed')}</div>
                  <div className="text-sm text-muted-foreground truncate">{user.email}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="default" onClick={() => setTab('submit')}>
                    {t('actions.submit')}
                  </Button>
                  <Button variant="outline" onClick={() => setTab('products')}>
                    {t('actions.manage')}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{t('stats.title')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('stats.total')}</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{stats.total}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('stats.pending')}</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{stats.pending}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('stats.approved')}</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{stats.approved}</div>
                </div>
                <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                  <div className="text-xs text-muted-foreground">{t('stats.rejected')}</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{stats.rejected}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList className="border border-border">
            <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
            <TabsTrigger value="submit">{t('tabs.submit')}</TabsTrigger>
            <TabsTrigger value="products">{t('tabs.products')}</TabsTrigger>
            <TabsTrigger value="favorites">{t('tabs.favorites')}</TabsTrigger>
            <TabsTrigger value="stats">{t('tabs.stats')}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t('overview.recentTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {productsLoading ? (
                    <div className="py-10 text-center text-muted-foreground">{t('loading')}</div>
                  ) : myProducts.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground">{t('overview.noProducts')}</div>
                  ) : (
                    <div className="divide-y divide-border">
                      {myProducts.slice(0, 5).map((p) => (
                        <div key={p.id} className="py-4 flex items-start gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <Link
                                href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                                className="text-foreground font-medium truncate hover:underline"
                              >
                                {p.name}
                              </Link>
                              {statusBadge(p.status)}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground line-clamp-1">{p.slogan}</div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              {categoryT(p.category)} · {formatDate(p.created_at, locale)}
                            </div>
                          </div>
                          <a
                            href={p.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t('actions.viewWebsite')}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t('overview.favoritesTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {favoritesLoading ? (
                    <div className="py-10 text-center text-muted-foreground">{t('loading')}</div>
                  ) : favoriteProducts.length === 0 ? (
                    <div className="py-10 text-center text-muted-foreground">{favoritesMessage || t('favorites.empty')}</div>
                  ) : (
                    <div className="space-y-3">
                      {favoriteProducts.slice(0, 5).map((p) => (
                        <div key={p.id} className="flex items-center justify-between gap-3">
                          <Link
                            href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                            className="min-w-0 text-sm text-foreground truncate hover:underline"
                          >
                            {p.name}
                          </Link>
                          <Badge variant="outline" className="shrink-0">
                            {categoryT(p.category)}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="submit" className="mt-6">
            <div className="rounded-2xl border border-border bg-card/50 p-6">
              <SubmitForm
                showHeader={false}
                defaultMakerName={user.name}
                defaultMakerEmail={user.email}
                lockMakerIdentity
                onSubmitted={() => {
                  setRefreshKey((k) => k + 1);
                  setTab('products');
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="products" className="mt-6">
            <div className="rounded-2xl border border-border bg-card/50">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">{t('products.title')}</div>
                  <div className="text-xs text-muted-foreground">{t('products.subtitle')}</div>
                </div>
                <Button variant="outline" onClick={() => setTab('submit')}>
                  {t('actions.submit')}
                </Button>
              </div>
              {productsLoading ? (
                <div className="py-24 text-center text-muted-foreground">{t('loading')}</div>
              ) : myProducts.length === 0 ? (
                <div className="py-24 text-center text-muted-foreground">{productsMessage || t('products.empty')}</div>
              ) : (
                <div className="divide-y divide-border">
                  {myProducts.map((p) => (
                    <div key={p.id} className="px-5 py-4 flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link
                            href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                            className="text-foreground font-medium truncate hover:underline"
                          >
                            {p.name}
                          </Link>
                          {statusBadge(p.status)}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{p.slogan}</div>
                        <div className="mt-2 text-xs text-muted-foreground">
                          {categoryT(p.category)} · {t('products.createdAt', { date: formatDate(p.created_at, locale) })}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <a
                          href={p.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t('actions.viewWebsite')}
                        </a>
                        <Link
                          href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t('actions.viewDetail')}
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="favorites" className="mt-6">
            <div className="rounded-2xl border border-border bg-card/50">
              <div className="px-5 py-4 border-b border-border flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-foreground">{t('favorites.title')}</div>
                  <div className="text-xs text-muted-foreground">{t('favorites.subtitle')}</div>
                </div>
              </div>
              {favoritesLoading ? (
                <div className="py-24 text-center text-muted-foreground">{t('loading')}</div>
              ) : favoriteProducts.length === 0 ? (
                <div className="py-24 text-center text-muted-foreground">{favoritesMessage || t('favorites.empty')}</div>
              ) : (
                <div className="divide-y divide-border">
                  {favoriteProducts.map((p) => (
                    <div key={p.id} className="px-5 py-4 flex items-start gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Link
                            href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                            className="text-foreground font-medium truncate hover:underline"
                          >
                            {p.name}
                          </Link>
                          <Badge variant="outline">{categoryT(p.category)}</Badge>
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{p.slogan}</div>
                        <div className="mt-2 text-xs text-muted-foreground">{t('favorites.by', { maker: p.maker_name })}</div>
                      </div>
                      <a
                        href={p.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t('actions.viewWebsite')}
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="stats" className="mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t('statsBreakdown.title')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {myProducts.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">{t('statsBreakdown.empty')}</div>
                  ) : (
                    <div className="space-y-3">
                      {stats.topCategories.map(([cat, count]) => (
                        <div key={cat} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-4 py-3">
                          <div className="text-sm text-foreground">{categoryT(cat)}</div>
                          <div className="text-sm text-muted-foreground">{t('statsBreakdown.count', { count })}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-card/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t('tips.title')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground space-y-2">
                  <div>{t('tips.item1')}</div>
                  <div>{t('tips.item2')}</div>
                  <div>{t('tips.item3')}</div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
