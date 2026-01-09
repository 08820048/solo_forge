import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: `About - ${t('appName')}`,
    description: t('slogan'),
    alternates: {
      canonical: `/${locale}/about`,
      languages: {
        en: '/en/about',
        zh: '/zh/about',
      },
    },
    openGraph: {
      type: 'article',
      title: `About - ${t('appName')}`,
      description: t('slogan'),
      url: `/${locale}/about`,
      images: [{ url: '/docs/imgs/image.jpg' }],
    },
    twitter: {
      card: 'summary',
      title: `About - ${t('appName')}`,
      description: t('slogan'),
      images: ['/docs/imgs/image.jpg'],
    },
  };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <h1 className="text-4xl font-bold text-foreground mb-8">About SoloForge</h1>
      
      <div className="space-y-6">
        <p className="text-xl text-muted-foreground">
          {t('slogan')}
        </p>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">Our Mission</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            SoloForge is dedicated to showcasing the incredible work of independent developers from around the world. 
            We believe that solo makers create some of the most innovative and user-focused products, and they deserve 
            a platform to share their creations with a global audience.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Our platform bridges the gap between independent developers and users who are looking for unique, 
            high-quality products. Whether you&apos;re building AI tools, productivity apps, or creative solutions, 
            SoloForge is here to help you reach your audience.
          </p>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">Why SoloForge?</h2>
          <ul className="space-y-3 text-muted-foreground">
            <li className="flex items-start">
              <span className="text-blue-600 mr-2">✓</span>
              <span>Global reach with bilingual support (English & Chinese)</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-2">✓</span>
              <span>Curated collection of high-quality indie products</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-2">✓</span>
              <span>Easy submission process for developers</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-2">✓</span>
              <span>SEO-optimized for maximum visibility</span>
            </li>
            <li className="flex items-start">
              <span className="text-blue-600 mr-2">✓</span>
              <span>Community-driven platform for indie makers</span>
            </li>
          </ul>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card text-card-foreground p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">Get Involved</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Whether you&apos;re a developer looking to showcase your product or a user searching for innovative tools, 
            we&apos;d love to have you as part of our community.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            <Link
              href="/submit"
              className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Submit Your Product
            </Link>
            <Link
              href="/products"
              className="inline-flex items-center justify-center px-6 py-3 border-2 border-primary text-base font-medium rounded-md text-primary hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Browse Products
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
