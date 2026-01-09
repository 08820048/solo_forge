'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type UserInfo = { name?: string; email?: string; avatarUrl?: string };

type ProductStatus = 'pending' | 'approved' | 'rejected';

type Product = {
  id: string;
  name: string;
  slogan: string;
  description?: string;
  website: string;
  logo_url?: string | null;
  category: string;
  tags: string[];
  maker_name: string;
  maker_email: string;
  maker_website?: string | null;
  language: string;
  status: ProductStatus;
  rejection_reason?: string | null;
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

export default function DeveloperProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const awaitedParams = use(params);
  const id = String(awaitedParams?.id || '').trim();
  const locale = useLocale();
  const tDev = useTranslations('developer');
  const tNav = useTranslations('nav');
  const tDetail = useTranslations('productDetail');
  const tCategories = useTranslations('categories');

  const [sessionReady, setSessionReady] = useState(false);
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function syncSession() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const sessionUser = data.session?.user;

        if (cancelled) return;
        if (!sessionUser) {
          setUser(null);
          return;
        }
        const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
        const nameRaw = (meta.full_name || meta.name || sessionUser.email || '') as string;
        const avatarRaw = (meta.avatar_url || meta.picture) as string | undefined;
        setUser({ name: String(nameRaw || ''), email: sessionUser.email ?? undefined, avatarUrl: avatarRaw ? String(avatarRaw) : undefined });
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
    if (!sessionReady) return;
    if (!user?.email || !id) {
      setLoading(false);
      setProduct(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setMessage(null);

    (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setProduct(null);
          setMessage(locale.toLowerCase().startsWith('zh') ? '请先登录后再查看产品详情。' : 'Unauthorized');
          return;
        }

        const response = await fetch(`/api/products/${encodeURIComponent(id)}`, {
          headers: {
            'Accept-Language': locale,
            Authorization: `Bearer ${token}`,
          },
        });
        const json = (await response.json().catch(() => null)) as ApiResponse<Product> | null;
        if (cancelled) return;

        if (json && json.success && json.data) {
          setProduct(json.data);
          return;
        }
        const fallback =
          response.status === 403
            ? locale.toLowerCase().startsWith('zh')
              ? '无权限查看该产品。'
              : 'Forbidden'
            : response.status === 404
              ? locale.toLowerCase().startsWith('zh')
                ? '未找到该产品。'
                : 'Product not found'
              : null;
        setProduct(null);
        setMessage(json?.message || fallback || tDev('networkError'));
      } catch (err) {
        if (cancelled) return;
        const msg = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message) : null;
        setProduct(null);
        setMessage(msg || tDev('networkError'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, locale, sessionReady, tDev, user?.email]);

  const statusBadge = useMemo(() => {
    if (!product) return null;
    if (product.status === 'approved') return <Badge variant="secondary">{tDev('status.approved')}</Badge>;
    if (product.status === 'rejected') return <Badge variant="destructive">{tDev('status.rejected')}</Badge>;
    return <Badge variant="outline">{tDev('status.pending')}</Badge>;
  }, [product, tDev]);

  if (!sessionReady) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-12">
          <div className="py-24 text-center text-muted-foreground">{tDev('loading')}</div>
        </div>
      </div>
    );
  }

  if (!user?.email) {
    return (
      <div className="min-h-screen">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-12">
          <div className="sf-wash rounded-2xl border border-border bg-card/50 p-10 text-center animate-on-scroll">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">{tDev('title')}</h1>
            <p className="mt-3 text-muted-foreground">{tDev('loginRequired')}</p>
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button asChild variant="default">
                <Link href="/">{tNav('home')}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/submit">{tNav('submit')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-12">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              window.location.assign(`/${locale}/developer?tab=products`);
            }}
          >
            {locale.toLowerCase().startsWith('zh') ? '返回我的产品' : 'Back'}
          </Button>
          {product?.status === 'approved' ? (
            <Button asChild variant="default">
              <Link href={{ pathname: '/products/[slug]', params: { slug: product.id } }}>
                {locale.toLowerCase().startsWith('zh') ? '打开公开详情页' : 'Open public page'}
              </Link>
            </Button>
          ) : null}
        </div>

        <Card className="bg-card/50">
          <CardContent className="p-6 sm:p-8">
            {loading ? (
              <div className="py-16 text-center text-muted-foreground animate-on-scroll">{tDev('loading')}</div>
            ) : !product ? (
              <div className="py-10 text-center animate-on-scroll">
                <div className="text-lg font-semibold text-foreground">
                  {locale.toLowerCase().startsWith('zh') ? '无法打开产品详情' : 'Unable to open product'}
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{message || ''}</div>
              </div>
            ) : (
              <div className="space-y-8 animate-on-scroll">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h1 className="text-3xl font-bold text-foreground truncate">{product.name}</h1>
                      {statusBadge}
                    </div>
                    <div className="mt-2 text-muted-foreground">
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
                        {String(product.slogan || '')}
                      </ReactMarkdown>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      {tCategories(product.category)} · {tDetail('createdAt')} {formatDate(product.created_at, locale)}
                    </div>
                  </div>
                  <a
                    href={product.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <span>{tDetail('website')}</span>
                    <span aria-hidden="true">→</span>
                  </a>
                </div>

                {product.status === 'rejected' && product.rejection_reason ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                    <div className="text-xs font-semibold text-destructive">
                      {locale.toLowerCase().startsWith('zh') ? '拒绝原因' : 'Rejection Reason'}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground break-words">{product.rejection_reason}</div>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                    <div className="text-xs font-semibold text-muted-foreground">{tDetail('maker')}</div>
                    <div className="mt-1 text-sm text-foreground">{product.maker_name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{product.maker_email}</div>
                    {product.maker_website ? (
                      <a
                        href={product.maker_website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex text-xs text-foreground underline underline-offset-4 hover:opacity-80"
                      >
                        {locale.toLowerCase().startsWith('zh') ? '开发者网站' : 'Maker website'} →
                      </a>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-border bg-background/40 px-4 py-3">
                    <div className="text-xs font-semibold text-muted-foreground">{tDetail('category')}</div>
                    <div className="mt-1 text-sm text-foreground">{tCategories(product.category)}</div>
                    {product.tags?.length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {product.tags.map((tag) => (
                          <Badge key={tag} variant="secondary">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                {product.description ? (
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">{tDetail('description')}</h2>
                    <div className="mt-3 text-sm text-muted-foreground leading-relaxed">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ ...props }) => (
                            <a
                              {...props}
                              className="text-foreground underline underline-offset-4"
                              target="_blank"
                              rel="noreferrer"
                            />
                          ),
                          p: ({ ...props }) => <p {...props} className="mb-3 last:mb-0" />,
                          ul: ({ ...props }) => <ul {...props} className="mb-3 ml-5 list-disc space-y-1 last:mb-0" />,
                          ol: ({ ...props }) => <ol {...props} className="mb-3 ml-5 list-decimal space-y-1 last:mb-0" />,
                          li: ({ ...props }) => <li {...props} className="leading-relaxed" />,
                          h1: ({ ...props }) => <h1 {...props} className="mb-3 text-xl font-semibold text-foreground" />,
                          h2: ({ ...props }) => <h2 {...props} className="mb-3 text-lg font-semibold text-foreground" />,
                          h3: ({ ...props }) => <h3 {...props} className="mb-2 text-base font-semibold text-foreground" />,
                          pre: ({ ...props }) => (
                            <pre {...props} className="mb-3 overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs text-foreground/90" />
                          ),
                          code: ({ className: codeClassName, children, ...props }) => {
                            const inline = !String(codeClassName || '').includes('language-');
                            if (inline) {
                              return (
                                <code {...props} className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground/90">
                                  {children}
                                </code>
                              );
                            }
                            return (
                              <code {...props} className={codeClassName}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {String(product.description || '')}
                      </ReactMarkdown>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
