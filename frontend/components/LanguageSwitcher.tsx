'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * LanguageSwitcher
 * 语言切换器：支持 en/zh 切换，基于当前路径替换前缀；
 * 切换后将所选语言持久化到 localStorage 以便后续访问使用。
 */
export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'zh', name: '中文' },
  ];

  const currentLanguage = languages.find((lang) => lang.code === locale);

  /**
   * onSelectChange
   * 将当前路径的语言前缀切换为给定的 newLocale，并在客户端持久化选择：
   * - 始终使用 /[locale] 前缀（包括默认语言 en）
   * - 写入 Cookie: NEXT_LOCALE，便于服务端识别默认语言
   * - 写入 localStorage: NEXT_LOCALE，便于客户端持久化
   */
  function onSelectChange(newLocale: string) {
    startTransition(() => {
      // 统一策略：所有语言均使用 /[locale] 前缀
      const hasPrefix = /^\/[a-z]{2}\b/.test(pathname);
      let newPath = pathname;
      if (hasPrefix) {
        newPath = pathname.replace(/^\/[a-z]{2}\b/, `/${newLocale}`);
      } else {
        newPath = `/${newLocale}${pathname}`;
      }
      try {
        localStorage.setItem('NEXT_LOCALE', newLocale);
        // Set cookie for server-side locale detection (middleware)
        document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      } catch {}
      router.push(newPath);
      setIsOpen(false);
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-3 py-2 text-xs font-medium rounded-full text-muted-foreground hover:text-foreground border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-colors"
        disabled={isPending}
      >
        <span className="hidden sm:inline">{currentLanguage?.name}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-48 bg-popover text-popover-foreground rounded-md shadow-lg py-1 z-20 border border-border">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => onSelectChange(lang.code)}
                className={`w-full text-left px-4 py-2 text-sm flex items-center space-x-2 hover:bg-accent hover:text-accent-foreground ${
                  locale === lang.code ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <span>{lang.name}</span>
                {locale === lang.code && (
                  <svg className="w-4 h-4 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
