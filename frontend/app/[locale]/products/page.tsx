'use client';

import { useTranslations, useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import ProductCard from '@/components/ProductCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Product {
  id: string;
  name: string;
  slogan: string;
  logo_url?: string;
  category: string;
  maker_name: string;
  maker_email?: string | null;
  website: string;
  likes: number;
  favorites: number;
}

interface Category {
  id: string;
  name_en: string;
  name_zh: string;
  icon: string;
  color: string;
}

interface ApiError {
  code: string;
  trace_id: string;
  degraded: boolean;
  hint?: string | null;
  detail?: string | null;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T[];
  message?: string;
  error?: ApiError | null;
}

export default function ProductsPage() {
  const t = useTranslations('products');
  const categoryT = useTranslations('categories');
  const locale = useLocale();
  const searchParams = useSearchParams();

  // Extract query parameters
  const category = searchParams.get('category') || '';
  const search = searchParams.get('search') || '';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState(category || 'all');
  const [searchQuery, setSearchQuery] = useState(search);

  useEffect(() => {
    async function fetchData() {
      try {
        const params = new URLSearchParams();
        params.set('status', 'approved');
        params.set('sort', 'likes');
        params.set('dir', 'desc');
        params.set('language', locale);
        if (selectedCategory !== 'all') params.set('category', selectedCategory);
        if (searchQuery) params.set('search', searchQuery);

        // Fetch products
        const productsResponse = await fetch(
          `/api/products?${params.toString()}`,
          { headers: { 'Accept-Language': locale } }
        );
        const productsData: ApiResponse<Product> = await productsResponse.json();

        if (productsData.success) {
          const nextProducts = (productsData.data ?? []).map((p) => ({
            ...p,
            likes: typeof (p as unknown as { likes?: unknown }).likes === 'number' ? p.likes : Number((p as unknown as { likes?: unknown }).likes ?? 0),
            favorites:
              typeof (p as unknown as { favorites?: unknown }).favorites === 'number'
                ? p.favorites
                : Number((p as unknown as { favorites?: unknown }).favorites ?? 0),
          }));
          setProducts(nextProducts);
        }

        // Fetch categories
        const categoriesResponse = await fetch('/api/categories', {
          headers: { 'Accept-Language': locale }
        });
        const categoriesData: ApiResponse<Category> = await categoriesResponse.json();

        if (categoriesData.success) {
          setCategories(categoriesData.data ?? []);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedCategory, searchQuery, locale]);

  // Apply filters
  const filteredProducts = products.filter(product => {
    const matchesCategory = selectedCategory === 'all' || product.category === selectedCategory;
    const matchesSearch = !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.slogan.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.maker_name.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const categoryIconOverrides: Record<string, string> = {
    ai: 'robot-3-line',
    design: 'figma-line',
    developer: 'code-ai-line',
    education: 'school-line',
    finance: 'visa-line',
    games: 'gamepad-line',
    lifestyle: 'home-smile-line',
    marketing: 'bubble-chart-line',
    productivity: 'tools-line',
    writing: 'quill-pen-ai-line',
  };

  const normalizeRemixIconClass = (raw?: string | null) => {
    const name = (raw || '').trim();
    if (!name) return null;
    return name.startsWith('ri-') ? name : `ri-${name}`;
  };

  const categoryOptions = [
    { id: 'all', label: t('filters.allCategories'), iconClass: 'ri-apps-line' },
    ...categories.map((cat) => {
      const iconClass =
        normalizeRemixIconClass(categoryIconOverrides[cat.id] ?? cat.icon) ?? 'ri-price-tag-3-line';
      return { id: cat.id, label: categoryT(cat.id), iconClass };
    }),
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-foreground/30 mx-auto"></div>
          <p className="mt-4 text-muted-foreground">{t('loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 2xl:px-12 py-12">
        <div className="mb-12 animate-on-scroll">
          <h1 className="text-5xl font-bold text-foreground mb-6 font-sans tracking-tight">{t('title')}</h1>
          <p className="text-xl text-muted-foreground font-sans">{t('subtitle', { count: filteredProducts.length })}</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="w-full sm:w-[360px]">
            <Input
              placeholder={t('filters.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-background/60 backdrop-blur"
            />
          </div>

          <div className="w-full sm:flex-1 overflow-x-auto">
            <div className="flex items-center gap-2 whitespace-nowrap">
              {categoryOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelectedCategory(opt.id)}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors',
                    selectedCategory === opt.id
                      ? 'border-foreground/20 bg-foreground text-background'
                      : 'border-border bg-background/60 backdrop-blur text-muted-foreground hover:bg-accent hover:text-foreground',
                  ].join(' ')}
                >
                  <i className={opt.iconClass} aria-hidden="true" />
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {(selectedCategory !== 'all' || searchQuery) && (
            <Button
              variant="outline"
              onClick={() => {
                setSelectedCategory('all');
                setSearchQuery('');
              }}
              className="w-full sm:w-auto"
            >
              {t('filters.clear')}
            </Button>
          )}
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <ProductCard key={product.id} product={product} variant="productsList" />
          ))}
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-12 animate-on-scroll">
            <div className="w-16 h-16 bg-zinc-100 dark:bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-200 dark:border-white/10">
              <svg className="w-8 h-8 text-zinc-400 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{t('noProducts.title')}</h3>
            <p className="text-muted-foreground">{t('noProducts.message')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
