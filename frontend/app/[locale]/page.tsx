import { getTranslations } from 'next-intl/server';
import { useId, type SVGProps } from 'react';
import Hero from '@/components/Hero';
import ProductGrid from '@/components/ProductGrid';
import DeveloperPopularitySidebar from '@/components/DeveloperPopularitySidebar';
import HomeRightSidebar from '@/components/HomeRightSidebar';
import { cn } from '@/lib/utils';

interface GridPatternProps
  extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height' | 'x' | 'y'> {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  squares?: Array<[x: number, y: number]>;
  strokeDasharray?: string;
}

function GridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = '0',
  squares,
  className,
  ...props
}: GridPatternProps) {
  const id = useId();

  return (
    <svg
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 h-full w-full fill-foreground/5 stroke-foreground/10 opacity-40 [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)] dark:opacity-30',
        className,
      )}
      {...props}
    >
      <defs>
        <pattern
          id={id}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${id})`} />
      {squares && (
        <svg x={x} y={y} className="overflow-visible">
          {squares.map(([x, y]) => (
            <rect
              strokeWidth="0"
              key={`${x}-${y}`}
              width={width - 1}
              height={height - 1}
              x={x * width + 1}
              y={y * height + 1}
            />
          ))}
        </svg>
      )}
    </svg>
  );
}

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
 * 首页结构为：Hero（焦点横幅）+ 精选产品 + 最新提交；
 * 所有内容模块均复用独立的 UI 组件，且不使用渐变背景。
 */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  await params;

  return (
    <div className="min-h-screen relative isolate">
      <GridPattern className="-z-10" />
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 pt-24 pb-16 relative">
        <div className="space-y-16">
          <Hero />
          <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_320px] gap-6">
            <div className="hidden lg:block">
              <DeveloperPopularitySidebar />
            </div>
            <div className="space-y-16 min-w-0">
              <ProductGrid section="featured" />
              <ProductGrid section="recent" />
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
