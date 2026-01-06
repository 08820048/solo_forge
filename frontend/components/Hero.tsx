'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
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
  const [nowMs, setNowMs] = useState(() => Date.now());

  const countdown = (() => {
    if (!nextRefreshAt) return null;
    const target = Date.parse(nextRefreshAt);
    if (!Number.isFinite(target)) return null;
    const diff = Math.max(0, target - nowMs);
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return { text: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`, totalSeconds };
  })();
  const countdownLabel = countdown?.text ? t('refreshIn', { time: countdown.text }) : null;
  const countdownUrgent = (countdown?.totalSeconds ?? Infinity) <= 10 * 60;

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

  useEffect(() => {
    if (!nextRefreshAt) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [nextRefreshAt]);

  return (
    <section className="sf-wash rounded-2xl border border-border bg-card/50 overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold text-foreground">{t('title')}</div>
            </div>
          </div>
          {countdownLabel ? (
            <Badge
              className={[
                'shadow-md px-3 py-1 text-[11px] font-mono tabular-nums',
                countdownUrgent ? 'bg-primary text-primary-foreground ring-2 ring-primary/25' : 'bg-secondary text-secondary-foreground',
              ].join(' ')}
            >
              <i className="ri-hourglass-fill" aria-hidden="true" />
              <span>{countdownLabel}</span>
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="py-10 text-sm text-muted-foreground">{t('loading')}</div>
        ) : products.length === 0 ? (
          <div className="py-10">
            <div className="text-sm text-muted-foreground">{message || t('empty')}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {products.map((product) => (
              <div key={product.id} className="sf-wash rounded-xl border border-border bg-background/40 p-5 relative overflow-hidden">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-12 h-12 shrink-0 rounded-lg bg-muted flex items-center justify-center overflow-hidden">
                      {product.logo_url ? (
                        <img
                          src={product.logo_url}
                          alt={product.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
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
