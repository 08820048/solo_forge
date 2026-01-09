import { getTranslations } from 'next-intl/server';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tCommon = await getTranslations({ locale, namespace: 'common' });
  const tNav = await getTranslations({ locale, namespace: 'nav' });

  const title = `${tNav('leaderboard')} - ${tCommon('appName')}`;
  const description = tCommon('slogan');
  const url = `/${locale}/leaderboard`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        en: '/en/leaderboard',
        zh: '/zh/leaderboard',
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

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

