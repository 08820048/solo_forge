'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/routing';

type SponsoredProduct = {
  id: string;
  name: string;
  slogan: string;
  description?: string;
  website: string;
  category: string;
  maker_name: string;
  tags?: string[];
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export default function Hero() {
  const t = useTranslations('home.sponsored');
  const categoryT = useTranslations('categories');
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<SponsoredProduct[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchSponsoredProduct() {
      setLoading(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/products?status=approved&tags=sponsored&limit=2&offset=0&language=${locale}`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<SponsoredProduct[]> = await response.json();
        if (cancelled) return;

        if (!json.success) {
          setProducts([]);
          setMessage(json.message ?? null);
          return;
        }

        const list = json.data ?? [];
        setProducts(list.slice(0, 2));
      } catch {
        if (!cancelled) {
          setProducts([]);
          setMessage(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSponsoredProduct();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <section className="rounded-2xl border border-border bg-card/50 overflow-hidden">
      <div className="px-6 py-5 border-b border-border flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-semibold text-foreground tracking-tight">{t('title')}</h1>
            <Badge variant="secondary">{t('badge')}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link href="/submit">{t('cta')}</Link>
        </Button>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-sm text-muted-foreground">{t('loading')}</div>
      ) : products.length === 0 ? (
        <div className="px-6 py-10">
          <div className="text-sm text-muted-foreground">{message || t('empty')}</div>
        </div>
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {products.map((product) => (
              <div key={product.id} className="rounded-xl border border-border bg-background/40 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="text-base font-semibold text-foreground truncate">{product.name}</div>
                      <Badge variant="outline" className="shrink-0">
                        {t('itemBadge')}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground line-clamp-2">{product.slogan}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {categoryT(product.category)} · by {product.maker_name}
                    </div>
                  </div>
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <a href={product.website} target="_blank" rel="noopener noreferrer">
                      {t('visit')}
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
