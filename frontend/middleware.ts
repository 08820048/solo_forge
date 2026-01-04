import createMiddleware from 'next-intl/middleware';

/**
 * middleware
 * 基于 next-intl 的国际化中间件：
 * - 强制所有语言使用 /[locale] 前缀（包括默认语言 en）
 * - 自动将根路径 / 重定向到 /en
 * - 支持 /en 与 /zh 下的所有子路径
 */
export default createMiddleware({
  locales: ['en', 'zh'],
  defaultLocale: 'en',
  localePrefix: 'always'
});

export const config = {
  matcher: ['/', '/(en|zh)/:path*']
};

