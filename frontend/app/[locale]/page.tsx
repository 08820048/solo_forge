import { getTranslations } from 'next-intl/server';
import Hero from '@/components/Hero';
import ProductGrid from '@/components/ProductGrid';
import CategoryList from '@/components/CategoryList';
import DeveloperPopularitySidebar from '@/components/DeveloperPopularitySidebar';
import HomeRightSidebar from '@/components/HomeRightSidebar';

/**
 * generateMetadata
 * 为首页生成多语言 SEO 元数据（标题与描述），使用 home 命名空间。
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'common' });

  return {
    title: t('appName'),
    description: t('slogan'),
  };
}

/**
 * HomePage
 * 首页结构为：Hero（焦点横幅）+ 热门产品 + 最新上架 + 分类浏览；
 * 所有内容模块均复用独立的 UI 组件，且不使用渐变背景。
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  await params;

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-24 pb-16">
        <div className="space-y-16">
          <Hero />
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-6">
            <div className="hidden lg:block">
              <DeveloperPopularitySidebar />
            </div>
            <div className="space-y-16 min-w-0">
              <ProductGrid section="featured" />
              <ProductGrid section="recent" />
              <CategoryList />
            </div>
            <div className="hidden lg:block">
              <HomeRightSidebar />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
