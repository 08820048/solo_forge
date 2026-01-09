'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { useRouter } from '@/i18n/routing';

/**
 * readFollowedDevelopersFromStorage
 * 从 localStorage 读取已关注开发者列表（email 数组）。
 */
function readFollowedDevelopersFromStorage(): string[] {
  try {
    const raw = localStorage.getItem('sf_followed_developers');
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v) => typeof v === 'string') as string[];
  } catch {
    return [];
  }
}

/**
 * writeFollowedDevelopersToStorage
 * 写入已关注开发者列表到 localStorage，并广播更新事件。
 */
function writeFollowedDevelopersToStorage(emails: string[]) {
  try {
    localStorage.setItem('sf_followed_developers', JSON.stringify(emails));
    window.dispatchEvent(new Event('sf_followed_developers_updated'));
  } catch {}
}

/**
 * getAuthenticatedUserEmail
 * 获取已登录用户邮箱（未登录返回 null）。
 */
function getAuthenticatedUserEmail(): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}

  return null;
}

/**
 * requestAuth
 * 触发全局登录弹窗，并记录登录后回跳路径。
 */
function requestAuth(redirectPath: string) {
  try {
    sessionStorage.setItem('sf_post_login_redirect', redirectPath);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('sf_require_auth', { detail: { redirectPath } }));
  } catch {
    window.dispatchEvent(new Event('sf_require_auth'));
  }
}

function isSameUserEmail(a?: string | null, b?: string | null): boolean {
  const left = (a || '').trim().toLowerCase();
  const right = (b || '').trim().toLowerCase();
  if (!left || !right) return false;
  return left === right;
}

type DeveloperPopularity = {
  email: string;
  name: string;
  avatar_url?: string | null;
  website?: string | null;
  likes: number;
  favorites: number;
  score: number;
};

type DeveloperWithFollowers = {
  email: string;
  name: string;
  avatar_url?: string | null;
  website?: string | null;
  followers: number;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

/**
 * getCurrentUserAvatarOverride
 * 当列表项是当前登录用户时，用本地 sf_user.avatarUrl 覆盖后端返回的 avatar_url（避免等待后端数据刷新）。
 */
function getCurrentUserAvatarOverride(email: string, fallbackAvatarUrl?: string | null): string | null {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return fallbackAvatarUrl ?? null;
    const parsed = JSON.parse(raw) as { email?: string; avatarUrl?: string } | null;
    const storedEmail = (parsed?.email || '').trim().toLowerCase();
    const avatarUrl = (parsed?.avatarUrl || '').trim();
    if (!storedEmail || storedEmail !== email.trim().toLowerCase()) return fallbackAvatarUrl ?? null;
    return avatarUrl || fallbackAvatarUrl || null;
  } catch {
    return fallbackAvatarUrl ?? null;
  }
}

/**
 * renderRank
 * 渲染名次徽章：前三名显示 medal 图标与配色，其他显示灰色数字。
 */
function renderRank(rank: number) {
  if (rank === 1) {
    return (
      <span className="flex items-center text-yellow-500">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="flex items-center text-slate-300">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="flex items-center text-amber-700">
        <i className="ri-medal-line text-base" aria-hidden="true" />
      </span>
    );
  }
  return <span className="text-xs font-semibold text-muted-foreground">{rank}</span>;
}

/**
 * DeveloperPopularitySidebar
 * 首页左侧栏：展示「热门开发者 Top 5」与「最近一周最活跃开发者」。
 */
