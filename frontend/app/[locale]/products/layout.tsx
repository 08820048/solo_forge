import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tCommon = await getTranslations({ locale, namespace: 'common' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const title = `${tNav('products')} - ${tCommon('appName')}`;
  const description = tCommon('slogan');
  const url = `/${locale}/products`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        en: '/en/products',
        zh: '/zh/products',
      },
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url,
      images: [{ url: '/docs/imgs/image.jpg' }],
    },
    twitter: {
      card: 'summary',
      title,
      description,
      images: ['/docs/imgs/image.jpg'],
    },
  };
}

export default function ProductsLayout({ children }: { children: React.ReactNode }) {
  return children;
}

