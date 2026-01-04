'use client';

import { Link, useRouter } from '@/i18n/routing';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import Image from 'next/image';
import { Globe, Sun, Moon, User } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  getSupabaseAuthStoragePreference,
  getSupabaseBrowserClient,
  setSupabaseAuthStoragePreference,
} from '@/lib/supabase';
import type { Provider } from '@supabase/supabase-js';

/**
 * readUserFromStorage
 * 从 localStorage 读取登录态用户信息（可选），用于 Header 头像展示。
 */
function readUserFromStorage() {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { name?: string; email?: string; avatarUrl?: string };
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeUserToStorage(user: { name?: string; email?: string; avatarUrl?: string } | null) {
  try {
    if (!user) {
      localStorage.removeItem('sf_user');
    } else {
      localStorage.setItem('sf_user', JSON.stringify(user));
    }
    window.dispatchEvent(new Event('sf_user_updated'));
  } catch {}
}

/**
 * readAuthEmailFromStorage
 * 从 localStorage 读取“记住我”保存的邮箱，用于预填充登录表单。
 */
function readAuthEmailFromStorage() {
  try {
    const raw = localStorage.getItem('sf_auth_email');
    const email = (raw || '').trim();
    return email || '';
  } catch {
    return '';
  }
}

/**
 * writeAuthEmailToStorage
 * 写入/清理“记住我”保存的邮箱。
 */
function writeAuthEmailToStorage(email: string | null) {
  try {
    if (!email) localStorage.removeItem('sf_auth_email');
    else localStorage.setItem('sf_auth_email', email);
  } catch {}
}

/**
 * getAvatarFallback
 * 生成头像的回退字符（优先使用名字首字母）。
 */
function getAvatarFallback(name?: string) {
  const normalized = (name || '').trim();
  return normalized ? normalized.slice(0, 1).toUpperCase() : 'U';
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

/**
 * Header
 * 复刻 ui.html 的顶部胶囊导航（Pill Navigation），包括：
 * - 左侧 Logo（SoloForge）
 * - 中间锚点导航（About / Focus Areas / Services / Leadership）
 * - 右侧主题切换与「Partner With Us」按钮
 * 该组件以 fixed 顶部形式呈现，确保与参考设计一致。
 */

export default function Header() {
  const tNav = useTranslations('nav');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [user, setUser] = useState<{ name?: string; email?: string; avatarUrl?: string } | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [authEnabled, setAuthEnabled] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const avatarFallback = useMemo(() => getAvatarFallback(user?.name), [user?.name]);

  useEffect(() => {
    // 初始化 spotlight 背景中心点，保持与 ui.html 行为一致
    const spotlightBg = document.querySelector('.bg-spotlight');
    if (spotlightBg) {
      (spotlightBg as HTMLElement).style.setProperty('--mouse-x', `50%`);
      (spotlightBg as HTMLElement).style.setProperty('--mouse-y', `50%`);
    }

    const syncUser = () => setUser(readUserFromStorage());
    syncUser();
    const initialStorage = getSupabaseAuthStoragePreference();
    setRememberMe(initialStorage === 'local');
    const savedEmail = readAuthEmailFromStorage();
    if (savedEmail) setAuthEmail(savedEmail);

    const onStorage = () => syncUser();
    const onFocus = () => syncUser();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') syncUser();
    };
    const onUserUpdated = () => syncUser();

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('sf_user_updated', onUserUpdated as EventListener);

    let unsubscribeAuth: (() => void) | null = null;

    async function initSupabaseAuth() {
      try {
        const local = getSupabaseBrowserClient({ storage: 'local' });
        const session = getSupabaseBrowserClient({ storage: 'session' });

        const applySession = (nextSession: Awaited<ReturnType<typeof local.auth.getSession>>['data']['session']) => {
          if (nextSession?.user) {
            setIsAuthenticated(true);
            const meta = (nextSession.user.user_metadata ?? {}) as Record<string, unknown>;
            const nameRaw = (meta.full_name || meta.name || nextSession.user.email || '') as string;
            const avatarRaw = (meta.avatar_url || meta.picture) as string | undefined;
            const nextUser = {
              name: String(nameRaw || ''),
              email: nextSession.user.email ?? undefined,
              avatarUrl: avatarRaw ? String(avatarRaw) : undefined,
            };
            writeUserToStorage(nextUser);
            setUser(nextUser);
          } else {
            setIsAuthenticated(false);
            writeUserToStorage(null);
            setUser(null);
          }
        };

        let syncing = false;
        const syncSession = async () => {
          if (syncing) return;
          syncing = true;
          try {
            const preferred = getSupabaseAuthStoragePreference();
            const [localRes, sessionRes] = await Promise.all([local.auth.getSession(), session.auth.getSession()]);
            const chosen = preferred === 'session'
              ? sessionRes.data.session ?? localRes.data.session
              : localRes.data.session ?? sessionRes.data.session;
            applySession(chosen);
          } finally {
            syncing = false;
          }
        };

        await syncSession();

        const { data: subLocal } = local.auth.onAuthStateChange(() => {
          void syncSession();
        });
        const { data: subSession } = session.auth.onAuthStateChange(() => {
          void syncSession();
        });

        unsubscribeAuth = () => {
          subLocal.subscription.unsubscribe();
          subSession.subscription.unsubscribe();
        };
      } catch {
        setAuthEnabled(false);
        setIsAuthenticated(false);
        writeUserToStorage(null);
        setUser(null);
      }
    }

    initSupabaseAuth();

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('sf_user_updated', onUserUpdated as EventListener);
      unsubscribeAuth?.();
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const nextPath = sessionStorage.getItem('sf_post_login_redirect');
      if (!nextPath) return;
      sessionStorage.removeItem('sf_post_login_redirect');
      if (nextPath.startsWith('/developer')) {
        const parsed = new URL(nextPath, window.location.origin);
        const tab = parsed.searchParams.get('tab');
        if (tab) {
          router.push({ pathname: '/developer', query: { tab } });
        } else {
          router.push('/developer');
        }
        return;
      }

      router.push(nextPath === '/submit' ? '/submit' : '/');
    } catch {}
  }, [isAuthenticated, router]);

  /**
   * onLogout
   * 清理本地登录信息并关闭用户菜单。
   */
  async function onLogout() {
    try {
      const local = getSupabaseBrowserClient({ storage: 'local' });
      const session = getSupabaseBrowserClient({ storage: 'session' });
      await Promise.allSettled([local.auth.signOut(), session.auth.signOut()]);
    } catch {}
    writeUserToStorage(null);
    setUser(null);
    setUserMenuOpen(false);
  }

  async function onEmailAuth() {
    setAuthError(null);
    setAuthNotice(null);
    setAuthLoading(true);
    try {
      const storage = rememberMe ? 'local' : 'session';
      setSupabaseAuthStoragePreference(storage);
      const supabase = getSupabaseBrowserClient({ storage });
      const email = authEmail.trim();
      const password = authPassword;

      if (rememberMe) writeAuthEmailToStorage(email);
      else writeAuthEmailToStorage(null);

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (!signInError) {
        setAuthOpen(false);
        setAuthPassword('');
        return;
      }

      const signInMessage = getErrorMessage(signInError, '');
      const signInMessageLower = signInMessage.toLowerCase();

      if (signInMessageLower.includes('email not confirmed')) {
        setAuthNotice(tAuth('emailNotVerified', { email }));
        return;
      }

      if (!signInMessageLower.includes('invalid login credentials')) {
        setAuthError(getErrorMessage(signInError, tAuth('unknownError')));
        return;
      }

      const { error: signUpError } = await supabase.auth.signUp({ email, password });
      if (!signUpError) {
        setAuthNotice(tAuth('verifyEmailSent', { email }));
        setAuthPassword('');
        return;
      }

      const signUpMessage = getErrorMessage(signUpError, '');
      const signUpMessageLower = signUpMessage.toLowerCase();
      if (signUpMessageLower.includes('already registered')) {
        setAuthError(tAuth('wrongCredentials'));
        return;
      }

      setAuthError(getErrorMessage(signUpError, tAuth('unknownError')));
    } catch (e) {
      setAuthError(getErrorMessage(e, tAuth('unknownError')));
    } finally {
      setAuthLoading(false);
    }
  }

  async function onOAuthLogin(provider: Provider) {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const storage = rememberMe ? 'local' : 'session';
      setSupabaseAuthStoragePreference(storage);
      const supabase = getSupabaseBrowserClient({ storage });
      const redirectTo = `${window.location.origin}/${locale}/auth/callback`;
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
      if (error) throw error;
    } catch (e) {
      setAuthError(getErrorMessage(e, tAuth('unknownError')));
      setAuthLoading(false);
    }
  }

  function onSubmitClick() {
    if (isAuthenticated) {
      router.push({ pathname: '/developer', query: { tab: 'submit' } });
      return;
    }

    try {
      sessionStorage.setItem('sf_post_login_redirect', '/developer?tab=submit');
    } catch {}
    if (!authEnabled) {
      setAuthError(tAuth('notConfigured'));
    }
    setAuthNotice(null);
    setAuthOpen(true);
  }

  function onLoginClick() {
    setAuthError(null);
    setAuthNotice(null);
    const initialStorage = getSupabaseAuthStoragePreference();
    const nextRemember = initialStorage === 'local';
    setRememberMe(nextRemember);
    const savedEmail = readAuthEmailFromStorage();
    if (nextRemember && savedEmail) setAuthEmail(savedEmail);
    if (!authEnabled) {
      setAuthError(tAuth('notConfigured'));
      return;
    }
    setAuthOpen(true);
  }

  const toggleTheme = (event?: React.MouseEvent<HTMLButtonElement>) => {
    const html = document.documentElement;
    const nextIsDark = !html.classList.contains('dark');
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
    const supportsViewTransition = typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function';

    const applyTheme = () => {
      if (nextIsDark) {
        html.classList.add('dark');
        localStorage.theme = 'dark';
      } else {
        html.classList.remove('dark');
        localStorage.theme = 'light';
      }
    };

    if (!supportsViewTransition || prefersReducedMotion) {
      applyTheme();
      return;
    }

    const rect = event?.currentTarget?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const endRadius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));

    const transition = (document as unknown as { startViewTransition: (cb: () => void) => { ready: Promise<void> } }).startViewTransition(() => {
      applyTheme();
    });

    void transition.ready.then(() => {
      const expand = [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`];
      const shrink = [`circle(${endRadius}px at ${x}px ${y}px)`, `circle(0px at ${x}px ${y}px)`];

      document.documentElement.animate(
        { clipPath: shrink },
        { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-old(root)' }
      );
      document.documentElement.animate(
        { clipPath: expand },
        { duration: 450, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' }
      );
    });
  };

  return (
    <nav className="fixed top-6 z-50 left-3 right-3 sm:left-4 sm:right-4 lg:left-6 lg:right-6 xl:left-8 xl:right-8 2xl:left-10 2xl:right-10">
      <div className="flex justify-center">
        <div className="w-full max-w-6xl shrink-0 rounded-full border border-border bg-background/70 backdrop-blur-xl shadow-lg shadow-black/5 px-4 md:px-5 h-14 flex items-center justify-between gap-4 md:gap-12 transition-all duration-300">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2">
          <Globe className="text-foreground" size={20} strokeWidth={1.5} />
          <span className="text-sm font-medium tracking-tight text-foreground">
            SoloForge
          </span>
        </Link>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-6">
          <Link href="/products" className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <i className="ri-product-hunt-line text-sm" aria-hidden="true" />
            {tNav('products')}
          </Link>
          <Link href="/leaderboard" className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <i className="ri-skip-up-line text-sm" aria-hidden="true" />
            {tNav('leaderboard')}
          </Link>
          <button
            type="button"
            onClick={onSubmitClick}
            className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <i className="ri-add-circle-line text-sm" aria-hidden="true" />
            {tNav('submit')}
          </button>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 md:gap-4">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="rounded-full w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label={tCommon('search.title')}
          >
            <i className="ri-search-line text-base" aria-hidden="true" />
          </button>
          <button
            onClick={(e) => toggleTheme(e)}
            className="rounded-full w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Toggle Theme"
          >
            <Sun className="hidden dark:block" size={16} strokeWidth={1.5} />
            <Moon className="block dark:hidden" size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onSubmitClick}
            className="md:hidden text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {tNav('submit')}
          </button>
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="rounded-full w-8 h-8 flex items-center justify-center overflow-hidden border border-border bg-background/70"
                aria-label="User menu"
              >
                {user.avatarUrl ? (
                  <Image
                    src={user.avatarUrl}
                    alt={user.name || 'User'}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                    unoptimized
                    loader={({ src }) => src}
                  />
                ) : (
                  <span className="text-xs font-semibold text-foreground">{avatarFallback}</span>
                )}
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 mt-2 w-56 z-20 rounded-md shadow-lg py-1 border border-border bg-popover text-popover-foreground">
                    <div className="px-4 py-2">
                      <div className="text-sm font-medium truncate">{user.name || 'User'}</div>
                      {user.email ? <div className="text-xs text-muted-foreground truncate">{user.email}</div> : null}
                    </div>
                    <div className="h-px bg-border" />
                    <button
                      onClick={() => {
                        router.push('/developer');
                        setUserMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      {tNav('developerCenter')}
                    </button>
                    <button
                      onClick={onLogout}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                    >
                      {tNav('logout')}
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={onLoginClick}
              className="rounded-full w-8 h-8 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors border border-border bg-background/70"
              aria-label={tNav('login')}
            >
              <User size={16} strokeWidth={1.5} />
            </button>
          )}
        </div>
        </div>
      </div>

      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} locale={locale} tCommon={tCommon} />
      <AuthDialog
        key={authOpen ? 'auth-open' : 'auth-closed'}
        open={authOpen}
        onOpenChange={(open) => {
          setAuthOpen(open);
          if (!open) {
            setAuthError(null);
            setAuthNotice(null);
            setAuthPassword('');
          }
        }}
        email={authEmail}
        setEmail={setAuthEmail}
        password={authPassword}
        setPassword={setAuthPassword}
        rememberMe={rememberMe}
        setRememberMe={(next) => {
          setRememberMe(next);
          setSupabaseAuthStoragePreference(next ? 'local' : 'session');
          if (!next) writeAuthEmailToStorage(null);
        }}
        enabled={authEnabled}
        loading={authLoading}
        error={authError}
        notice={authNotice}
        onEmailAuth={onEmailAuth}
        onOAuthLogin={onOAuthLogin}
        tAuth={tAuth}
      />
    </nav>
  );
}

type SearchProduct = {
  id: string;
  name: string;
  slogan: string;
  maker_name: string;
};

type SearchDeveloper = {
  email: string;
  name: string;
  website?: string | null;
};

type SearchResult = {
  products: SearchProduct[];
  developers: SearchDeveloper[];
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

/**
 * SearchDialog
 * 顶部全站搜索弹窗：支持搜索产品与开发者，并展示快速跳转结果。
 */
function SearchDialog({
  open,
  onOpenChange,
  locale,
  tCommon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: string;
  tCommon: ReturnType<typeof useTranslations>;
}) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setLoading(false);
      setError(null);
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const q = query.trim();
    if (!q) {
      setLoading(false);
      setError(null);
      setResult(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&limit=12&language=${encodeURIComponent(locale)}`,
          { headers: { 'Accept-Language': locale }, signal: controller.signal }
        );
        const json = (await response.json()) as ApiResponse<SearchResult>;
        if (!response.ok || !json.success) {
          setResult({ products: [], developers: [] });
          setError(json.message || 'Search failed');
          return;
        }
        setResult(json.data ?? { products: [], developers: [] });
      } catch (e) {
        if ((e as { name?: string } | null)?.name !== 'AbortError') {
          setResult({ products: [], developers: [] });
          setError('Network error');
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query, locale]);

  const products = result?.products ?? [];
  const developers = result?.developers ?? [];
  const hasResults = products.length > 0 || developers.length > 0;
  const showNoResults = query.trim().length > 0 && !loading && !error && result && !hasResults;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl p-0 overflow-hidden">
        <DialogHeader className="px-5 py-4 border-b border-border">
          <DialogTitle>{tCommon('search.title')}</DialogTitle>
          <DialogDescription>{tCommon('search.placeholder')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 border-b border-border">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tCommon('search.placeholder')}
            autoFocus
          />
        </div>

        <div className="px-5 py-4 max-h-[60vh] overflow-auto">
          {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
          {error ? <div className="text-sm text-destructive">{error}</div> : null}
          {showNoResults ? <div className="text-sm text-muted-foreground">{tCommon('search.noResults')}</div> : null}

          {products.length > 0 ? (
            <div className="mt-4">
              <div className="text-xs font-semibold text-muted-foreground">{tCommon('search.products')}</div>
              <div className="mt-2 space-y-2">
                {products.map((p) => (
                  <Link
                    key={p.id}
                    href={{ pathname: '/products/[slug]', params: { slug: p.id } }}
                    onClick={() => onOpenChange(false)}
                    className="block rounded-lg border border-border bg-background/40 px-3 py-2 hover:bg-accent/30 transition-colors"
                  >
                    <div className="text-sm font-medium text-foreground truncate">{p.name}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground truncate">{p.slogan}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground truncate">by {p.maker_name}</div>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}

          {developers.length > 0 ? (
            <div className="mt-6">
              <div className="text-xs font-semibold text-muted-foreground">{tCommon('search.developers')}</div>
              <div className="mt-2 space-y-2">
                {developers.map((d) =>
                  d.website ? (
                    <a
                      key={d.email}
                      href={d.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => onOpenChange(false)}
                      className="block rounded-lg border border-border bg-background/40 px-3 py-2 hover:bg-accent/30 transition-colors"
                    >
                      <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">{d.website}</div>
                    </a>
                  ) : (
                    <div
                      key={d.email}
                      className="rounded-lg border border-border bg-background/40 px-3 py-2"
                    >
                      <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground truncate">{d.email}</div>
                    </div>
                  )
                )}
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * AuthDialog
 * 登录弹窗：根据 login.html 的视觉结构重构（标题 + 轨道动效 + 表单）。
 */
function AuthDialog({
  open,
  onOpenChange,
  email,
  setEmail,
  password,
  setPassword,
  rememberMe,
  setRememberMe,
  enabled,
  loading,
  error,
  notice,
  onEmailAuth,
  onOAuthLogin,
  tAuth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  rememberMe: boolean;
  setRememberMe: (rememberMe: boolean) => void;
  enabled: boolean;
  loading: boolean;
  error: string | null;
  notice: string | null;
  onEmailAuth: () => Promise<void>;
  onOAuthLogin: (provider: Provider) => Promise<void>;
  tAuth: ReturnType<typeof useTranslations>;
}) {
  const [orbitActive, setOrbitActive] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOrbitActive(true), 1500);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>{tAuth('title')}</DialogTitle>
          <DialogDescription>{tAuth('subtitle')}</DialogDescription>
        </DialogHeader>
        <div
          className="w-full bg-white dark:bg-card rounded-2xl shadow-xl overflow-hidden opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
          style={{ animationDelay: '0.2s' }}
        >
          <div className="p-8">
            <div className="text-center mb-8">
              <div
                className="text-4xl md:text-5xl font-semibold text-foreground mb-2 opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '0.4s' }}
              >
                {tAuth('title')}
              </div>
              <div
                className="text-muted-foreground text-base opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '0.6s' }}
              >
                {tAuth('subtitle')}
              </div>
            </div>

            <div className="flex justify-center mb-10">
              <div className="relative w-[220px] h-[220px]">
                <div
                  className="absolute inset-0 m-auto rounded-full border border-blue-500/20 opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                  style={{ width: 220, height: 220, animationDelay: '0.8s' }}
                />
                <div
                  className="absolute inset-0 m-auto rounded-full border border-blue-500/20 opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                  style={{ width: 160, height: 160, animationDelay: '0.9s' }}
                />
                <div
                  className="absolute inset-0 m-auto rounded-full border border-blue-500/20 opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                  style={{ width: 100, height: 100, animationDelay: '1s' }}
                />

                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70px] h-[70px] rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center z-10 opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards] animate-[sf-pulse_2s_infinite]"
                  style={{ animationDelay: '1.1s' }}
                >
                  <Globe size={28} strokeWidth={1.5} />
                </div>

                <div
                  className="absolute top-1/2 left-1/2"
                  style={{
                    transformOrigin: '0 0',
                    opacity: orbitActive ? 1 : 0,
                    animation: 'sf-orbit 20s linear infinite',
                    animationDelay: '-0s',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOAuthLogin('github')}
                    disabled={loading || !enabled}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white dark:bg-background shadow flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-50"
                    aria-label={tAuth('continueWith', { provider: 'GitHub' })}
                  >
                    <i className="ri-github-fill text-[18px] text-blue-600" aria-hidden="true" />
                  </button>
                </div>

                <div
                  className="absolute top-1/2 left-1/2"
                  style={{
                    transformOrigin: '0 0',
                    opacity: orbitActive ? 1 : 0,
                    animation: 'sf-orbit 20s linear infinite',
                    animationDelay: '-6.67s',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOAuthLogin('google')}
                    disabled={loading || !enabled}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white dark:bg-background shadow flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-50"
                    aria-label={tAuth('continueWith', { provider: 'Google' })}
                  >
                    <i className="ri-google-fill text-[18px] text-blue-600" aria-hidden="true" />
                  </button>
                </div>

                <div
                  className="absolute top-1/2 left-1/2"
                  style={{
                    transformOrigin: '0 0',
                    opacity: orbitActive ? 1 : 0,
                    animation: 'sf-orbit 20s linear infinite',
                    animationDelay: '-13.34s',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOAuthLogin('twitter')}
                    disabled={loading || !enabled}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white dark:bg-background shadow flex items-center justify-center transition-transform hover:scale-110 disabled:opacity-50"
                    aria-label={tAuth('continueWith', { provider: 'X' })}
                  >
                    <i className="ri-twitter-x-line text-[18px] text-blue-600" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <form
              className="space-y-6"
              onSubmit={(e) => {
                e.preventDefault();
                void onEmailAuth();
              }}
            >
              <div
                className="opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '1.2s' }}
              >
                <Label htmlFor="sf-auth-email" className="block text-sm font-medium text-muted-foreground mb-1">
                  {tAuth('email')}
                </Label>
                <div className="relative">
                  <i
                    className="ri-mail-fill pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="sf-auth-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={tAuth('emailPlaceholder')}
                    disabled={loading || !enabled}
                    className="h-11 rounded-lg pl-10"
                  />
                </div>
              </div>

              <div
                className="opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '1.3s' }}
              >
                <Label htmlFor="sf-auth-password" className="block text-sm font-medium text-muted-foreground mb-1">
                  {tAuth('password')}
                </Label>
                <div className="relative">
                  <i
                    className="ri-lock-fill pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="sf-auth-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={tAuth('passwordPlaceholder')}
                    disabled={loading || !enabled}
                    className="h-11 rounded-lg pl-10"
                  />
                </div>
              </div>

              <div
                className="flex items-center opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '1.4s' }}
              >
                <label className="inline-flex items-center gap-2 text-sm text-muted-foreground select-none cursor-pointer">
                  <span className="relative inline-flex h-4 w-4 items-center justify-center">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="peer h-4 w-4 appearance-none rounded border border-border bg-background/60 shadow-sm transition-colors checked:bg-foreground checked:border-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="记住我"
                    />
                    <svg
                      viewBox="0 0 20 20"
                      fill="none"
                      className="pointer-events-none absolute h-3.5 w-3.5 opacity-0 peer-checked:opacity-100 text-background"
                      aria-hidden="true"
                    >
                      <path
                        d="M16.704 5.292a1 1 0 0 1 0 1.416l-7.6 7.6a1 1 0 0 1-1.416 0l-3.6-3.6a1 1 0 1 1 1.416-1.416l2.892 2.892 6.892-6.892a1 1 0 0 1 1.416 0Z"
                        fill="currentColor"
                      />
                    </svg>
                  </span>
                  <span>记住我</span>
                </label>
              </div>

              {error ? <div className="text-sm text-destructive">{error}</div> : null}
              {notice ? <div className="text-sm text-muted-foreground">{notice}</div> : null}

              <div
                className="opacity-0 animate-[sf-scale-in_0.5s_ease-in-out_forwards]"
                style={{ animationDelay: '1.5s' }}
              >
                <Button
                  type="submit"
                  disabled={loading || !enabled || !email || !password}
                  className="w-full h-11 rounded-lg bg-foreground hover:bg-foreground/90 text-background"
                >
                  {loading ? tAuth('loading') : tAuth('continue')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
