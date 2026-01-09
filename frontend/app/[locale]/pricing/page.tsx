'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useRouter } from '@/i18n/routing';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type Placement = 'top' | 'right';
type TopSide = 'left' | 'right';
type PlanPreset = 'top' | 'right' | null;

type ProductRow = {
  id?: string | null;
  name?: string | null;
  maker_email?: string | null;
  status?: string | null;
};

type PricingPlanBenefitDto = {
  id: number;
  sort_order: number;
  text_en: string;
  text_zh: string;
  available: boolean;
};

type PricingPlanCampaignDto = {
  active: boolean;
  percent_off?: number | null;
  title_en?: string | null;
  title_zh?: string | null;
  creem_product_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type PricingPlanDto = {
  id: string;
  plan_key: string;
  placement?: string | null;
  monthly_usd_cents?: number | null;
  creem_product_id?: string | null;
  title_en: string;
  title_zh: string;
  badge_en?: string | null;
  badge_zh?: string | null;
  description_en?: string | null;
  description_zh?: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  benefits: PricingPlanBenefitDto[];
  campaign: PricingPlanCampaignDto;
};

type SubmitResult =
  | { kind: 'success' }
  | { kind: 'error'; message: string }
  | null;

type BenefitEntry = { text?: unknown; available?: unknown };

/**
 * normalizePlacement
 * 将 placement 输入规范化为 'top' | 'right'。
 */
function normalizePlacement(value: string): Placement {
  return value === 'right' ? 'right' : 'top';
}

/**
 * normalizeTopSide
 * 将顶部赞助位左右选择规范化为 'left' | 'right'。
 */
function normalizeTopSide(value: string): TopSide {
  return value === 'right' ? 'right' : 'left';
}

/**
 * normalizeBenefit
 * 将多语言 benefits 的多形态数据归一化为 {text, available}。
 */
function normalizeBenefit(value: unknown): { text: string; available: boolean } {
  if (typeof value === 'string') return { text: value, available: true };
  if (value && typeof value === 'object') {
    const entry = value as BenefitEntry;
    const text = typeof entry.text === 'string' ? entry.text : String((entry as Record<string, unknown>).text ?? '');
    const available = entry.available === false ? false : true;
    return { text, available };
  }
  return { text: String(value ?? ''), available: true };
}

/**
 * isPlacementSponsoredTop
 * 判断定价方案是否属于首页顶部赞助位。
 */
function isPlacementSponsoredTop(value: string | null | undefined) {
  return String(value || '').trim() === 'home_top';
}

/**
 * isPlacementSponsoredRight
 * 判断定价方案是否属于首页右侧赞助位。
 */
function isPlacementSponsoredRight(value: string | null | undefined) {
  return String(value || '').trim() === 'home_right';
}

/**
 * formatMonthlyUsdPrice
 * 将美元分格式化为页面展示文案（按月）。
 */
function formatMonthlyUsdPrice(cents: number | null | undefined, locale: string) {
  if (cents === null || cents === undefined) return locale.startsWith('zh') ? '免费' : 'Free';
  const amount = cents / 100;
  const display = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return locale.startsWith('zh') ? `$${display} / 月` : `$${display} / month`;
}

/**
 * applyPercentOff
 * 将价格按折扣百分比计算出折后价（单位：分）。
 */
function applyPercentOff(cents: number, percentOff: number) {
  const p = Math.max(0, Math.min(100, Math.trunc(percentOff)));
  return Math.round((cents * (100 - p)) / 100);
}

function isSameUserEmail(a: string | null | undefined, b: string | null | undefined) {
  const aa = (a || '').trim().toLowerCase();
  const bb = (b || '').trim().toLowerCase();
  if (!aa || !bb) return false;
  return aa === bb;
}

function isApprovedStatus(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase() === 'approved';
}

/**
 * getAuthenticatedUserEmail
 * 从 localStorage 中读取当前登录用户邮箱（仅用于前端跳转/预填）。
 */
function getAuthenticatedUserEmail(): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}

  return null;
}

