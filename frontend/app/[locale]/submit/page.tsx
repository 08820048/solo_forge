import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'submit' });

  const canonical = `/${locale}/developer?tab=submit`;
  return {
    title: `${t('title')} - SoloForge`,
    description: t('subtitle'),
    alternates: {
      canonical,
      languages: {
        en: '/en/developer?tab=submit',
        zh: '/zh/developer?tab=submit',
      },
    },
    openGraph: {
      type: 'website',
      title: `${t('title')} - SoloForge`,
      description: t('subtitle'),
      url: canonical,
      images: [{ url: '/docs/imgs/image.jpg' }],
    },
    twitter: {
      card: 'summary',
      title: `${t('title')} - SoloForge`,
      description: t('subtitle'),
      images: ['/docs/imgs/image.jpg'],
    },
  };
}

export default async function SubmitPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/developer?tab=submit`);
}
