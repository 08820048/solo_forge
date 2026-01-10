'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type PricingPlanBenefit = {
  id: number;
  sort_order: number;
  text_en: string;
  text_zh: string;
  available: boolean;
};

type PricingPlanCampaign = {
  active: boolean;
  percent_off?: number | null;
  title_en?: string | null;
  title_zh?: string | null;
  creem_product_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type PricingPlan = {
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
  benefits: PricingPlanBenefit[];
  campaign: PricingPlanCampaign;
  created_at: string;
  updated_at: string;
};

type UpsertPricingPlanBenefit = {
  id?: number | null;
  sort_order: number;
  text_en: string;
  text_zh: string;
  available: boolean;
};

type UpsertPricingPlanRequest = {
  id?: string | null;
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
  benefits: UpsertPricingPlanBenefit[];
  campaign: PricingPlanCampaign;
};

type PaymentsDayAgg = { day: string; paid_orders: number; gross_usd_cents: number };
type PaymentsSummary = {
  created_orders: number;
  paid_orders: number;
  failed_orders: number;
  canceled_orders: number;
  gross_usd_cents: number;
  by_day: PaymentsDayAgg[];
};

type SponsorshipOrder = {
  id: string;
  user_email: string;
  user_id?: string | null;
  product_id: string;
  placement: string;
  slot_index?: number | null;
  requested_months: number;
  paid_months?: number | null;
  status: string;
  provider: string;
  provider_checkout_id?: string | null;
  provider_order_id?: string | null;
  amount_usd_cents?: number | null;
  grant_id?: number | null;
  created_at: string;
  updated_at: string;
};

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

function formatUsd(cents: number | null | undefined) {
  const v = Number(cents ?? 0);
  if (!Number.isFinite(v)) return '—';
  return `$${(v / 100).toFixed(2)}`;
}

function normalizeOptionalString(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function parseOptionalInt(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number.parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toUpsertDraft(plan?: PricingPlan | null): UpsertPricingPlanRequest {
  if (!plan) {
    return {
      id: null,
      plan_key: '',
      placement: 'home_right',
      monthly_usd_cents: 9900,
      creem_product_id: null,
      title_en: '',
      title_zh: '',
      badge_en: null,
      badge_zh: null,
      description_en: null,
      description_zh: null,
      is_active: true,
      is_default: false,
      sort_order: 100,
      benefits: [
        { sort_order: 1, text_en: 'Priority placement', text_zh: '优先展示', available: true },
        { sort_order: 2, text_en: 'Support development', text_zh: '支持开发', available: true },
      ],
      campaign: { active: false, percent_off: null, title_en: null, title_zh: null, creem_product_id: null, starts_at: null, ends_at: null },
    };
  }

  return {
    id: plan.id,
    plan_key: plan.plan_key,
    placement: plan.placement ?? null,
    monthly_usd_cents: plan.monthly_usd_cents ?? null,
    creem_product_id: plan.creem_product_id ?? null,
    title_en: plan.title_en,
    title_zh: plan.title_zh,
    badge_en: plan.badge_en ?? null,
    badge_zh: plan.badge_zh ?? null,
    description_en: plan.description_en ?? null,
    description_zh: plan.description_zh ?? null,
    is_active: plan.is_active,
    is_default: plan.is_default,
    sort_order: plan.sort_order,
    benefits: (plan.benefits ?? []).map((b) => ({
      id: b.id,
      sort_order: b.sort_order,
      text_en: b.text_en,
      text_zh: b.text_zh,
      available: b.available,
    })),
    campaign: {
      active: Boolean(plan.campaign?.active),
      percent_off: plan.campaign?.percent_off ?? null,
      title_en: plan.campaign?.title_en ?? null,
      title_zh: plan.campaign?.title_zh ?? null,
      creem_product_id: plan.campaign?.creem_product_id ?? null,
      starts_at: plan.campaign?.starts_at ?? null,
      ends_at: plan.campaign?.ends_at ?? null,
    },
  };
}

export default function AdminPricingPage() {
  const [tab, setTab] = useState<'plans' | 'payments'>('plans');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [plans, setPlans] = useState<PricingPlan[]>([]);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<UpsertPricingPlanRequest | null>(null);

  const [paymentsDays, setPaymentsDays] = useState('30');
  const [summary, setSummary] = useState<PaymentsSummary | null>(null);
  const [orders, setOrders] = useState<SponsorshipOrder[]>([]);
  const [ordersStatus, setOrdersStatus] = useState('paid');

  const sortedPlans = useMemo(() => {
    const list = Array.isArray(plans) ? [...plans] : [];
    list.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.plan_key.localeCompare(b.plan_key);
    });
    return list;
  }, [plans]);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const params = new URLSearchParams();
      params.set('include_inactive', includeInactive ? 'true' : 'false');
      const res = await fetch(`/api/admin/pricing-plans?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<PricingPlan[]> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '加载失败。');
        return;
      }
      setPlans(Array.isArray(json.data) ? json.data : []);
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [includeInactive]);

  const loadPayments = useCallback(async () => {
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const days = Number.parseInt(paymentsDays, 10);
      const params = new URLSearchParams();
      if (Number.isFinite(days) && days > 0) params.set('days', String(days));
      const res = await fetch(`/api/admin/payments/summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<PaymentsSummary> | null;
      if (!res.ok || !json?.success || !json.data) {
        setMessage(json?.message || '加载失败。');
        return;
      }
      setSummary(json.data);
    } catch {
      setMessage('网络错误，请稍后重试。');
    }
  }, [paymentsDays]);

  const loadOrders = useCallback(async () => {
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('offset', '0');
      if (ordersStatus.trim()) params.set('status', ordersStatus.trim());
      const res = await fetch(`/api/admin/payments/orders?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<SponsorshipOrder[]> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '加载失败。');
        return;
      }
      setOrders(Array.isArray(json.data) ? json.data : []);
    } catch {
      setMessage('网络错误，请稍后重试。');
    }
  }, [ordersStatus]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (tab !== 'payments') return;
    void loadPayments();
    void loadOrders();
  }, [tab, loadPayments, loadOrders]);

  const startCreate = () => {
    setHint(null);
    setMessage(null);
    setEditingId('new');
    setDraft(toUpsertDraft(null));
  };

  const startEdit = (plan: PricingPlan) => {
    setHint(null);
    setMessage(null);
    setEditingId(plan.id);
    setDraft(toUpsertDraft(plan));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    const key = 'save';
    if (busy[key]) return;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }

      const payload: UpsertPricingPlanRequest = {
        ...draft,
        plan_key: String(draft.plan_key || '').trim(),
        title_en: String(draft.title_en || '').trim(),
        title_zh: String(draft.title_zh || '').trim(),
        placement: normalizeOptionalString(draft.placement),
        creem_product_id: normalizeOptionalString(draft.creem_product_id),
        badge_en: normalizeOptionalString(draft.badge_en),
        badge_zh: normalizeOptionalString(draft.badge_zh),
        description_en: normalizeOptionalString(draft.description_en),
        description_zh: normalizeOptionalString(draft.description_zh),
        monthly_usd_cents: parseOptionalInt(draft.monthly_usd_cents),
        sort_order: Number.parseInt(String(draft.sort_order ?? 0), 10) || 0,
        benefits: Array.isArray(draft.benefits)
          ? draft.benefits
              .map((b) => ({
                id: b.id ?? null,
                sort_order: Number.parseInt(String(b.sort_order ?? 0), 10) || 0,
                text_en: String(b.text_en || '').trim(),
                text_zh: String(b.text_zh || '').trim(),
                available: Boolean(b.available),
              }))
              .filter((b) => Boolean(b.text_en || b.text_zh))
          : [],
        campaign: {
          active: Boolean(draft.campaign?.active),
          percent_off: parseOptionalInt(draft.campaign?.percent_off),
          title_en: normalizeOptionalString(draft.campaign?.title_en),
          title_zh: normalizeOptionalString(draft.campaign?.title_zh),
          creem_product_id: normalizeOptionalString(draft.campaign?.creem_product_id),
          starts_at: normalizeOptionalString(draft.campaign?.starts_at),
          ends_at: normalizeOptionalString(draft.campaign?.ends_at),
        },
      };

      if (!payload.plan_key) {
        setMessage('请填写 plan_key。');
        return;
      }
      if (!payload.title_en || !payload.title_zh) {
        setMessage('请填写中英文标题。');
        return;
      }

      const res = await fetch('/api/admin/pricing-plans', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<PricingPlan> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '保存失败。');
        return;
      }
      setHint('已保存。');
      setEditingId(null);
      setDraft(null);
      await loadPlans();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, save: false }));
    }
  };

  const remove = async (id: string) => {
    const key = `delete:${id}`;
    if (busy[key]) return;
    if (!id.trim()) return;
    const ok = window.confirm('确认删除该方案？');
    if (!ok) return;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const res = await fetch(`/api/admin/pricing-plans/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<{ ok?: boolean } | null> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '删除失败。');
        return;
      }
      setHint('已删除。');
      if (editingId === id) cancelEdit();
      await loadPlans();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  };

  const markOrderPaid = async (order: SponsorshipOrder) => {
    const key = `markPaid:${order.id}`;
    if (busy[key]) return;
    if (!order.id.trim()) return;
    const ok = window.confirm(`确认将该订单标记为已支付并发放定价位？\n${order.id}`);
    if (!ok) return;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const res = await fetch('/api/admin/payments/orders', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_paid', order_id: order.id }),
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '操作失败。');
        return;
      }
      setHint('已标记为已支付。');
      await loadOrders();
      await loadPayments();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  };

  const canEdit = Boolean(editingId && draft);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">定价与支付</div>
          <div className="mt-1 text-sm text-muted-foreground">定价方案配置、优惠活动与支付订单统计。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClassName({ variant: tab === 'plans' ? 'default' : 'outline' })}
            onClick={() => setTab('plans')}
          >
            定价方案
          </button>
          <button
            className={buttonClassName({ variant: tab === 'payments' ? 'default' : 'outline' })}
            onClick={() => setTab('payments')}
          >
            支付与订单
          </button>
        </div>
      </div>

      {message ? (
        <Card>
          <CardContent className="text-sm text-destructive">{message}</CardContent>
        </Card>
      ) : null}
      {hint ? (
        <Card>
          <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>
        </Card>
      ) : null}

      {tab === 'plans' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>方案列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <input
                    id="includeInactive"
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                  />
                  <label htmlFor="includeInactive" className="text-muted-foreground">
                    显示停用方案
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={loading} onClick={() => void loadPlans()}>
                    刷新
                  </Button>
                  <Button disabled={loading || Boolean(editingId)} onClick={startCreate}>
                    新建方案
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="py-10 text-sm text-muted-foreground">加载中...</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">sort</th>
                        <th className="py-2 text-left font-medium">plan_key</th>
                        <th className="py-2 text-left font-medium">placement</th>
                        <th className="py-2 text-left font-medium">价格</th>
                        <th className="py-2 text-left font-medium">Creem 产品</th>
                        <th className="py-2 text-left font-medium">状态</th>
                        <th className="py-2 text-right font-medium">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPlans.map((p) => (
                        <tr key={p.id} className="border-b border-border/60">
                          <td className="py-2 tabular-nums">{p.sort_order}</td>
                          <td className="py-2">
                            <div className="font-medium">{p.plan_key}</div>
                            <div className="text-xs text-muted-foreground">{p.title_zh}</div>
                          </td>
                          <td className="py-2">{p.placement || '—'}</td>
                          <td className="py-2 tabular-nums">{formatUsd(p.monthly_usd_cents ?? null)}</td>
                          <td className="py-2">{p.creem_product_id || '—'}</td>
                          <td className="py-2">
                            <span className={p.is_active ? 'text-foreground' : 'text-muted-foreground'}>
                              {p.is_active ? '启用' : '停用'}
                            </span>
                            {p.is_default ? <span className="ml-2 text-xs text-muted-foreground">默认</span> : null}
                            {p.campaign?.active ? <span className="ml-2 text-xs text-muted-foreground">活动中</span> : null}
                          </td>
                          <td className="py-2 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={Boolean(editingId)}
                                onClick={() => startEdit(p)}
                              >
                                编辑
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={Boolean(editingId) || busy[`delete:${p.id}`]}
                                onClick={() => void remove(p.id)}
                              >
                                删除
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {sortedPlans.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-6 text-muted-foreground">
                            暂无方案
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {canEdit ? (
            <Card>
              <CardHeader>
                <CardTitle>{editingId === 'new' ? '新建方案' : '编辑方案'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">plan_key（唯一）</div>
                    <Input
                      value={draft?.plan_key ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, plan_key: e.target.value } : d))}
                      placeholder="e.g. pro_monthly"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">placement</div>
                    <select
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={draft?.placement ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, placement: e.target.value } : d))}
                    >
                      <option value="">不限</option>
                      <option value="home_top">home_top</option>
                      <option value="home_right">home_right</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">月价格（USD cents）</div>
                    <Input
                      type="number"
                      value={draft?.monthly_usd_cents ?? ''}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, monthly_usd_cents: Number.parseInt(e.target.value || '', 10) } : d))
                      }
                      placeholder="e.g. 9900"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">支付产品 ID / 外部支付链接</div>
                    <Input
                      value={draft?.creem_product_id ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, creem_product_id: e.target.value } : d))}
                      placeholder="prod_... 或 https://...（支持 {{ORDER_ID}} 等占位符）"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">标题（英文）</div>
                    <Input
                      value={draft?.title_en ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, title_en: e.target.value } : d))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">标题（中文）</div>
                    <Input
                      value={draft?.title_zh ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, title_zh: e.target.value } : d))}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">角标（英文）</div>
                    <Input
                      value={draft?.badge_en ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, badge_en: e.target.value } : d))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">角标（中文）</div>
                    <Input
                      value={draft?.badge_zh ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, badge_zh: e.target.value } : d))}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">描述（英文）</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft?.description_en ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, description_en: e.target.value } : d))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">描述（中文）</div>
                    <textarea
                      className="min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={draft?.description_zh ?? ''}
                      onChange={(e) => setDraft((d) => (d ? { ...d, description_zh: e.target.value } : d))}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">sort_order</div>
                    <Input
                      type="number"
                      value={draft?.sort_order ?? 0}
                      onChange={(e) =>
                        setDraft((d) => (d ? { ...d, sort_order: Number.parseInt(e.target.value || '0', 10) } : d))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">状态</div>
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(draft?.is_active)}
                          onChange={(e) => setDraft((d) => (d ? { ...d, is_active: e.target.checked } : d))}
                        />
                        启用
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(draft?.is_default)}
                          onChange={(e) => setDraft((d) => (d ? { ...d, is_default: e.target.checked } : d))}
                        />
                        默认
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">权益（benefits）</div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                benefits: [
                                  ...(Array.isArray(d.benefits) ? d.benefits : []),
                                  { sort_order: (d.benefits?.length ?? 0) + 1, text_en: '', text_zh: '', available: true },
                                ],
                              }
                            : d
                        )
                      }
                    >
                      添加权益
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr className="border-b border-border">
                          <th className="py-2 text-left font-medium w-[90px]">sort</th>
                          <th className="py-2 text-left font-medium">中文</th>
                          <th className="py-2 text-left font-medium">英文</th>
                          <th className="py-2 text-left font-medium w-[90px]">可用</th>
                          <th className="py-2 text-right font-medium w-[110px]">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(draft?.benefits ?? []).map((b, idx) => (
                          <tr key={`${idx}:${b.id ?? 'new'}`} className="border-b border-border/60">
                            <td className="py-2 pr-2">
                              <Input
                                type="number"
                                value={b.sort_order}
                                onChange={(e) => {
                                  const v = Number.parseInt(e.target.value || '0', 10);
                                  setDraft((d) => {
                                    if (!d) return d;
                                    const next = [...(d.benefits ?? [])];
                                    next[idx] = { ...next[idx], sort_order: Number.isFinite(v) ? v : 0 };
                                    return { ...d, benefits: next };
                                  });
                                }}
                              />
                            </td>
                            <td className="py-2 pr-2">
                              <Input
                                value={b.text_zh}
                                onChange={(e) =>
                                  setDraft((d) => {
                                    if (!d) return d;
                                    const next = [...(d.benefits ?? [])];
                                    next[idx] = { ...next[idx], text_zh: e.target.value };
                                    return { ...d, benefits: next };
                                  })
                                }
                              />
                            </td>
                            <td className="py-2 pr-2">
                              <Input
                                value={b.text_en}
                                onChange={(e) =>
                                  setDraft((d) => {
                                    if (!d) return d;
                                    const next = [...(d.benefits ?? [])];
                                    next[idx] = { ...next[idx], text_en: e.target.value };
                                    return { ...d, benefits: next };
                                  })
                                }
                              />
                            </td>
                            <td className="py-2 pr-2">
                              <input
                                type="checkbox"
                                checked={Boolean(b.available)}
                                onChange={(e) =>
                                  setDraft((d) => {
                                    if (!d) return d;
                                    const next = [...(d.benefits ?? [])];
                                    next[idx] = { ...next[idx], available: e.target.checked };
                                    return { ...d, benefits: next };
                                  })
                                }
                              />
                            </td>
                            <td className="py-2 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setDraft((d) => {
                                    if (!d) return d;
                                    const next = [...(d.benefits ?? [])];
                                    next.splice(idx, 1);
                                    return { ...d, benefits: next };
                                  })
                                }
                              >
                                移除
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {(draft?.benefits ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-4 text-muted-foreground">
                              暂无权益
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">优惠活动（campaign）</div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(draft?.campaign?.active)}
                        onChange={(e) =>
                          setDraft((d) => (d ? { ...d, campaign: { ...d.campaign, active: e.target.checked } } : d))
                        }
                      />
                      启用活动
                    </label>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">折扣（percent_off）</div>
                      <Input
                        type="number"
                        value={draft?.campaign?.percent_off ?? ''}
                        onChange={(e) =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  campaign: { ...d.campaign, percent_off: Number.parseInt(e.target.value || '', 10) },
                                }
                              : d
                          )
                        }
                        placeholder="e.g. 20"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">活动支付产品 ID / 外部支付链接（可选）</div>
                      <Input
                        value={draft?.campaign?.creem_product_id ?? ''}
                        onChange={(e) =>
                          setDraft((d) =>
                            d ? { ...d, campaign: { ...d.campaign, creem_product_id: e.target.value } } : d
                          )
                        }
                        placeholder="prod_... 或 https://...（支持 {{ORDER_ID}} 等占位符）"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">活动标题（英文）</div>
                      <Input
                        value={draft?.campaign?.title_en ?? ''}
                        onChange={(e) => setDraft((d) => (d ? { ...d, campaign: { ...d.campaign, title_en: e.target.value } } : d))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">活动标题（中文）</div>
                      <Input
                        value={draft?.campaign?.title_zh ?? ''}
                        onChange={(e) => setDraft((d) => (d ? { ...d, campaign: { ...d.campaign, title_zh: e.target.value } } : d))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">开始时间（RFC3339，可空）</div>
                      <Input
                        value={draft?.campaign?.starts_at ?? ''}
                        onChange={(e) => setDraft((d) => (d ? { ...d, campaign: { ...d.campaign, starts_at: e.target.value } } : d))}
                        placeholder="2026-01-09T00:00:00Z"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">结束时间（RFC3339，可空）</div>
                      <Input
                        value={draft?.campaign?.ends_at ?? ''}
                        onChange={(e) => setDraft((d) => (d ? { ...d, campaign: { ...d.campaign, ends_at: e.target.value } } : d))}
                        placeholder="2026-02-09T00:00:00Z"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="outline" onClick={cancelEdit}>
                    取消
                  </Button>
                  <Button disabled={busy.save} onClick={() => void save()}>
                    {busy.save ? '保存中...' : '保存'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>支付汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-2">
                  <div className="w-[140px]">
                    <div className="text-xs text-muted-foreground">统计天数</div>
                    <Input value={paymentsDays} onChange={(e) => setPaymentsDays(e.target.value)} placeholder="30" />
                  </div>
                  <Button variant="outline" onClick={() => void loadPayments()}>
                    刷新汇总
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">
                  总收入：{formatUsd(summary?.gross_usd_cents ?? 0)}
                </div>
              </div>

              {summary ? (
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">创建订单</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{summary.created_orders.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">已支付</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{summary.paid_orders.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">失败</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{summary.failed_orders.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">取消</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{summary.canceled_orders.toLocaleString()}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-xs text-muted-foreground">毛收入</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">{formatUsd(summary.gross_usd_cents)}</div>
                  </div>
                </div>
              ) : (
                <div className="py-6 text-sm text-muted-foreground">暂无数据</div>
              )}

              {summary?.by_day?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">日期</th>
                        <th className="py-2 text-right font-medium">已支付订单</th>
                        <th className="py-2 text-right font-medium">毛收入</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.by_day.map((r) => (
                        <tr key={r.day} className="border-b border-border/60">
                          <td className="py-2">{String(r.day).slice(0, 10)}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{Number(r.paid_orders).toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{formatUsd(Number(r.gross_usd_cents))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>订单列表</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-end gap-2">
                  <div className="w-[180px]">
                    <div className="text-xs text-muted-foreground">状态筛选</div>
                    <Input value={ordersStatus} onChange={(e) => setOrdersStatus(e.target.value)} placeholder="paid" />
                  </div>
                  <Button variant="outline" onClick={() => void loadOrders()}>
                    刷新订单
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground">显示最近 200 条</div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="py-2 text-left font-medium">id</th>
                      <th className="py-2 text-left font-medium">用户</th>
                      <th className="py-2 text-left font-medium">product_id</th>
                      <th className="py-2 text-left font-medium">位置</th>
                      <th className="py-2 text-left font-medium">渠道</th>
                      <th className="py-2 text-right font-medium">金额</th>
                      <th className="py-2 text-left font-medium">状态</th>
                      <th className="py-2 text-left font-medium">时间</th>
                      <th className="py-2 text-left font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-border/60">
                        <td className="py-2 font-mono text-xs">{o.id.slice(0, 10)}</td>
                        <td className="py-2">{o.user_email}</td>
                        <td className="py-2 font-mono text-xs">{o.product_id}</td>
                        <td className="py-2">
                          {o.placement}
                          {typeof o.slot_index === 'number' ? <span className="text-xs text-muted-foreground"> #{o.slot_index}</span> : null}
                        </td>
                        <td className="py-2 text-muted-foreground">{o.provider}</td>
                        <td className="py-2 text-right tabular-nums">{formatUsd(o.amount_usd_cents ?? null)}</td>
                        <td className="py-2">{o.status}</td>
                        <td className="py-2 text-muted-foreground">{String(o.created_at).slice(0, 19).replace('T', ' ')}</td>
                        <td className="py-2">
                          {o.status === 'created' && o.provider !== 'creem' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={Boolean(busy[`markPaid:${o.id}`])}
                              onClick={() => void markOrderPaid(o)}
                            >
                              标记已支付
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-6 text-muted-foreground">
                          暂无订单
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
