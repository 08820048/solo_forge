'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { Button, buttonClassName } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function logout() {
  try {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
  } catch {}
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin() {
      setChecking(true);
      setMessage(null);
      setAdminEmail(null);
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setMessage('请先登录后再访问管理后台。');
          return;
        }

        const meRes = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const meJson = (await meRes.json().catch(() => null)) as ApiResponse<{ email: string }> | null;
        if (!meRes.ok || !meJson?.success || !meJson.data?.email) {
          if (!cancelled) setMessage(meJson?.message || '无权限访问管理后台。');
          return;
        }
        if (!cancelled) setAdminEmail(meJson.data.email);
      } catch {
        if (!cancelled) setMessage('网络错误，请稍后重试。');
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void checkAdmin();
    return () => {
      cancelled = true;
    };
  }, []);

  const nav = useMemo(
    () => [
      { href: '/', label: '概览' },
      { href: '/products', label: '产品管理' },
      { href: '/categories', label: '分类管理' },
      { href: '/pricing', label: '定价与支付' },
      { href: '/sponsorship', label: '广告位管理' },
    ],
    []
  );

  const publicUrl = String(process.env.NEXT_PUBLIC_PUBLIC_APP_URL || '').trim();

  const toLogin = () => {
    try {
      sessionStorage.setItem('sf_admin_post_login_redirect', pathname || '/');
    } catch {}
    window.location.href = '/login';
  };

  if (checking) {
    return (
      <div className="min-h-[100vh] flex items-center justify-center">
        <div className="text-sm text-muted-foreground">校验权限中...</div>
      </div>
    );
  }

  if (message) {
    return (
      <div className="min-h-[100vh] flex items-center justify-center px-6">
        <Card className="w-full max-w-md p-6 space-y-4">
          <div className="text-base font-semibold">无法进入管理后台</div>
          <div className="text-sm text-muted-foreground">{message}</div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={toLogin}>去登录</Button>
            <Button variant="outline" onClick={() => window.location.reload()}>
              重试
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100vh] bg-background">
      <div className="border-b border-border bg-background/70 backdrop-blur">
        <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold leading-tight">SoloForge Admin</div>
            <div className="text-xs text-muted-foreground truncate">{adminEmail ? `管理员：${adminEmail}` : '已登录'}</div>
          </div>
          <div className="flex items-center gap-2">
            {publicUrl ? (
              <a
                className={buttonClassName({ variant: 'outline' })}
                href={publicUrl}
                target="_blank"
                rel="noreferrer"
              >
                返回前台
              </a>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                void logout().finally(() => {
                  window.location.href = '/login';
                });
              }}
            >
              退出登录
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6">
          <aside className="lg:sticky lg:top-6 h-fit">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b border-border text-xs text-muted-foreground">导航</div>
              <div className="p-2 flex flex-col gap-1">
                {nav.map((item) => {
                  const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'rounded-md px-3 py-2 text-sm transition-colors',
                        active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          </aside>
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}