/**
 * requestAuth
 * 触发全局登录弹窗，并记录登录后回跳路径。
 */
function requestAuth(redirectPath: string) {
  try {
    sessionStorage.setItem('sf_post_login_redirect', redirectPath);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('sf_require_auth', { detail: { redirectPath } }));
  } catch {
    window.dispatchEvent(new Event('sf_require_auth'));
  }
}

export default function PricingPage() {
  const locale = useLocale();
  const t = useTranslations('pricing');
  const router = useRouter();

  const [paidNotice, setPaidNotice] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const paid = params.get('paid');
      if (paid === '1' || paid === 'true') return t('form.submitted');
      return null;
    } catch {
      return null;
    }
  });

  const [showForm, setShowForm] = useState(false);
  const [planPreset, setPlanPreset] = useState<PlanPreset>(null);
  const [placement, setPlacement] = useState<Placement>('top');
  const [product, setProduct] = useState('');
  const [note, setNote] = useState('');
  const [topSide, setTopSide] = useState<TopSide>('left');
  const [rightSlot, setRightSlot] = useState<'1' | '2' | '3'>('1');
  const [months, setMonths] = useState<'1' | '3' | '6' | '12'>('1');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult>(null);
  const canSubmit = product.trim();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsMessage, setProductsMessage] = useState<string | null>(null);

  const [pricingPlans, setPricingPlans] = useState<PricingPlanDto[]>([]);
  const [pricingPlansLoading, setPricingPlansLoading] = useState(false);
  const [pricingPlansMessage, setPricingPlansMessage] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const exampleText = t('instructions.example');

  useEffect(() => {
    let cancelled = false;

    async function syncUser() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const email = data.session?.user?.email || null;
        if (!cancelled) setUserEmail(email ? email.toLowerCase() : null);
      } catch {
        if (!cancelled) setUserEmail(getAuthenticatedUserEmail());
      }
    }

    syncUser();

    const onStorage = () => setUserEmail(getAuthenticatedUserEmail());
    window.addEventListener('storage', onStorage);
    window.addEventListener('sf_user_updated', onStorage as EventListener);

    return () => {
      cancelled = true;
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('sf_user_updated', onStorage as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchProducts() {
      setProductsLoading(true);
      setProductsMessage(null);
      try {
        const response = await fetch(`/api/products?limit=200&offset=0`, { headers: { 'Accept-Language': locale } });
        const json = (await response.json().catch(() => null)) as ApiResponse<ProductRow[]> | null;
        if (cancelled) return;
        if (json?.success) {
          setProducts(Array.isArray(json.data) ? json.data : []);
        } else {
          setProducts([]);
          setProductsMessage(json?.message || t('form.submitFailed'));
        }
      } catch {
        if (!cancelled) {
          setProducts([]);
          setProductsMessage(t('form.submitFailed'));
        }
      } finally {
        if (!cancelled) setProductsLoading(false);
      }
    }

    fetchProducts();

    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchPricingPlans
     * 拉取后端可配置的定价方案列表；失败时回退到本地 i18n 文案渲染。
     */
    async function fetchPricingPlans() {
      setPricingPlansLoading(true);
      setPricingPlansMessage(null);
      try {
        const response = await fetch('/api/pricing-plans', { headers: { 'Accept-Language': locale } });
        const json = (await response.json().catch(() => null)) as ApiResponse<PricingPlanDto[]> | null;
        if (cancelled) return;
        if (response.ok && json?.success) {
          setPricingPlans(Array.isArray(json.data) ? json.data : []);
        } else {
          setPricingPlans([]);
          setPricingPlansMessage(json?.message || t('form.submitFailed'));
        }
      } catch {
        if (!cancelled) {
          setPricingPlans([]);
          setPricingPlansMessage(t('form.submitFailed'));
        }
      } finally {
        if (!cancelled) setPricingPlansLoading(false);
      }
    }

    fetchPricingPlans();
    return () => {
      cancelled = true;
    };
  }, [locale, t]);

  const myApprovedProducts = useMemo(() => {
    if (!userEmail) return [];
    const email = userEmail.toLowerCase();
    return products
      .filter((p) => isSameUserEmail(p.maker_email ?? null, email) && isApprovedStatus(p.status) && String(p.id || '').trim())
      .map((p) => ({ id: String(p.id || '').trim(), name: String(p.name || '').trim() }));
  }, [products, userEmail]);

  const activePricingPlans = useMemo(() => {
    const list = Array.isArray(pricingPlans) ? pricingPlans.filter((p) => p && p.is_active) : [];
    list.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.plan_key.localeCompare(b.plan_key);
    });
    return list;
  }, [pricingPlans]);

  const topPlans = useMemo(() => activePricingPlans.filter((p) => isPlacementSponsoredTop(p.placement ?? null)), [activePricingPlans]);
  const rightPlans = useMemo(
    () => activePricingPlans.filter((p) => isPlacementSponsoredRight(p.placement ?? null)),
    [activePricingPlans]
  );

  const defaultTopPlan = useMemo(() => topPlans.find((p) => p.is_default) || topPlans[0] || null, [topPlans]);
  const defaultRightPlan = useMemo(() => rightPlans.find((p) => p.is_default) || rightPlans[0] || null, [rightPlans]);

  useEffect(() => {
    if (product.trim()) return;
    if (myApprovedProducts.length !== 1) return;
    setProduct(myApprovedProducts[0].id);
  }, [myApprovedProducts, product]);

  useEffect(() => {
    if (selectedPlanId) return;
    if (planPreset === 'top' && defaultTopPlan?.id) setSelectedPlanId(defaultTopPlan.id);
    if (planPreset === 'right' && defaultRightPlan?.id) setSelectedPlanId(defaultRightPlan.id);
  }, [defaultRightPlan?.id, defaultTopPlan?.id, planPreset, selectedPlanId]);

  /**
   * onFreeSubmitNow
   * 处理“免费提交”入口：登录则跳开发者面板，否则弹出登录。
   */
  function onFreeSubmitNow() {
    const redirectPath = '/developer?tab=submit';
    const authenticatedEmail = getAuthenticatedUserEmail();
    if (authenticatedEmail) {
      router.push({ pathname: '/developer', query: { tab: 'submit' } });
      return;
    }
    requestAuth(redirectPath);
  }

  async function createCheckout(payload: {
    token: string;
    productRef: string;
    placement: Placement;
    topSide: TopSide;
    rightSlot: '1' | '2' | '3';
    months: '1' | '3' | '6' | '12';
    note: string;
    planId?: string | null;
  }) {
    const slotIndex = payload.placement === 'top' ? (payload.topSide === 'right' ? 1 : 0) : Number.parseInt(payload.rightSlot, 10) - 1;
    const monthsValue = Number.parseInt(payload.months, 10);
    if (!monthsValue || monthsValue <= 0) {
      setResult({ kind: 'error', message: t('form.submitFailed') });
      return;
    }

    const body: Record<string, unknown> = {
      product_ref: payload.productRef,
      placement: payload.placement === 'top' ? 'home_top' : 'home_right',
      slot_index: slotIndex,
      months: monthsValue,
      note: payload.note.trim() ? payload.note.trim() : null,
      plan_id: payload.planId ? String(payload.planId).trim() : null,
    };

    const response = await fetch('/api/sponsorship/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': locale, Authorization: `Bearer ${payload.token}` },
      body: JSON.stringify(body),
    });

    const json = (await response.json().catch(() => null)) as ApiResponse<{ checkout_url?: string; order_id?: string }> | null;
    const checkoutUrl = (json?.data?.checkout_url || '').trim();
    if (response.ok && json?.success && checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }

    setResult({ kind: 'error', message: json?.message || t('form.submitFailed') });
  }

  async function startSponsor(preset: 'top' | 'right', planId?: string | null) {
    setPlanPreset(preset);
    setPlacement(preset);
    if (preset === 'top') setTopSide('left');
    else setRightSlot('1');
    setMonths('1');
    setResult(null);
    setPaidNotice(null);
    setSelectedPlanId(planId ? String(planId).trim() : preset === 'top' ? defaultTopPlan?.id ?? null : defaultRightPlan?.id ?? null);

    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || '';
      if (!token) {
        requestAuth('/pricing');
        return;
      }

      if (myApprovedProducts.length === 1) {
        const productId = myApprovedProducts[0].id;
        setSubmitting(true);
        setProduct(productId);
        await createCheckout({
          token,
          productRef: productId,
          placement: preset,
          topSide: 'left',
          rightSlot: '1',
          months: '1',
          note: '',
          planId: planId ? String(planId).trim() : preset === 'top' ? defaultTopPlan?.id ?? null : defaultRightPlan?.id ?? null,
        });
        return;
      }

      setShowForm(true);
    } catch {
      setShowForm(true);
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * submitListing
   * 创建赞助支付并跳转到 Creem Checkout；赞助时长仅允许按月选择。
   */
  async function submitListing() {
    const normalizedProduct = product.trim();
    const normalizedNote = note.trim();

    if (!normalizedProduct) {
      setResult({ kind: 'error', message: t('form.missingRequired') });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token || '';
      if (!token) {
        requestAuth('/pricing');
        setResult({ kind: 'error', message: t('form.submitFailed') });
        return;
      }
      await createCheckout({
        token,
        productRef: normalizedProduct,
        placement,
        topSide,
        rightSlot,
        months,
        note: normalizedNote,
        planId: (() => {
          const current = selectedPlanId ? activePricingPlans.find((p) => p.id === selectedPlanId) : null;
          const expected = placement === 'top' ? 'home_top' : 'home_right';
          if (current && String(current.placement || '').trim() === expected) return current.id;
          const fallback = placement === 'top' ? defaultTopPlan : defaultRightPlan;
          return fallback?.id ?? null;
        })(),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : t('form.submitFailed');
      setResult({ kind: 'error', message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl pt-20 sm:pt-24 pb-10 px-4 sm:px-6">
      <div className="sf-wash rounded-2xl border border-border bg-card/50 overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('title')}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-8">
          {paidNotice ? (
            <Alert>
              <i className="ri-checkbox-circle-line" aria-hidden="true" />
              <AlertTitle>{paidNotice}</AlertTitle>
              <AlertDescription>{paidNotice}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="relative rounded-2xl border border-border/80 bg-background/70 p-5 shadow-sm flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-muted/40 to-transparent" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">{t('tiers.free.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('tiers.free.desc')}</div>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {t('tiers.free.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                <div className="text-3xl font-bold text-foreground">{t('tiers.free.price')}</div>
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {(t.raw('tiers.free.benefits') as unknown[]).map((item, idx) => {
                  const b = normalizeBenefit(item);
                  return (
                    <li key={idx} className="flex items-start gap-2">
                      <i className="ri-check-line text-base text-primary" aria-hidden="true" />
                      <span>{b.text}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button type="button" className="h-12 rounded-xl bg-background/70" variant="outline" onClick={onFreeSubmitNow}>
                  {t('actions.submitNow')}
                </Button>
              </div>
            </div>

            <div className="relative rounded-2xl border border-primary/50 bg-linear-to-b from-primary/15 via-background to-background p-5 shadow-md flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-primary/15 blur-2xl" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">
                    {defaultTopPlan ? (locale.startsWith('zh') ? defaultTopPlan.title_zh : defaultTopPlan.title_en) : t('tiers.top.title')}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {defaultTopPlan
                      ? (locale.startsWith('zh') ? defaultTopPlan.description_zh : defaultTopPlan.description_en) || ''
                      : t('tiers.top.desc')}
                  </div>
                </div>
                <Badge className="shrink-0 bg-primary text-primary-foreground ring-2 ring-primary/25">
                  {defaultTopPlan
                    ? (locale.startsWith('zh') ? defaultTopPlan.badge_zh : defaultTopPlan.badge_en) || t('tiers.top.badge')
                    : t('tiers.top.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                {defaultTopPlan?.monthly_usd_cents != null && defaultTopPlan.campaign?.active && defaultTopPlan.campaign.percent_off ? (
                  <>
                    <div className="text-3xl font-bold text-foreground">
                      {formatMonthlyUsdPrice(
                        applyPercentOff(defaultTopPlan.monthly_usd_cents, defaultTopPlan.campaign.percent_off),
                        locale
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground line-through">
                      {formatMonthlyUsdPrice(defaultTopPlan.monthly_usd_cents, locale)}
                    </div>
                  </>
                ) : (
                  <div className="text-3xl font-bold text-foreground">
                    {defaultTopPlan ? formatMonthlyUsdPrice(defaultTopPlan.monthly_usd_cents ?? null, locale) : t('tiers.top.price')}
                  </div>
                )}
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {defaultTopPlan
                  ? defaultTopPlan.benefits.map((item, idx) => {
                      const b = { text: locale.startsWith('zh') ? item.text_zh : item.text_en, available: item.available };
                      return (
                        <li key={idx} className="flex items-start gap-2">
                          <i
                            className={[
                              b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                              'text-base',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <span>{b.text}</span>
                        </li>
                      );
                    })
                  : (t.raw('tiers.top.benefits') as unknown[]).map((item, idx) => {
                      const b = normalizeBenefit(item);
                      return (
                        <li key={idx} className="flex items-start gap-2">
                          <i
                            className={[
                              b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                              'text-base',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <span>{b.text}</span>
                        </li>
                      );
                    })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button
                  type="button"
                  className="h-12 rounded-xl bg-linear-to-t from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25 hover:opacity-95"
                  onClick={() => startSponsor('top', defaultTopPlan?.id ?? null)}
                >
                  {t('actions.sponsor')}
                </Button>
              </div>
            </div>

            <div className="relative rounded-2xl border border-border/80 bg-background/70 p-5 shadow-sm flex flex-col h-full overflow-hidden">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-linear-to-b from-muted/40 to-transparent" />
              <div className="relative flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground tracking-tight">
                    {defaultRightPlan
                      ? (locale.startsWith('zh') ? defaultRightPlan.title_zh : defaultRightPlan.title_en)
                      : t('tiers.right.title')}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {defaultRightPlan
                      ? (locale.startsWith('zh') ? defaultRightPlan.description_zh : defaultRightPlan.description_en) || ''
                      : t('tiers.right.desc')}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {defaultRightPlan
                    ? (locale.startsWith('zh') ? defaultRightPlan.badge_zh : defaultRightPlan.badge_en) || t('tiers.right.badge')
                    : t('tiers.right.badge')}
                </Badge>
              </div>
              <div className="relative mt-5 flex items-end gap-2">
                {defaultRightPlan?.monthly_usd_cents != null && defaultRightPlan.campaign?.active && defaultRightPlan.campaign.percent_off ? (
                  <>
                    <div className="text-3xl font-bold text-foreground">
                      {formatMonthlyUsdPrice(
                        applyPercentOff(defaultRightPlan.monthly_usd_cents, defaultRightPlan.campaign.percent_off),
                        locale
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground line-through">
                      {formatMonthlyUsdPrice(defaultRightPlan.monthly_usd_cents, locale)}
                    </div>
                  </>
                ) : (
                  <div className="text-3xl font-bold text-foreground">
                    {defaultRightPlan ? formatMonthlyUsdPrice(defaultRightPlan.monthly_usd_cents ?? null, locale) : t('tiers.right.price')}
                  </div>
                )}
              </div>
              <ul className="relative mt-4 space-y-2 text-sm text-muted-foreground">
                {defaultRightPlan
                  ? defaultRightPlan.benefits.map((item, idx) => {
                      const b = { text: locale.startsWith('zh') ? item.text_zh : item.text_en, available: item.available };
                      return (
                        <li key={idx} className="flex items-start gap-2">
                          <i
                            className={[
                              b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                              'text-base',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <span>{b.text}</span>
                        </li>
                      );
                    })
                  : (t.raw('tiers.right.benefits') as unknown[]).map((item, idx) => {
                      const b = normalizeBenefit(item);
                      return (
                        <li key={idx} className="flex items-start gap-2">
                          <i
                            className={[
                              b.available ? 'ri-check-line text-primary' : 'ri-close-line text-destructive',
                              'text-base',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <span>{b.text}</span>
                        </li>
                      );
                    })}
              </ul>
              <div className="relative mt-5 grid grid-cols-1 gap-2">
                <Button
                  type="button"
                  className="h-12 rounded-xl bg-linear-to-t from-neutral-900 to-neutral-700 text-white shadow-lg shadow-black/10 hover:opacity-95"
                  onClick={() => startSponsor('right', defaultRightPlan?.id ?? null)}
                >
                  {t('actions.sponsor')}
                </Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-background/40 p-5">
            <div className="text-sm font-semibold text-foreground">FAQ</div>
            <div className="mt-3 space-y-3">
              <details className="rounded-lg border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground flex items-center justify-between">
                  <span>{t('instructions.title')}</span>
                  <i className="ri-add-line text-base text-muted-foreground" aria-hidden="true" />
                </summary>
                  <div className="mt-3 text-sm text-muted-foreground">
                  <p>{t('instructions.desc')}</p>
                  <div className="mt-3 space-y-1">
                    <div>• {t('instructions.fields.product')}</div>
                    <div>• {t('instructions.fields.placement')}</div>
                    <div>• {t('instructions.fields.slot')}</div>
                    <div>• {t('instructions.fields.duration')}</div>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-border bg-background/60 px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground flex items-center justify-between">
                  <span>{t('instructions.exampleTitle')}</span>
                  <i className="ri-add-line text-base text-muted-foreground" aria-hidden="true" />
                </summary>
                <div className="mt-3">
                  <pre className="whitespace-pre-wrap rounded-md border border-border bg-background/60 px-3 py-2 text-xs text-foreground/90">
                    {exampleText}
                  </pre>
                </div>
              </details>
            </div>
          </div>

          {showForm ? (
            <div className="rounded-xl border border-border bg-background/40 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{t('form.title')}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{t('form.desc')}</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="product">{t('form.product')}</Label>
                  {myApprovedProducts.length ? (
                    <select
                      id="product"
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                      disabled={submitting}
                    >
                      <option value="">{productsLoading ? t('loading') : t('form.productPlaceholder')}</option>
                      {myApprovedProducts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name ? `${p.name} (${p.id})` : p.id}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id="product"
                      value={product}
                      onChange={(e) => setProduct(e.target.value)}
                      placeholder={t('form.productPlaceholder')}
                      disabled={submitting}
                    />
                  )}
                  {productsMessage ? <div className="text-xs text-muted-foreground">{productsMessage}</div> : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="placement">{t('form.placement')}</Label>
                  {planPreset === 'right' ? (
                    <select
                      id="placement"
                      value="right"
                      disabled
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="right">{t('form.placementRight')}</option>
                    </select>
                  ) : (
                    <select
                      id="placement"
                      value={placement}
                      onChange={(e) => {
                        const next = normalizePlacement(e.target.value);
                        setPlacement(next);
                        const fallback = next === 'top' ? defaultTopPlan : defaultRightPlan;
                        setSelectedPlanId(fallback?.id ?? null);
                      }}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="top">{t('form.placementTop')}</option>
                      <option value="right">{t('form.placementRight')}</option>
                    </select>
                  )}
                </div>

                {(placement === 'top' ? topPlans : rightPlans).length ? (
                  <div className="space-y-2">
                    <Label htmlFor="plan">{locale.startsWith('zh') ? '定价方案' : 'Pricing plan'}</Label>
                    <select
                      id="plan"
                      value={selectedPlanId || ''}
                      onChange={(e) => setSelectedPlanId(e.target.value || null)}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                      disabled={submitting}
                    >
                      <option value="">{pricingPlansLoading ? t('loading') : locale.startsWith('zh') ? '自动选择默认方案' : 'Auto select default'}</option>
                      {(placement === 'top' ? topPlans : rightPlans).map((p) => (
                        <option key={p.id} value={p.id}>
                          {(locale.startsWith('zh') ? p.title_zh : p.title_en) || p.plan_key} · {formatMonthlyUsdPrice(p.monthly_usd_cents ?? null, locale)}
                        </option>
                      ))}
                    </select>
                    {pricingPlansMessage ? <div className="text-xs text-muted-foreground">{pricingPlansMessage}</div> : null}
                  </div>
                ) : pricingPlansMessage ? (
                  <div className="space-y-2">
                    <Label>{locale.startsWith('zh') ? '定价方案' : 'Pricing plan'}</Label>
                    <div className="text-xs text-muted-foreground">{pricingPlansMessage}</div>
                  </div>
                ) : null}

                {placement === 'top' ? (
                  <div className="space-y-2">
                    <Label htmlFor="topSide">{t('form.topSide')}</Label>
                    <select
                      id="topSide"
                      value={topSide}
                      onChange={(e) => setTopSide(normalizeTopSide(e.target.value))}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="left">{t('form.topSideLeft')}</option>
                      <option value="right">{t('form.topSideRight')}</option>
                    </select>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="rightSlot">{t('form.rightSlot')}</Label>
                    <select
                      id="rightSlot"
                      value={rightSlot}
                      onChange={(e) => setRightSlot((e.target.value === '2' ? '2' : e.target.value === '3' ? '3' : '1'))}
                      className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                    </select>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="months">{t('form.duration')}</Label>
                  <select
                    id="months"
                    value={months}
                    onChange={(e) => setMonths(e.target.value === '3' ? '3' : e.target.value === '6' ? '6' : e.target.value === '12' ? '12' : '1')}
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-none"
                  >
                    <option value="1">1</option>
                    <option value="3">3</option>
                    <option value="6">6</option>
                    <option value="12">12</option>
                  </select>
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="note">{t('form.note')}</Label>
                  <Textarea
                    id="note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={t('form.notePlaceholder')}
                    rows={4}
                  />
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <Button type="button" onClick={submitListing} disabled={!canSubmit || submitting}>
                  {submitting ? t('actions.submitting') : t('actions.submit')}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowForm(false);
                    setResult(null);
                    setPlanPreset(null);
                    setSelectedPlanId(null);
                  }}
                >
                  {t('actions.close')}
                </Button>
              </div>

              {result ? (
                <div className="mt-4">
                  {result.kind === 'success' ? (
                    <Alert>
                      <i className="ri-checkbox-circle-line" aria-hidden="true" />
                      <AlertTitle>{t('form.submitted')}</AlertTitle>
                      <AlertDescription>{t('form.submitted')}</AlertDescription>
                    </Alert>
                  ) : (
                    <Alert variant="destructive">
                      <i className="ri-error-warning-line" aria-hidden="true" />
                      <AlertTitle>{t('form.submitFailed')}</AlertTitle>
                      <AlertDescription>
                        <p>{result.message}</p>
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
