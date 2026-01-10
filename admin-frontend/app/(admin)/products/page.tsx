'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type ProductStatus = 'pending' | 'approved' | 'rejected';
type BusyAction = 'approve' | 'reject' | 'delete';

type Product = {
  id: string;
  name: string;
  slogan: string;
  website: string;
  category: string;
  language: string;
  maker_name: string;
  maker_email: string;
  status: ProductStatus;
  created_at: string;
  likes?: number;
  favorites?: number;
  rejection_reason?: string | null;
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
 * statusBadge
 * 将产品审核状态映射为展示用标签。
 */
function statusBadge(status: ProductStatus) {
  if (status === 'approved') return <Badge variant="success">已通过</Badge>;
  if (status === 'rejected') return <Badge variant="destructive">已拒绝</Badge>;
  return <Badge variant="warning">待审核</Badge>;
}

/**
 * AdminProductsPage
 * 管理后台：产品审核与删除。
 */
export default function AdminProductsPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<'all' | ProductStatus>('pending');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [busy, setBusy] = useState<Record<string, BusyAction | undefined>>({});
  const [reloading, setReloading] = useState(false);
  const [draftReasons, setDraftReasons] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  /**
   * load
   * 根据筛选条件拉取产品列表。
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

      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('offset', '0');
      if (status !== 'all') params.set('status', status);
      if (debouncedQuery) params.set('search', debouncedQuery);

      const res = await fetch(`/api/admin/products?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<Product[]> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '加载产品失败。');
        return;
      }
      setProducts(Array.isArray(json.data) ? json.data : []);
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const byStatus = { pending: 0, approved: 0, rejected: 0 };
    for (const p of products) byStatus[p.status] += 1;
    return { total: products.length, byStatus };
  }, [products]);

  /**
   * updateStatus
   * 更新产品审核状态（approved / rejected / pending）。
   */
  const updateStatus = async (id: string, nextStatus: ProductStatus): Promise<boolean> => {
    const token = await getAccessToken();
    if (!token) {
      setMessage('未检测到登录会话，请先登录。');
      return false;
    }
    setMessage(null);
    setHint(null);

    const action: BusyAction = nextStatus === 'approved' ? 'approve' : 'reject';
    if (busy[id]) return false;

    let rejection_reason: string | undefined;
    if (nextStatus === 'rejected') {
      const raw = draftReasons[id] ?? '';
      const reason = raw.trim();
      if (!reason) {
        setMessage('拒绝原因不能为空，请先填写下方输入框。');
        return false;
      }
      rejection_reason = reason;
    }

    setBusy((m) => ({ ...m, [id]: action }));
    setHint(action === 'approve' ? '正在通过该产品...' : '正在拒绝该产品...');
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify(nextStatus === 'rejected' ? { id, status: nextStatus, rejection_reason } : { id, status: nextStatus }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '更新失败。');
        return false;
      }
      setProducts((list) =>
        list.map((p) =>
          p.id === id
            ? {
                ...p,
                status: nextStatus,
                rejection_reason: nextStatus === 'rejected' ? (rejection_reason ?? '') : null,
              }
            : p,
        ),
      );
      setRejectingId((cur) => (cur === id ? null : cur));
      return true;
    } catch {
      setMessage('网络错误，请稍后重试。');
      return false;
    } finally {
      setBusy((m) => ({ ...m, [id]: undefined }));
      setHint(null);
    }
  };

  /**
   * startReject
   * 展开指定产品的拒绝原因输入区。
   */
  const startReject = (id: string) => {
    if (busy[id]) return;
    setMessage(null);
    setHint(null);
    setRejectingId(id);
    setDraftReasons((m) => {
      if (Object.prototype.hasOwnProperty.call(m, id)) return m;
      return { ...m, [id]: '' };
    });
  };

  /**
   * cancelReject
   * 关闭拒绝原因输入区，不提交变更。
   */
  const cancelReject = () => {
    setRejectingId(null);
  };

  /**
   * confirmReject
   * 提交拒绝，并要求拒绝原因必填。
   */
  const confirmReject = async (id: string) => {
    const ok = await updateStatus(id, 'rejected');
    if (ok) setRejectingId(null);
  };

  /**
   * deleteProduct
   * 删除指定产品。
   */
  const deleteProduct = async (id: string) => {
    const ok = window.confirm(`确认删除产品：${id} ?`);
    if (!ok) return;

    const token = await getAccessToken();
    if (!token) {
      setMessage('未检测到登录会话，请先登录。');
      return;
    }
    setMessage(null);
    setHint(null);
    if (busy[id]) return;
    setBusy((m) => ({ ...m, [id]: 'delete' }));
    setHint('正在删除该产品...');
    try {
      const res = await fetch(`/api/admin/products?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '删除失败。');
        return;
      }
      setProducts((list) => list.filter((p) => p.id !== id));
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setBusy((m) => ({ ...m, [id]: undefined }));
      setHint(null);
    }
  };

  /**
   * reload
   * 保持当前筛选条件不变，手动刷新列表。
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">产品管理</div>
          <div className="mt-1 text-sm text-muted-foreground">
            当前 {summary.total.toLocaleString()} 条（待审核 {summary.byStatus.pending} / 已通过 {summary.byStatus.approved} / 已拒绝{' '}
            {summary.byStatus.rejected}）
          </div>
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
          <CardTitle className="text-base">筛选</CardTitle>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
                <Button
                  key={s}
                  variant={status === s ? 'default' : 'outline'}
                  onClick={() => setStatus(s)}
                  disabled={loading}
                >
                  {s === 'all' ? '全部' : s === 'pending' ? '待审核' : s === 'approved' ? '已通过' : '已拒绝'}
                </Button>
              ))}
            </div>
            <div className="w-full md:max-w-sm">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索：名称 / id / 邮箱 / 分类 / 语言" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <div className="py-10 text-sm text-muted-foreground">加载中...</div> : null}
          {!loading && message ? <div className="py-2 text-sm text-destructive">{message}</div> : null}
          {!loading && hint ? <div className="py-2 text-sm text-muted-foreground">{hint}</div> : null}

          {!loading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-medium">产品</th>
                    <th className="py-2 text-left font-medium">分类</th>
                    <th className="py-2 text-left font-medium">语言</th>
                    <th className="py-2 text-left font-medium">状态</th>
                    <th className="py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const current = busy[p.id];
                    const disabled = !!current;
                    const showingReject = rejectingId === p.id && p.status !== 'rejected';
                    const reason = (draftReasons[p.id] ?? '').trim();
                    return (
                      <tr key={p.id} className="border-b border-border/60 align-top">
                        <td className="py-3 pr-6">
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-muted-foreground break-all">{p.id}</div>
                          <div className="text-xs text-muted-foreground break-all">{p.maker_email}</div>
                        </td>
                        <td className="py-3 pr-6">{p.category || '—'}</td>
                        <td className="py-3 pr-6">{p.language || '—'}</td>
                        <td className="py-3 pr-6">{statusBadge(p.status)}</td>
                        <td className="py-3 text-right">
                          <div className="flex flex-col items-end gap-2">
                            <div className="flex flex-wrap justify-end gap-2">
                              {p.status !== 'approved' ? (
                                <Button
                                  size="sm"
                                  disabled={disabled}
                                  onClick={() => {
                                    cancelReject();
                                    void updateStatus(p.id, 'approved');
                                  }}
                                >
                                  {current === 'approve' ? '通过中...' : '通过'}
                                </Button>
                              ) : null}
                              {p.status !== 'rejected' ? (
                                <Button size="sm" variant="outline" disabled={disabled} onClick={() => startReject(p.id)}>
                                  {current === 'reject' ? '拒绝中...' : '拒绝'}
                                </Button>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={disabled}
                                onClick={() => {
                                  cancelReject();
                                  void deleteProduct(p.id);
                                }}
                              >
                                {current === 'delete' ? '删除中...' : '删除'}
                              </Button>
                            </div>

                            {showingReject ? (
                              <div className="w-full max-w-[360px] rounded-lg border border-border bg-background p-3 space-y-2">
                                <div className="text-xs text-muted-foreground text-left">拒绝原因（必填，开发者中心可见）</div>
                                <Input
                                  value={draftReasons[p.id] ?? ''}
                                  onChange={(e) => setDraftReasons((m) => ({ ...m, [p.id]: e.target.value }))}
                                  placeholder="例如：描述不完整 / 网站无法访问 / 分类不匹配"
                                  disabled={disabled}
                                />
                                <div className="flex items-center justify-end gap-2">
                                  <Button size="sm" variant="outline" disabled={disabled} onClick={cancelReject}>
                                    取消
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={disabled || !reason}
                                    onClick={() => {
                                      void confirmReject(p.id);
                                    }}
                                  >
                                    {current === 'reject' ? '拒绝中...' : '确认拒绝'}
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {products.length === 0 ? (
                    <tr>
                      <td className="py-10 text-sm text-muted-foreground" colSpan={5}>
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
    </div>
  );
}
