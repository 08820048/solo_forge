'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalized = useMemo(() => email.trim().toLowerCase(), [email]);

  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [normalized]);

  const sendMagicLink = async () => {
    if (loading) return;
    const nextEmail = normalized;
    if (!nextEmail) {
      setError('请输入邮箱。');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const allowRes = await fetch('/api/admin/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: nextEmail }),
        cache: 'no-store',
      });
      const allowJson = (await allowRes.json().catch(() => null)) as ApiResponse<{ allowed: boolean }> | null;
      if (!allowRes.ok || !allowJson?.success || !allowJson.data) {
        setError(allowJson?.message || '无法校验邮箱权限。');
        return;
      }
      if (!allowJson.data.allowed) {
        setError('该邮箱未被授权访问管理后台。');
        return;
      }

      const supabase = getSupabaseBrowserClient();
      const redirectTo = `${window.location.origin}/auth/callback`;
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email: nextEmail,
        options: { emailRedirectTo: redirectTo },
      });
      if (otpError) {
        setError(otpError.message || '发送登录邮件失败。');
        return;
      }
      setNotice('已发送登录链接，请前往邮箱点击链接完成登录。');
    } catch {
      setError('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>管理后台登录</CardTitle>
        <CardDescription>使用邮箱登录（仅白名单邮箱可用）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">邮箱</div>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            autoComplete="email"
          />
        </div>

        {error ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">{notice}</div> : null}

        <Button className="w-full" onClick={() => void sendMagicLink()} disabled={loading}>
          {loading ? '发送中...' : '发送登录链接'}
        </Button>

        <div className="text-xs text-muted-foreground">
          <Link className="underline underline-offset-4 hover:text-foreground" href="/">
            返回首页
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

