'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import FlipClockCountdown from '@/components/ui/flip-clock-countdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type SponsoredProduct = {
  id: string;
  name: string;
  slogan: string;
  description?: string;
  website: string;
  category: string;
  maker_name: string;
  logo_url?: string | null;
  tags?: string[];
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

function SloganMarkdown({ value }: { value: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <span>{children}</span>,
        a: ({ href, children }) => (
          <a
            href={href ?? '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:opacity-80"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-foreground/90">{children}</code>
        ),
        ul: ({ children }) => <span>{children}</span>,
        ol: ({ children }) => <span>{children}</span>,
        li: ({ children }) => <span>• {children} </span>,
        h1: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        h2: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        h3: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        blockquote: ({ children }) => <span>{children}</span>,
        pre: ({ children }) => <span>{children}</span>,
        br: () => <span> </span>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}

export default function Hero() {
  const t = useTranslations('home.sponsored');
  const categoryT = useTranslations('categories');
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<SponsoredProduct[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSponsoredProduct() {
      setLoading(true);
      setMessage(null);
      const maxAttempts = 3;
      const isRetryableMessage = (msg?: string | null) => {
        const m = (msg || '').toLowerCase();
        if (!m) return false;
        return (
          m.includes('降级') ||
          m.includes('超时') ||
          m.includes('不可用') ||
          m.includes('degraded') ||
          m.includes('timeout') ||
          m.includes('timed out') ||
          m.includes('unavailable')
        );
      };

      const delay = async (attempt: number) => {
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(`/api/home/sponsored-top?language=${encodeURIComponent(locale)}`, {
            headers: { 'Accept-Language': locale },
            cache: 'no-store',
          });
          const json: ApiResponse<{ products: SponsoredProduct[]; next_refresh_at: string }> = await response.json();
          if (cancelled) return;

          if (!json.success) {
            if (attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setProducts([]);
            setMessage(json.message ?? null);
            setNextRefreshAt(null);
          } else {
            const payload = json.data;
            const list = payload?.products ?? [];
            if (list.length === 0 && attempt < maxAttempts && isRetryableMessage(json.message)) {
              await delay(attempt);
              continue;
            }
            setProducts(list.slice(0, 2));
            setNextRefreshAt(payload?.next_refresh_at || null);
            if (list.length === 0) setMessage(json.message ?? null);
          }

          if (!cancelled) {
            setLoading(false);
          }
          return;
        } catch {
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
          } else if (!cancelled) {
            setProducts([]);
            setMessage(null);
            setNextRefreshAt(null);
          }
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    }

    fetchSponsoredProduct();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <section className="sf-wash rounded-2xl border border-border bg-card/50 overflow-hidden">
      <div className="px-4 sm:px-6 py-5 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-foreground">{t('title')}</div>
            </div>
          </div>
          <FlipClockCountdown target={nextRefreshAt} showDays={false} scale={0.34} className="shrink-0 origin-top-right" />
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="space-y-3 animate-in fade-in-0 duration-300">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-border bg-background/40 p-5 animate-pulse"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-12 h-12 shrink-0 rounded-lg bg-muted" />
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-1/2 rounded bg-muted" />
                      <div className="mt-2 h-3 w-full rounded bg-muted" />
                      <div className="mt-2 h-3 w-4/5 rounded bg-muted" />
                      <div className="mt-3 h-3 w-1/3 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="w-9 h-9 shrink-0 rounded-md bg-muted" />
                </div>
              </div>
            ))}
            <div className="pt-1 text-center text-xs text-muted-foreground">{t('loading')}</div>
          </div>
        ) : products.length === 0 ? (
          <div className="py-10 animate-in fade-in-0 duration-300">
            <div className="text-sm text-muted-foreground">{message || t('empty')}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
            {products.map((product) => (
              <div key={product.id} className="sf-wash rounded-xl border border-border bg-background/40 p-5 relative overflow-hidden">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-12 h-12 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                      {product.logo_url ? (
                        <Image
                          src={product.logo_url}
                          alt={product.name}
                          width={48}
                          height={48}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          unoptimized
                          loader={({ src }) => src}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm font-semibold">
                          {product.name.trim().slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-base font-semibold text-foreground truncate">{product.name}</div>
                      <Badge variant="outline" className="shrink-0">
                        {t('itemBadge')}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      <SloganMarkdown value={product.slogan} />
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {categoryT(product.category)}
                    </div>
                    </div>
                  </div>
                  <a
                    href={product.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('visit')}
                    className="shrink-0 rounded-md w-9 h-9 flex items-center justify-center border border-border bg-background/70 hover:bg-accent hover:text-accent-foreground transition-all duration-200 active:scale-95"
                  >
                    <i className="ri-global-line text-base" aria-hidden="true" />
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
