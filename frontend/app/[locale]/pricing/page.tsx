import { getTranslations } from 'next-intl/server';
import KofiSponsorDialog from '@/components/KofiSponsorDialog';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const tCommon = await getTranslations({ locale, namespace: 'common' });
  const tPricing = await getTranslations({ locale, namespace: 'pricing' });

  return {
    title: `${tPricing('title')} - ${tCommon('appName')}`,
    description: tPricing('subtitle'),
    alternates: {
      canonical: `/${locale}/pricing`,
      languages: {
        en: '/en/pricing',
        zh: '/zh/pricing',
      },
    },
  };
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pricing' });
  const contactEmail = 'ilikexff@gmail.com';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-12">
      <h1 className="text-4xl font-bold text-foreground mb-4">{t('title')}</h1>
      <p className="text-muted-foreground leading-relaxed">{t('subtitle')}</p>

      <div className="mt-8 space-y-6 text-muted-foreground leading-relaxed">
        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{t('policy.introTitle')}</h2>
          <p>{t('policy.intro')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{t('policy.first50Title')}</h2>
          <p>{t('policy.first50Desc')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{t('policy.after50Title')}</h2>
          <p>{t('policy.after50Desc')}</p>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{t('policy.kofiTitle')}</h2>
          <p>{t('policy.kofiDesc')}</p>
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
            <KofiSponsorDialog
              trigger={
                <button
                  type="button"
                  className="inline-flex items-center gap-2 text-primary hover:underline bg-transparent p-0"
                >
                  <i className="ri-cup-line text-base" aria-hidden="true" />
                  <span>Ko-fi</span>
                </button>
              }
            />
            <a href={`mailto:${contactEmail}`} className="inline-flex items-center gap-2 text-primary hover:underline">
              <i className="ri-mail-line text-base" aria-hidden="true" />
              <span>{contactEmail}</span>
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card text-card-foreground p-8 space-y-3">
          <h2 className="text-2xl font-bold text-foreground">{t('policy.priorityTitle')}</h2>
          <p>{t('policy.priorityDesc')}</p>
        </div>
      </div>
    </div>
  );
}
