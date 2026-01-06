'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type SponsorshipRequestStatus = 'pending' | 'processed' | 'rejected';

type SponsorshipRequest = {
  id: number;
  email: string;
  product_ref: string;
  placement: string;
  slot_index: number | null;
  duration_days: number;
  note: string | null;
  status: SponsorshipRequestStatus;
  processed_grant_id: number | null;
  created_at: string;
  updated_at: string;
};

type SponsorshipGrant = {
  id: number;
  product_id: string;
  placement: string;
  slot_index: number | null;
  starts_at: string;
  ends_at: string;
  source: string;
  amount_usd_cents: number | null;
  created_at: string;
};

type Draft = {
  placement: 'home_top' | 'home_right';
  slot_index: string;
  duration_days: string;
  sponsor_role: string;
  sponsor_verified: boolean;
  product_id: string;
  amount_usd_cents: string;
  note: string;
};

/**
 * getAccessToken
 * 从 Supabase Session 中读取 access_token，用于调用 /api/admin/* 受保护接口。
 */
async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * placementLabel
 * 将后端 placement 标识映射为中文展示文案。
 */
function placementLabel(p: string) {
  if (p === 'home_top') return '首页顶部';
  if (p === 'home_right') return '首页右侧';
  return p || '—';
}

/**
 * slotLabel
 * 将 slot_index 转为更易读的槽位显示（顶部：左/右；右侧：1/2/3）。
 */
function slotLabel(placement: string, slot: number | null) {
  if (slot === null || slot === undefined) return '—';
  if (placement === 'home_top') return slot === 0 ? '左' : slot === 1 ? '右' : String(slot);
  if (placement === 'home_right') return String(slot + 1);
  return String(slot);
}

/**
 * formatUsdCents
 * 将美分金额格式化为 $X.XX；空值返回占位符。
 */
function formatUsdCents(v: number | null) {
  if (v === null || v === undefined) return '—';
  const dollars = (v / 100).toFixed(2);
  return `$${dollars}`;
}

/**
 * statusBadge
 * 将赞助请求状态映射为展示用标签。
 */
function statusBadge(status: SponsorshipRequestStatus) {
  if (status === 'processed') return <Badge variant="success">已处理</Badge>;
  if (status === 'rejected') return <Badge variant="destructive">已拒绝</Badge>;
  return <Badge variant="warning">待处理</Badge>;
}

/**
 * AdminSponsorshipPage
 * 管理后台：赞助请求处理与赞助队列查看。
 */
