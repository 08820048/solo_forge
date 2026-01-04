import { getTranslations } from 'next-intl/server';
import Hero from '@/components/Hero';
import ProductGrid from '@/components/ProductGrid';
import CategoryList from '@/components/CategoryList';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'home' });

  return {
    title: `${t('hero.title')} - SoloForge`,
    description: t('hero.subtitle'),
  };
}

export default function HomePage() {
  return (
    <div className="w-full">
      <Hero />
      
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <CategoryList />
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 bg-white">
        <ProductGrid section="featured" />
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <ProductGrid section="recent" />
      </section>
    </div>
  );
}

