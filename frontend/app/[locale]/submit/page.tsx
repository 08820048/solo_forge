import { getTranslations } from 'next-intl/server';
import SubmitForm from '@/components/SubmitForm';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'submit' });

  return {
    title: `${t('title')} - SoloForge`,
    description: t('subtitle'),
  };
}

/**
 * SubmitPage
 * 提交产品页面：使用词条渲染标题与副标题，底部渲染提交表单。
 */
export default async function SubmitPage() {
  const t = await getTranslations('submit');
  return (
    <div className="min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8 animate-on-scroll">
          <h1 className="text-4xl font-bold text-foreground mb-4 font-sans tracking-tight">
            {t('title')}
          </h1>
          <p className="text-xl text-muted-foreground font-sans">
            {t('subtitle')}
          </p>
        </div>
        <SubmitForm />
      </div>
    </div>
  );
}
