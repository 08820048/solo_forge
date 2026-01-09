import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tCommon = await getTranslations({ locale, namespace: 'common' });
  const tPricing = await getTranslations({ locale, namespace: 'pricing' });

  const title = `${tPricing('title')} - ${tCommon('appName')}`;
  const description = tPricing('subtitle');
  const url = `/${locale}/pricing`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        en: '/en/pricing',
        zh: '/zh/pricing',
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

export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}

