import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  let maker = null as null | { email: string; name: string; avatar_url?: string | null; website?: string | null };
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

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-24 pb-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-start space-x-6 mb-6">
              <div className="w-24 h-24 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden bg-muted">
                {product.logo_url ? (
                  <img
                    src={product.logo_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-black flex items-center justify-center">
                    <span className="text-white text-4xl font-bold">{product.name.charAt(0)}</span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <h1 className="text-4xl font-bold text-foreground mb-2">
                  {product.name}
                </h1>
                <p className="text-xl text-muted-foreground mb-4">
                  {product.slogan}
                </p>
                <a
                  href={product.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-black hover:bg-black/90 transition-colors"
                >
                  {t('website')} →
                </a>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="rounded-xl border border-border bg-card text-card-foreground p-6 mb-6">
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
          <div className="rounded-xl border border-border bg-card text-card-foreground p-6 sticky top-20">
            {/* Maker Info */}
            <div className="mb-6">
              <h3 className="text-lg font-semibold text-foreground mb-3">
                {t('maker')}
              </h3>
              <div className="flex items-center space-x-3">
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
                <div>
                  <p className="font-medium text-foreground">{product.maker_name}</p>
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
