import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import Script from 'next/script';
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
  const isEnglishLocale = locale.toLowerCase().startsWith('en');

  return (
    <NextIntlClientProvider messages={messages}>
      <div className={`min-h-screen bg-background text-foreground ${isEnglishLocale ? 'sf-locale-en' : ''}`}>
        <Header />
        <InteractionEffects />
        <div className="mx-3 sm:mx-4 lg:mx-6 xl:mx-8 2xl:mx-10">{children}</div>
        <Footer />
      </div>
      <Script src="https://storage.ko-fi.com/cdn/scripts/overlay-widget.js" strategy="afterInteractive" />
      <Script id="sf-kofi-overlay-init" strategy="afterInteractive">
        {`(function () {
  if (typeof window === 'undefined') return;
  var tries = 0;
  function init() {
    tries += 1;
    if (window.__sf_kofi_widget_initialized) return;
    if (window.kofiWidgetOverlay && typeof window.kofiWidgetOverlay.draw === 'function') {
      window.kofiWidgetOverlay.draw('ornata', {
        type: 'floating-chat',
        'floating-chat.donateButton.text': 'Support me',
        'floating-chat.donateButton.background-color': '#ff38b8',
        'floating-chat.donateButton.text-color': '#fff',
      });
      window.__sf_kofi_widget_initialized = true;
      return;
    }
    if (tries < 40) {
      setTimeout(init, 250);
    }
  }
  init();
})();`}
      </Script>
    </NextIntlClientProvider>
  );
}
