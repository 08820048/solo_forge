'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Link from 'next/link';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export default function AdminAuthCallbackPage() {
  const [message, setMessage] = useState<string>('正在完成登录...');

  useEffect(() => {
    let cancelled = false;

    async function finish() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        if (!token) {
          if (!cancelled) setMessage('未检测到登录会话，请返回重新登录。');
          return;
        }

        const meRes = await fetch('/api/admin/me', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const meJson = (await meRes.json().catch(() => null)) as ApiResponse<{ email: string }> | null;
        if (!meRes.ok || !meJson?.success || !meJson.data?.email) {
          await supabase.auth.signOut();
          if (!cancelled) setMessage(meJson?.message || '无权限访问管理后台。');
          return;
        }

        const redirectPath = (() => {
          try {
            return String(sessionStorage.getItem('sf_admin_post_login_redirect') || '').trim() || '/';
          } catch {
            return '/';
          }
        })();
        try {
          sessionStorage.removeItem('sf_admin_post_login_redirect');
        } catch {}
        if (!cancelled) window.location.replace(redirectPath);
      } catch {
        if (!cancelled) setMessage('网络错误，请稍后重试。');
      }
    }

    void finish();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>登录处理中</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="text-sm">
          <Link className="underline underline-offset-4 hover:text-foreground" href="/login">
            返回登录
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

