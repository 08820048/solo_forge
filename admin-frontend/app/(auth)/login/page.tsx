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
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const normalized = useMemo(() => email.trim().toLowerCase(), [email]);

  useEffect(() => {
    setError(null);
    setNotice(null);
  }, [normalized]);

  useEffect(() => {
    try {
      const saved = String(localStorage.getItem('sf_admin_login_email') || '').trim();
      if (saved) setEmail(saved);
    } catch {}
  }, []);

  /**
   * checkAllowlist
   * 调用 /api/admin/allowlist 校验是否允许登录管理后台。
   */
  const checkAllowlist = async (nextEmail: string): Promise<boolean> => {
    const allowRes = await fetch('/api/admin/allowlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: nextEmail }),
      cache: 'no-store',
    });
    const allowJson = (await allowRes.json().catch(() => null)) as ApiResponse<{ allowed: boolean }> | null;
    if (!allowRes.ok || !allowJson?.success || !allowJson.data) {
      setError(allowJson?.message || '无法校验邮箱权限。');
      return false;
    }
    if (!allowJson.data.allowed) {
      setError('该邮箱未被授权访问管理后台。');
      return false;
    }
    return true;
  };

  /**
   * getPostLoginRedirectPath
   * 读取登录后跳转地址（由管理端 layout 写入 sessionStorage）。
   */
  const getPostLoginRedirectPath = (): string => {
    try {
      return String(sessionStorage.getItem('sf_admin_post_login_redirect') || '').trim() || '/';
    } catch {
      return '/';
    }
  };

  /**
   * completeLoginRedirect
   * 登录成功后清理跳转标记并跳转到目标页。
   */
  const completeLoginRedirect = () => {
    const redirectPath = getPostLoginRedirectPath();
    try {
      sessionStorage.removeItem('sf_admin_post_login_redirect');
    } catch {}
    window.location.replace(redirectPath);
  };

  /**
   * loginWithPassword
   * 使用 Supabase 邮箱 + 密码登录，避免每次走魔法链接。
   */
  const loginWithPassword = async () => {
    if (loading) return;
    const nextEmail = normalized;
    const nextPassword = password;
    if (!nextEmail) {
      setError('请输入邮箱。');
      return;
    }
    if (!nextPassword) {
      setError('请输入密码。');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const allowed = await checkAllowlist(nextEmail);
      if (!allowed) return;

      const supabase = getSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: nextEmail,
        password: nextPassword,
      });
      if (signInError) {
        setError(signInError.message || '登录失败。');
        return;
      }
      try {
        localStorage.setItem('sf_admin_login_email', nextEmail);
      } catch {}
      completeLoginRedirect();
    } catch {
      setError('网络错误，请稍后重试。');
    } finally {
      setLoading(false);
    }
  };

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
      const allowed = await checkAllowlist(nextEmail);
      if (!allowed) return;

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
        <CardDescription>使用邮箱 + 密码登录（仅白名单邮箱可用）。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void loginWithPassword();
          }}
        >
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

          <div className="space-y-2">
            <div className="text-sm font-medium">密码</div>
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="请输入密码"
              type="password"
              autoComplete="current-password"
            />
          </div>

          {error ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
          ) : null}
          {notice ? (
            <div className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">{notice}</div>
          ) : null}

          <Button className="w-full" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </Button>
        </form>

        <Button className="w-full" variant="outline" onClick={() => void sendMagicLink()} disabled={loading}>
          {loading ? '发送中...' : '发送登录链接（备用）'}
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
