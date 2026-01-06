'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonClassName } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type Category = {
  id: string;
  name_en: string;
  name_zh: string;
  icon: string;
  color: string;
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
 * normalizeId
 * 将分类 id 规范化为小写短横线风格，便于一致性管理。
 */
function normalizeId(value: string) {
  const raw = String(value || '').trim().toLowerCase();
  return raw
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * AdminCategoriesPage
 * 管理后台：分类字典管理（增删改查）。
 */
export default function AdminCategoriesPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [list, setList] = useState<Category[]>([]);
  const [draft, setDraft] = useState<Category | null>(null);
  const [query, setQuery] = useState('');

  /**
   * load
   * 拉取分类列表。
   */
  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }

      const res = await fetch('/api/admin/categories', {
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<Category[]> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '加载分类失败。');
        return;
      }
      setList(Array.isArray(json.data) ? json.data : []);
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const hay = `${c.id} ${c.name_zh} ${c.name_en} ${c.icon} ${c.color}`.toLowerCase();
      return hay.includes(q);
    });
  }, [list, query]);

  /**
   * startCreate
   * 初始化新增分类草稿。
   */
  const startCreate = () => {
    setMessage(null);
    setDraft({ id: '', name_en: '', name_zh: '', icon: 'ri-price-tag-3-line', color: '#64748b' });
  };

  /**
   * startEdit
   * 将选中的分类加载到草稿区用于编辑。
   */
  const startEdit = (c: Category) => {
    setMessage(null);
    setDraft({ ...c });
  };

  /**
   * saveDraft
   * 将草稿内容 upsert 到后端分类表。
   */
  const saveDraft = async () => {
    if (!draft) return;
    const next: Category = {
      id: normalizeId(draft.id),
      name_en: String(draft.name_en || '').trim(),
      name_zh: String(draft.name_zh || '').trim(),
      icon: String(draft.icon || '').trim(),
      color: String(draft.color || '').trim(),
    };

    if (!next.id || !next.name_zh || !next.name_en) {
      setMessage('请填写 id、中文名、英文名。');
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }

      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh', 'Content-Type': 'application/json' },
        body: JSON.stringify({ categories: [next] }),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '保存失败。');
        return;
      }

      setDraft(null);
      await load();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  /**
   * deleteCategory
   * 删除指定分类。
   */
  const deleteCategory = async (id: string) => {
    const categoryId = String(id || '').trim();
    if (!categoryId) return;

    const ok = window.confirm(`确认删除分类：${categoryId} ?`);
    if (!ok) return;

    setSaving(true);
    setMessage(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setMessage('未检测到登录会话，请先登录。');
        return;
      }

      const res = await fetch(`/api/admin/categories/${encodeURIComponent(categoryId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'zh' },
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<unknown> | null;
      if (!res.ok || !json?.success) {
        setMessage(json?.message || '删除失败。');
        return;
      }
      if (draft?.id === categoryId) setDraft(null);
      await load();
    } catch {
      setMessage('网络错误，请稍后重试。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-3xl font-semibold tracking-tight">分类管理</div>
          <div className="mt-1 text-sm text-muted-foreground">管理分类字典（中英文名、图标、颜色）。</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving} onClick={() => startCreate()}>
            新增分类
          </Button>
          <Button variant="outline" disabled={saving || loading} onClick={() => void load()}>
            刷新
          </Button>
          <Link className={buttonClassName({ variant: 'outline' })} href="/">
            返回概览
          </Link>
        </div>
      </div>

      {draft ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{draft.id ? `编辑：${draft.id}` : '新增分类'}</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" disabled={saving} onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button disabled={saving} onClick={() => void saveDraft()}>
                {saving ? '保存中...' : '保存'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {message ? <div className="text-sm text-destructive">{message}</div> : null}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">id</div>
                <Input value={draft.id} onChange={(e) => setDraft((d) => (d ? { ...d, id: e.target.value } : d))} />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">icon</div>
                <Input value={draft.icon} onChange={(e) => setDraft((d) => (d ? { ...d, icon: e.target.value } : d))} />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">中文名</div>
                <Input value={draft.name_zh} onChange={(e) => setDraft((d) => (d ? { ...d, name_zh: e.target.value } : d))} />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">英文名</div>
                <Input value={draft.name_en} onChange={(e) => setDraft((d) => (d ? { ...d, name_en: e.target.value } : d))} />
              </div>
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">颜色</div>
                <Input value={draft.color} onChange={(e) => setDraft((d) => (d ? { ...d, color: e.target.value } : d))} />
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">分类列表</CardTitle>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-muted-foreground">共 {filtered.length.toLocaleString()} 条</div>
            <div className="w-full md:max-w-sm">
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索：id / 名称 / icon / color" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? <div className="py-10 text-sm text-muted-foreground">加载中...</div> : null}
          {!loading && message ? <div className="py-2 text-sm text-destructive">{message}</div> : null}
          {!loading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="py-2 text-left font-medium">id</th>
                    <th className="py-2 text-left font-medium">中文名</th>
                    <th className="py-2 text-left font-medium">英文名</th>
                    <th className="py-2 text-left font-medium">icon</th>
                    <th className="py-2 text-left font-medium">color</th>
                    <th className="py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-b border-border/60">
                      <td className="py-3 pr-6 font-medium">{c.id}</td>
                      <td className="py-3 pr-6">{c.name_zh}</td>
                      <td className="py-3 pr-6">{c.name_en}</td>
                      <td className="py-3 pr-6">{c.icon}</td>
                      <td className="py-3 pr-6">{c.color}</td>
                      <td className="py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => startEdit(c)}>
                            编辑
                          </Button>
                          <Button size="sm" variant="outline" disabled={saving} onClick={() => void deleteCategory(c.id)}>
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 ? (
                    <tr>
                      <td className="py-10 text-sm text-muted-foreground" colSpan={6}>
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