export default function AdminSponsorshipPage() {
  const [tab, setTab] = useState<'pending' | 'all' | 'grants'>('pending');
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [requests, setRequests] = useState<SponsorshipRequest[]>([]);
  const [grants, setGrants] = useState<SponsorshipGrant[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});

  /**
   * buildDefaultDraft
   * 将请求默认参数转为可编辑草稿（用于处理/拒绝操作）。
   */
  const buildDefaultDraft = (r: SponsorshipRequest): Draft => {
    const placement = (r.placement === 'home_right' ? 'home_right' : 'home_top') as 'home_top' | 'home_right';
    const slot = r.slot_index !== null && r.slot_index !== undefined ? String(r.slot_index) : '0';
    return {
      placement,
      slot_index: slot,
      duration_days: String(r.duration_days || 30),
      sponsor_role: 'sponsor',
      sponsor_verified: true,
      product_id: '',
      amount_usd_cents: '',
      note: '',
    };
  };

  /**
   * load
   * 根据当前 tab 拉取赞助请求或赞助队列。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setHint(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }

      if (tab === 'grants') {
        const params = new URLSearchParams();
        params.set('limit', '200');
        params.set('offset', '0');
        const res = await fetch(`/api/admin/sponsorship/grants?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
          cache: 'no-store',
        });
        const json = (await res.json().catch(() => null)) as ApiResponse<SponsorshipGrant[]> | null;
        if (!res.ok || !json?.success) {
          setMessage(json?.message || '加载赞助队列失败。');
          return;
        }
        setGrants(Array.isArray(json.data) ? json.data : []);
        return;
      }

      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('offset', '0');
      if (tab === 'pending') params.set('status', 'pending');
      const res = await fetch(`/api/admin/sponsorship/requests?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<SponsorshipRequest[]> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '加载赞助请求失败。');
        return;
      }
      setRequests(Array.isArray(json.data) ? json.data : []);
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'grants') return;
    setDrafts((m) => {
      let next: typeof m | null = null;
      for (const r of requests) {
        if (r.status !== 'pending') continue;
        if (m[r.id]) continue;
        if (!next) next = { ...m };
        next[r.id] = buildDefaultDraft(r);
      }
      return next ?? m;
    });
  }, [requests, tab]);

  const filteredRequests = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) => {
      const hay = `${r.id} ${r.email} ${r.product_ref} ${r.placement} ${r.status}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, requests]);

  const filteredGrants = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return grants;
    return grants.filter((g) => {
      const hay = `${g.id} ${g.product_id} ${g.placement} ${g.slot_index ?? ''} ${g.source}`.toLowerCase();
      return hay.includes(q);
    });
  }, [grants, query]);

  /**
   * reload
   * 保持当前 tab 不变，手动刷新当前列表数据。
   */
  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await load();
    } finally {
      setReloading(false);
    }
  };

  /**
   * processRequest
   * 将 sponsorship_request 处理为 sponsorship_grant（调用后端 action=process）。
   */
  const processRequest = async (r: SponsorshipRequest) => {
    const token = await getAccessToken();
    if (!token) {
      setMessage('未检测到登录会话，请先登录。');
      return;
    }
    const draft = drafts[r.id];
    if (!draft) return;
    const placement = draft.placement;
    const slotIndex = Number.parseInt(draft.slot_index, 10);
    const durationDays = Number.parseInt(draft.duration_days, 10);
    const productId = String(draft.product_id || '').trim();
    const amountUsdCentsRaw = String(draft.amount_usd_cents || '').trim();
    const amountUsdCents = amountUsdCentsRaw ? Number.parseInt(amountUsdCentsRaw, 10) : null;

    if (!productId) {
      setMessage('请填写 product_id。');
      return;
    }
    if (!Number.isFinite(slotIndex) || slotIndex < 0) {
      setMessage('slot_index 不合法。');
      return;
    }
    if (!Number.isFinite(durationDays) || durationDays <= 0) {
      setMessage('duration_days 不合法。');
      return;
    }
    if (amountUsdCentsRaw && (!Number.isFinite(amountUsdCents) || (amountUsdCents ?? 0) < 0)) {
      setMessage('amount_usd_cents 不合法。');
      return;
    }

    const key = `req:${r.id}:process`;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const res = await fetch('/api/admin/sponsorship/requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'process',
          request_id: r.id,
          sponsor_role: draft.sponsor_role,
          sponsor_verified: draft.sponsor_verified,
          placement,
          slot_index: slotIndex,
          duration_days: durationDays,
          product_id: productId,
          amount_usd_cents: amountUsdCents,
          note: String(draft.note || '').trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '处理失败。');
        return;
      }
      setHint(`已处理请求 #${r.id}`);
      await load();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  };

  /**
   * rejectRequest
   * 拒绝赞助请求（调用后端 action=reject）。
   */
  const rejectRequest = async (r: SponsorshipRequest) => {
    const ok = window.confirm(`确认拒绝请求 #${r.id} ?`);
    if (!ok) return;

    const token = await getAccessToken();
    if (!token) {
      setMessage('未检测到登录会话，请先登录。');
      return;
    }
    const draft = drafts[r.id];
    const key = `req:${r.id}:reject`;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const res = await fetch('/api/admin/sponsorship/requests', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          request_id: r.id,
          note: String(draft?.note || '').trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '拒绝失败。');
        return;
      }
      setHint(`已拒绝请求 #${r.id}`);
      await load();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  };

  /**
   * deleteGrant
   * 删除已生成的 sponsorship_grant 记录。
   */
  const deleteGrant = async (id: number) => {
    const ok = window.confirm(`确认删除赞助记录 #${id} ?`);
    if (!ok) return;

    const token = await getAccessToken();
    if (!token) {
      setMessage('未检测到登录会话，请先登录。');
      return;
    }
    const key = `grant:${id}:delete`;
    setBusy((m) => ({ ...m, [key]: true }));
    setMessage(null);
    setHint(null);
    try {
      const res = await fetch(`/api/admin/sponsorship/grants?id=${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '删除失败。');
        return;
      }
      setHint(`已删除赞助记录 #${id}`);
      await load();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [key]: false }));
    }
  };

  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">赞助管理</div>
          <div className="mt-1 text-sm text-muted-foreground">处理赞助请求、查看赞助队列。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading || reloading} onClick={() => void reload()}>
            {reloading ? '刷新中...' : '刷新'}
          </Button>
          <Link className={buttonClassName({ variant: 'outline' })} href="/">
            返回概览
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">视图</CardTitle>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant={tab === 'pending' ? 'default' : 'outline'} onClick={() => setTab('pending')} disabled={loading}>
                待处理（{pendingCount}）
              </Button>
              <Button variant={tab === 'all' ? 'default' : 'outline'} onClick={() => setTab('all')} disabled={loading}>
                全部请求
              </Button>
              <Button variant={tab === 'grants' ? 'default' : 'outline'} onClick={() => setTab('grants')} disabled={loading}>
                赞助队列
              </Button>
            </div>
            <div className="w-full md:max-w-sm">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索：id / 邮箱 / 产品 / 位置 / 状态" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <div className="py-10 text-sm text-muted-foreground">加载中...</div> : null}
          {!loading && message ? <div className="py-2 text-sm text-destructive">{message}</div> : null}
          {!loading && hint ? <div className="py-2 text-sm text-emerald-600 dark:text-emerald-400">{hint}</div> : null}

          {!loading && tab !== 'grants' ? (
            <div className="space-y-4">
              {filteredRequests.map((r) => {
                const draft = drafts[r.id];
                const canAct = r.status === 'pending' && !!draft;
                const processing = !!busy[`req:${r.id}:process`];
                const rejecting = !!busy[`req:${r.id}:reject`];

                return (
                  <div key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="p-4 flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">请求 #{r.id}</div>
                          {statusBadge(r.status)}
                          <Badge variant="secondary">{placementLabel(r.placement)}</Badge>
                          <Badge variant="secondary">槽位 {slotLabel(r.placement, r.slot_index)}</Badge>
                          <Badge variant="secondary">{r.duration_days} 天</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground break-all">{r.email}</div>
                        <div className="text-xs text-muted-foreground break-all">product_ref: {r.product_ref || '—'}</div>
                        {r.note ? <div className="text-xs text-muted-foreground break-words">备注：{r.note}</div> : null}
                      </div>
                      <div className="flex flex-wrap gap-2 md:justify-end">
                        {canAct ? (
                          <>
                            <Button size="sm" disabled={processing || rejecting} onClick={() => void processRequest(r)}>
                              {processing ? '处理中...' : '处理并生成赞助'}
                            </Button>
                            <Button size="sm" variant="outline" disabled={processing || rejecting} onClick={() => void rejectRequest(r)}>
                              {rejecting ? '拒绝中...' : '拒绝'}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>

                    {canAct ? (
                      <div className="border-t border-border p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">product_id（UUID）</div>
                          <Input
                            value={draft.product_id}
                            onChange={(e) =>
                              setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], product_id: e.target.value } }))
                            }
                            placeholder="用于生成 sponsorship_grant"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">amount_usd_cents（可选）</div>
                          <Input
                            value={draft.amount_usd_cents}
                            onChange={(e) =>
                              setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], amount_usd_cents: e.target.value } }))
                            }
                            placeholder="例如：9900 表示 $99.00"
                          />
                        </div>
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">placement</div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant={draft.placement === 'home_top' ? 'default' : 'outline'}
                              onClick={() => setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], placement: 'home_top' } }))}
                            >
                              home_top
                            </Button>
                            <Button
                              size="sm"
                              variant={draft.placement === 'home_right' ? 'default' : 'outline'}
                              onClick={() =>
                                setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], placement: 'home_right' } }))
                              }
                            >
                              home_right
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">slot_index</div>
                            <Input
                              value={draft.slot_index}
                              onChange={(e) =>
                                setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], slot_index: e.target.value } }))
                              }
                              placeholder="home_top: 0/1; home_right: 0/1/2"
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">duration_days</div>
                            <Input
                              value={draft.duration_days}
                              onChange={(e) =>
                                setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], duration_days: e.target.value } }))
                              }
                              placeholder="例如：30"
                            />
                          </div>
                        </div>
                        <div className="space-y-2 lg:col-span-2">
                          <div className="text-xs text-muted-foreground">note（可选，拒绝原因/处理备注）</div>
                          <textarea
                            className="min-h-[90px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                            value={draft.note}
                            onChange={(e) => setDrafts((m) => ({ ...m, [r.id]: { ...m[r.id], note: e.target.value } }))}
                            placeholder="会写入 sponsorship_requests.note / reject note"
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}

              {filteredRequests.length === 0 ? <div className="py-10 text-sm text-muted-foreground">暂无数据</div> : null}
            </div>
          ) : null}

          {!loading && tab === 'grants' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-medium">id</th>
                    <th className="py-2 text-left font-medium">product_id</th>
                    <th className="py-2 text-left font-medium">位置</th>
                    <th className="py-2 text-left font-medium">槽位</th>
                    <th className="py-2 text-left font-medium">时间</th>
                    <th className="py-2 text-left font-medium">金额</th>
                    <th className="py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredGrants.map((g) => {
                    const deleting = !!busy[`grant:${g.id}:delete`];
                    return (
                      <tr key={g.id} className="border-b border-border/60 align-top">
                        <td className="py-3 pr-6 font-medium">{g.id}</td>
                        <td className="py-3 pr-6 break-all">{g.product_id}</td>
                        <td className="py-3 pr-6">{placementLabel(g.placement)}</td>
                        <td className="py-3 pr-6">{slotLabel(g.placement, g.slot_index)}</td>
                        <td className="py-3 pr-6">
                          <div className="text-xs text-muted-foreground break-all">start: {g.starts_at}</div>
                          <div className="text-xs text-muted-foreground break-all">end: {g.ends_at}</div>
                        </td>
                        <td className="py-3 pr-6">{formatUsdCents(g.amount_usd_cents)}</td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <a
                              className={buttonClassName({ variant: 'outline', size: 'sm' })}
                              href={`/en/products/${encodeURIComponent(g.product_id)}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              查看产品
                            </a>
                            <Button size="sm" variant="outline" disabled={deleting} onClick={() => void deleteGrant(g.id)}>
                              {deleting ? '删除中...' : '删除'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredGrants.length === 0 ? (
                    <tr>
                      <td className="py-10 text-sm text-muted-foreground" colSpan={7}>
                        暂无数据
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        说明：赞助位生成逻辑由后端根据 placement + slot_index 自动排队（starts_at 可能被顺延）。
      </div>
    </div>
  );
}
