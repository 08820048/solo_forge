import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';
import '../globals.css';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import InteractionEffects from '@/components/InteractionEffects';

/**
 * generateStaticParams
 * 为多语言路由生成静态参数，确保 /[locale] 预渲染
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * LocaleLayout
 * 基于 next-intl 的多语言布局包装：
 * - 校验 locale 合法性
 * - 通过 NextIntlClientProvider 注入消息
 * - 渲染全局 Header、交互特效、Footer
 */
export default async function LocaleLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  type Locale = (typeof routing.locales)[number];
  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <InteractionEffects />
        <div className="mx-3 sm:mx-4 lg:mx-6 xl:mx-8 2xl:mx-10">{children}</div>
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
