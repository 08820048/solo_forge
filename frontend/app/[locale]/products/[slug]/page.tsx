import { getTranslations } from 'next-intl/server';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@/i18n/routing';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function generateMetadata({
  params
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params;

  try {
    // Fetch product data from API
    const response = await fetch(`${process.env.BACKEND_API_URL || 'http://localhost:8080/api'}/products/${slug}`, {
      headers: {
        'Accept-Language': locale,
      },
    });

    if (response.ok) {
      const data = await response.json();
      const product = data.data;

      return {
        title: `${product.name} - SoloForge`,
        description: product.slogan,
      };
    }
  } catch {
    // Fallback to mock data if API fails
    const product = {
      name: 'AI Writing Assistant',
      slogan: 'Write better content with AI',
    };

    return {
      title: `${product.name} - SoloForge`,
      description: product.slogan,
    };
  }
}

export default async function ProductDetailPage({
  params
}: {
  params: Promise<{ locale: string; slug: string }>
}) {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: 'productDetail' });
  const categoryT = await getTranslations({ locale, namespace: 'categories' });

  let product;
  let maker = null as null | {
    email: string;
    name: string;
    avatar_url?: string | null;
    website?: string | null;
    sponsor_role?: string | null;
    sponsor_verified?: boolean;
  };
  try {
    // Fetch product data from API
    const response = await fetch(`${process.env.BACKEND_API_URL || 'http://localhost:8080/api'}/products/${slug}`, {
      headers: {
        'Accept-Language': locale,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      // If product not found, return 404
      if (response.status === 404) {
        notFound();
      }
      throw new Error('Failed to fetch product');
    }

    const data = await response.json();
    product = data.data;
  } catch {
    notFound();
  }

  if (product?.maker_email) {
    try {
      const devRes = await fetch(
        `${process.env.BACKEND_API_URL || 'http://localhost:8080/api'}/developers/${encodeURIComponent(
          product.maker_email
        )}`,
        {
          headers: {
            'Accept-Language': locale,
          },
          cache: 'no-store',
        }
      );
      if (devRes.ok) {
        const devJson = await devRes.json();
        maker = devJson.data || null;
      }
    } catch {
      maker = null;
    }
  }
  const sponsorVerified = Boolean(maker?.sponsor_verified ?? product?.maker_sponsor_verified);
  const sponsorRole = String(maker?.sponsor_role ?? product?.maker_sponsor_role ?? '').trim();
  const sponsorBadgeText = sponsorRole ? `${t('sponsorBadge')} · ${sponsorRole}` : t('sponsorBadge');
  const makerEmail = String(maker?.email || product?.maker_email || '').trim().toLowerCase();

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-20 sm:pt-24 pb-12">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="xl:col-span-2">
          {/* Header */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 mb-6">
              <div className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden bg-muted">
                {product.logo_url ? (
                  <Image
                    src={product.logo_url}
                    alt={product.name}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    unoptimized
                    loader={({ src }) => src}
                  />
                ) : (
                  <div className="w-full h-full bg-black flex items-center justify-center">
                    <span className="text-white text-2xl sm:text-3xl lg:text-4xl font-bold">{product.name.charAt(0)}</span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-foreground">
                    {product.name}
                  </h1>
                  <a
                    href={product.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors sm:mt-2"
                  >
                    <span>{t('website')}</span>
                    <span aria-hidden="true">→</span>
                  </a>
                </div>
                <div className="text-base sm:text-lg lg:text-xl text-muted-foreground mb-4 mt-2">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ ...props }) => <span {...props} />,
                      a: ({ ...props }) => (
                        <a
                          {...props}
                          className="text-foreground underline underline-offset-4"
                          target="_blank"
                          rel="noreferrer"
                        />
                      ),
                      code: ({ className: codeClassName, children, ...props }) => {
                        const inline = !String(codeClassName || '').includes('language-');
                        if (inline) {
                          return (
                            <code
                              {...props}
                              className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground/90"
                            >
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
                      ul: ({ ...props }) => <span {...props} />,
                      ol: ({ ...props }) => <span {...props} />,
                      li: ({ ...props }) => <span {...props} />,
                      h1: ({ ...props }) => <span {...props} />,
                      h2: ({ ...props }) => <span {...props} />,
                      h3: ({ ...props }) => <span {...props} />,
                      pre: ({ ...props }) => <span {...props} />,
                      blockquote: ({ ...props }) => <span {...props} />,
                      br: () => <span> </span>,
                    }}
                  >
                    {String(product.slogan || '')}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-6 mb-6">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              {t('description')}
            </h2>
            <div className="text-muted-foreground leading-relaxed">
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
        </div>

        {/* Sidebar */}
        <div className="lg:col-span-1">
          <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-6 sticky top-20">
            {/* Maker Info */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {t('maker')}
              </h3>
              <div className="flex items-center space-x-3">
                {makerEmail ? (
                  <Link
                    href={{ pathname: '/makers/[email]', params: { email: makerEmail } }}
                    className="w-12 h-12 bg-muted rounded-full flex items-center justify-center overflow-hidden hover:opacity-90 transition-opacity"
                    aria-label={maker?.name || makerEmail}
                  >
                    {maker?.avatar_url ? (
                      <div
                        className="w-full h-full bg-center bg-cover"
                        style={{ backgroundImage: `url("${maker.avatar_url}")` }}
                        aria-label={maker.name || maker.email}
                      />
                    ) : (
                      <span className="text-muted-foreground font-semibold">
                        {(product.maker_name || product.maker_email || 'U').trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </Link>
                ) : (
                  <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center overflow-hidden">
                    {maker?.avatar_url ? (
                      <div
                        className="w-full h-full bg-center bg-cover"
                        style={{ backgroundImage: `url("${maker.avatar_url}")` }}
                        aria-label={maker.name || maker.email}
                      />
                    ) : (
                      <span className="text-muted-foreground font-semibold">
                        {(product.maker_name || product.maker_email || 'U').trim().charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 min-w-0">
                    {makerEmail ? (
                      <Link
                        href={{ pathname: '/makers/[email]', params: { email: makerEmail } }}
                        className="font-medium text-foreground truncate hover:underline"
                      >
                        {product.maker_name}
                      </Link>
                    ) : (
                      <p className="font-medium text-foreground truncate">{product.maker_name}</p>
                    )}
                    {sponsorVerified ? (
                      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-[10px] font-medium text-secondary-foreground">
                        {sponsorBadgeText}
                      </span>
                    ) : null}
                  </div>
                  {(maker?.website || product.maker_website) && (
                    <a
                      href={maker?.website || product.maker_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-foreground underline underline-offset-4 hover:opacity-80"
                    >
                      View Profile →
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Category */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {t('category')}
              </h3>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-secondary text-secondary-foreground">
                {categoryT(product.category)}
              </span>
            </div>

            {/* Tags */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {t('tags')}
              </h3>
              <div className="flex flex-wrap gap-2">
                {product.tags.map((tag: string, index: number) => (
                  <span
                    key={index}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-secondary text-secondary-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Created At */}
            <div>
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {t('createdAt')}
              </h3>
              <p className="text-muted-foreground">
                {new Date(product.created_at).toLocaleDateString(
                  locale === 'zh' ? 'zh-CN' : 'en-US',
                  {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  }
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
