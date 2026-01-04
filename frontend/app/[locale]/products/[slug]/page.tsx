import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

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
  try {
    // Fetch product data from API
    const response = await fetch(`${process.env.BACKEND_API_URL || 'http://localhost:8080/api'}/products/${slug}`, {
      headers: {
        'Accept-Language': locale,
      },
      next: { revalidate: 3600 }, // Revalidate every hour
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

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 py-12">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-start space-x-6 mb-6">
              <div className="w-24 h-24 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-white text-4xl font-bold">
                  {product.name.charAt(0)}
                </span>
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
                  className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
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
            <p className="text-muted-foreground leading-relaxed">
              {product.description}
            </p>
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
                <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center">
                  <span className="text-muted-foreground font-semibold">
                    {product.maker_name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-foreground">{product.maker_name}</p>
                  {product.maker_website && (
                    <a
                      href={product.maker_website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
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
