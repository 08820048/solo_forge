'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonClassName } from '@/components/ui/button';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type AdminStats = {
  totals: {
    products: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  byLanguage: Array<{ language: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  topProductsByLikes: Array<{ id: string; name: string; likes: number }>;
  topProductsByFavorites: Array<{ id: string; name: string; favorites: number }>;
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

export default function AdminHomePage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      setLoading(true);
      setMessage(null);
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setMessage('未检测到登录会话，请先登录。');
          return;
        }

        const statsRes = await fetch('/api/admin/stats', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const statsJson = (await statsRes.json().catch(() => null)) as ApiResponse<AdminStats> | null;
        if (!statsRes.ok || !statsJson?.success) {
          if (!cancelled) setMessage(statsJson?.message || '加载统计失败。');
          return;
        }
        if (!cancelled) setStats(statsJson.data ?? null);
      } catch {
        if (!cancelled) setMessage('网络错误，请稍后重试。');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = async () => {
    if (reloading) return;
    setReloading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }
      const statsRes = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const statsJson = (await statsRes.json().catch(() => null)) as ApiResponse<AdminStats> | null;
      if (!statsRes.ok || !statsJson?.success) {
        setMessage(statsJson?.message || '加载统计失败。');
        return;
      }
      setStats(statsJson.data ?? null);
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setReloading(false);
    }
  };

  const overviewCards = useMemo(() => {
    const t = stats?.totals;
    return [
      { label: '产品总数', value: t ? t.products.toLocaleString() : '—' },
      { label: '待审核', value: t ? t.pending.toLocaleString() : '—' },
      { label: '已通过', value: t ? t.approved.toLocaleString() : '—' },
      { label: '已拒绝', value: t ? t.rejected.toLocaleString() : '—' },
    ];
  }, [stats]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">概览</div>
          <div className="mt-1 text-sm text-muted-foreground">全站数据概览与快捷入口。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={loading || reloading} onClick={() => void reload()}>
            {reloading ? '刷新中...' : '刷新数据'}
          </Button>
          <Link className={buttonClassName({ variant: 'outline' })} href="/products">
            产品管理
          </Link>
          <Link className={buttonClassName({ variant: 'outline' })} href="/sponsorship">
            赞助管理
          </Link>
          <Link className={buttonClassName({ variant: 'outline' })} href="/categories">
            分类管理
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-sm text-muted-foreground">加载中...</div>
      ) : (
        <>
          {message ? (
            <Card>
              <CardContent className="text-sm text-destructive">{message}</CardContent>
            </Card>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {overviewCards.map((c) => (
              <Card key={c.label}>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
                  <CardDescription className="sr-only">{c.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>按语言</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">语言</th>
                        <th className="py-2 text-right font-medium">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats?.byLanguage ?? []).map((row) => (
                        <tr key={row.language} className="border-b border-border/60">
                          <td className="py-2">{row.language}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{row.count.toLocaleString()}</td>
                        </tr>
                      ))}
                      {(stats?.byLanguage ?? []).length === 0 ? (
                        <tr>
                          <td className="py-3 text-muted-foreground" colSpan={2}>
                            暂无数据
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>按分类（Top 10）</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted-foreground">
                      <tr className="border-b border-border">
                        <th className="py-2 text-left font-medium">分类</th>
                        <th className="py-2 text-right font-medium">数量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(stats?.byCategory ?? []).slice(0, 10).map((row) => (
                        <tr key={row.category} className="border-b border-border/60">
                          <td className="py-2">{row.category}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{row.count.toLocaleString()}</td>
                        </tr>
                      ))}
                      {(stats?.byCategory ?? []).length === 0 ? (
                        <tr>
                          <td className="py-3 text-muted-foreground" colSpan={2}>
                            暂无数据
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