export default function DeveloperPopularitySidebar() {
  const t = useTranslations('home.developerLeaderboard');
  const tTop = useTranslations('home.topDevelopers');
  const locale = useLocale();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<DeveloperPopularity[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [topLoading, setTopLoading] = useState(true);
  const [topList, setTopList] = useState<DeveloperWithFollowers[]>([]);
  const [topMessage, setTopMessage] = useState<string | null>(null);
  const [followedDevelopers, setFollowedDevelopers] = useState<string[]>(() => readFollowedDevelopersFromStorage());
  const currentUserEmail = getAuthenticatedUserEmail();

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchPopularity
     * 拉取最近一周开发者热度榜（按 likes + favorites）。
     */
    async function fetchPopularity() {
      setLoading(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/developers?kind=popularity_last_week&limit=10`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<DeveloperPopularity[]> = await response.json();
        if (cancelled) return;

        if (!json.success) {
          setList([]);
          setMessage(json.message ?? null);
          return;
        }

        setList(json.data ?? []);
      } catch {
        if (!cancelled) {
          setList([]);
          setMessage(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPopularity();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const onDevelopersUpdated = () => {
      const refetch = async () => {
        try {
          const [popRes, topRes] = await Promise.all([
            fetch(`/api/developers?kind=popularity_last_week&limit=10`, {
              headers: { 'Accept-Language': locale },
            }),
            fetch(`/api/developers?kind=top&limit=5`, {
              headers: { 'Accept-Language': locale },
            }),
          ]);
          const popJson: ApiResponse<DeveloperPopularity[]> = await popRes.json();
          const topJson: ApiResponse<DeveloperWithFollowers[]> = await topRes.json();
          if (popJson.success) setList(popJson.data ?? []);
          if (topJson.success) setTopList(topJson.data ?? []);
        } catch {
        }
      };
      void refetch();
    };
    window.addEventListener('sf_developers_updated', onDevelopersUpdated as EventListener);
    return () => window.removeEventListener('sf_developers_updated', onDevelopersUpdated as EventListener);
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchTop
     * 拉取热门开发者 Top 5（按关注数排序）。
     */
    async function fetchTop() {
      setTopLoading(true);
      setTopMessage(null);
      try {
        const response = await fetch(`/api/developers?kind=top&limit=5`, {
          headers: { 'Accept-Language': locale },
        });
        const json: ApiResponse<DeveloperWithFollowers[]> = await response.json();
        if (cancelled) return;

        if (!json.success) {
          setTopList([]);
          setTopMessage(json.message ?? null);
          return;
        }

        setTopList(json.data ?? []);
      } catch {
        if (!cancelled) {
          setTopList([]);
          setTopMessage(null);
        }
      } finally {
        if (!cancelled) setTopLoading(false);
      }
    }

    fetchTop();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    const onUpdate = () => setFollowedDevelopers(readFollowedDevelopersFromStorage());
    window.addEventListener('sf_followed_developers_updated', onUpdate as EventListener);
    return () => window.removeEventListener('sf_followed_developers_updated', onUpdate as EventListener);
  }, []);

  /**
   * toggleFollowDeveloper
   * 关注/取消关注开发者（本地乐观更新 + 后端写入）。
   */
  const toggleFollowDeveloper = async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    const userEmail = getAuthenticatedUserEmail();
    if (!userEmail) {
      requestAuth('/');
      return;
    }
    if (isSameUserEmail(normalizedEmail, userEmail)) return;

    const prev = followedDevelopers;
    const prevSet = new Set(prev.map((e) => e.toLowerCase()));
    const isFollowing = prevSet.has(normalizedEmail);

    const nextSet = new Set(prevSet);
    if (isFollowing) nextSet.delete(normalizedEmail);
    else nextSet.add(normalizedEmail);

    const next = Array.from(nextSet);
    setFollowedDevelopers(next);
    writeFollowedDevelopersToStorage(next);
    setTopList((cur) =>
      cur.map((d) =>
        d.email.toLowerCase() === normalizedEmail
          ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? -1 : 1)) }
          : d
      )
    );

    try {
      const response = await fetch('/api/developers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': locale },
        body: JSON.stringify({
          action: isFollowing ? 'unfollow' : 'follow',
          email: normalizedEmail,
          user_id: userEmail,
        }),
      });
      const json = (await response.json()) as { success?: boolean };
      if (!response.ok || !json.success) {
        setFollowedDevelopers(prev);
        writeFollowedDevelopersToStorage(prev);
        setTopList((cur) =>
          cur.map((d) =>
            d.email.toLowerCase() === normalizedEmail
              ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? 1 : -1)) }
              : d
          )
        );
      }
    } catch {
      setFollowedDevelopers(prev);
      writeFollowedDevelopersToStorage(prev);
      setTopList((cur) =>
        cur.map((d) =>
          d.email.toLowerCase() === normalizedEmail
            ? { ...d, followers: Math.max(0, d.followers + (isFollowing ? 1 : -1)) }
            : d
        )
      );
    }
  };

  const openMakerProfile = (email: string) => {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) return;
    router.push({ pathname: '/makers/[email]', params: { email: normalized } });
  };

  return (
    <div className="animate-on-scroll lg:sticky lg:top-24">
      <div className="space-y-6">
        <div className="sf-wash rounded-xl border border-border bg-card/50">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{tTop('title')}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{tTop('subtitle')}</div>
          </div>

          <div className="px-5 py-4">
            {topLoading ? (
              <div className="space-y-3 animate-in fade-in-0 duration-300">
                {Array.from({ length: 3 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3 animate-pulse"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-8 rounded bg-muted" />
                      <div className="mt-3 flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="h-4 w-2/3 rounded bg-muted" />
                          <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
                        </div>
                      </div>
                    </div>
                    <div className="h-7 w-16 rounded bg-muted" />
                  </div>
                ))}
                <div className="pt-1 text-center text-xs text-muted-foreground">{tTop('loading')}</div>
              </div>
            ) : topList.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground animate-in fade-in-0 duration-300">
                {topMessage || tTop('empty')}
              </div>
            ) : (
              <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                {topList.map((d, idx) => (
                  <div
                    key={d.email}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">{renderRank(idx + 1)}</div>
                      <button
                        type="button"
                        onClick={() => openMakerProfile(d.email)}
                        className="mt-2 flex items-center gap-2 min-w-0 text-left hover:opacity-90 transition-opacity"
                      >
                        <div className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden text-xs font-semibold text-muted-foreground">
                          {getCurrentUserAvatarOverride(d.email, d.avatar_url) ? (
                            <Image
                              src={getCurrentUserAvatarOverride(d.email, d.avatar_url) as string}
                              alt={d.name || d.email}
                              width={36}
                              height={36}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              unoptimized
                              loader={({ src }) => src}
                            />
                          ) : (
                            (d.name || d.email).trim().charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground whitespace-nowrap">
                            {tTop('followers', { count: d.followers })}
                          </div>
                        </div>
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={isSameUserEmail(d.email, currentUserEmail)}
                      onClick={() => void toggleFollowDeveloper(d.email)}
                      className={[
                        'shrink-0 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs text-foreground transition-all duration-200 active:scale-95',
                        isSameUserEmail(d.email, currentUserEmail)
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-accent hover:text-accent-foreground',
                      ].join(' ')}
                    >
                      <span
                        key={followedDevelopers.map((v) => v.toLowerCase()).includes(d.email.toLowerCase()) ? 'unfollow' : 'follow'}
                        className="inline-block animate-[sf-scale-in_0.18s_ease-out_forwards]"
                      >
                        {followedDevelopers.map((v) => v.toLowerCase()).includes(d.email.toLowerCase()) ? tTop('unfollow') : tTop('follow')}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="sf-wash rounded-xl border border-border bg-card/50">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{t('title')}</div>
              <Badge variant="secondary" className="shrink-0">
                {t('badge')}
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t('subtitle')}</div>
          </div>

          <div className="px-5 py-4">
            {loading ? (
              <div className="space-y-3 animate-in fade-in-0 duration-300">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3 animate-pulse"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="h-4 w-8 rounded bg-muted" />
                      <div className="mt-3 flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-muted" />
                        <div className="min-w-0 flex-1">
                          <div className="h-4 w-2/3 rounded bg-muted" />
                          <div className="mt-2 h-3 w-3/4 rounded bg-muted" />
                        </div>
                      </div>
                    </div>
                    <div className="h-6 w-12 rounded bg-muted" />
                  </div>
                ))}
                <div className="pt-1 text-center text-xs text-muted-foreground">{t('loading')}</div>
              </div>
            ) : list.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground animate-in fade-in-0 duration-300">
                {message || t('empty')}
              </div>
            ) : (
              <div className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                {list.map((d, idx) => (
                  <div
                    key={d.email}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center">{renderRank(idx + 1)}</div>
                      <button
                        type="button"
                        onClick={() => openMakerProfile(d.email)}
                        className="mt-2 flex items-center gap-2 min-w-0 text-left hover:opacity-90 transition-opacity"
                      >
                        <div className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center overflow-hidden text-xs font-semibold text-muted-foreground">
                          {getCurrentUserAvatarOverride(d.email, d.avatar_url) ? (
                            <Image
                              src={getCurrentUserAvatarOverride(d.email, d.avatar_url) as string}
                              alt={d.name || d.email}
                              width={36}
                              height={36}
                              className="w-full h-full object-cover"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              unoptimized
                              loader={({ src }) => src}
                            />
                          ) : (
                            (d.name || d.email).trim().charAt(0).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground whitespace-nowrap">
                            <span>{t('favorites', { count: d.favorites })}</span>
                            <span>·</span>
                            <span>{t('likes', { count: d.likes })}</span>
                          </div>
                        </div>
                      </button>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      <span className="inline-flex items-center gap-1">
                        <i className="ri-fire-fill text-orange-500" aria-hidden="true" />
                        <span className="tabular-nums">{d.score}</span>
                      </span>
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
