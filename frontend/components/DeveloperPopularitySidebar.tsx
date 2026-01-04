'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

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
 * getInteractionUserId
 * 获取交互用户标识：优先使用登录用户邮箱，否则生成匿名 id。
 */
function getInteractionUserId(): string {
  try {
    const raw = localStorage.getItem('sf_user');
    if (raw) {
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const email = (parsed?.email || '').trim();
      if (email) return email.toLowerCase();
    }
  } catch {}

  try {
    const existing = localStorage.getItem('sf_anon_id');
    if (existing) return existing;
    const next = `anon_${globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now())}`;
    localStorage.setItem('sf_anon_id', next);
    return next;
  } catch {
    return `anon_${String(Date.now())}`;
  }
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

function renderRank(rank: number) {
  if (rank === 1) {
    return (
      <span className="flex items-center gap-1 text-yellow-500">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="flex items-center gap-1 text-slate-300">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="flex items-center gap-1 text-amber-700">
        <i className="ri-medal-line text-base" aria-hidden="true" />
        <span className="text-xs font-semibold">#{rank}</span>
      </span>
    );
  }
  return <span className="text-xs font-semibold text-muted-foreground">#{rank}</span>;
}

/**
 * DeveloperPopularitySidebar
 * 首页左侧栏：展示「热门开发者 Top 5」与「上月最受欢迎开发者」。
 */
export default function DeveloperPopularitySidebar() {
  const t = useTranslations('home.developerLeaderboard');
  const tTop = useTranslations('home.topDevelopers');
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<DeveloperPopularity[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [topLoading, setTopLoading] = useState(true);
  const [topList, setTopList] = useState<DeveloperWithFollowers[]>([]);
  const [topMessage, setTopMessage] = useState<string | null>(null);
  const [followedDevelopers, setFollowedDevelopers] = useState<string[]>(() => readFollowedDevelopersFromStorage());

  useEffect(() => {
    let cancelled = false;

    /**
     * fetchPopularity
     * 拉取上月开发者热度榜（按 likes + favorites）。
     */
    async function fetchPopularity() {
      setLoading(true);
      setMessage(null);
      try {
        const response = await fetch(`/api/developers?kind=popularity_last_month&limit=10`, {
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
          user_id: getInteractionUserId(),
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

  return (
    <div className="lg:sticky lg:top-24">
      <div className="space-y-6">
        <div className="rounded-xl border border-border bg-card/50">
          <div className="px-5 py-4 border-b border-border">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{tTop('title')}</div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{tTop('subtitle')}</div>
          </div>

          <div className="px-5 py-4">
            {topLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{tTop('loading')}</div>
            ) : topList.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{topMessage || tTop('empty')}</div>
            ) : (
              <div className="space-y-3">
                {topList.map((d, idx) => (
                  <div
                    key={d.email}
                    className="flex items-start gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="w-12 shrink-0 flex items-center pt-0.5">{renderRank(idx + 1)}</div>
                    <div className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {(d.name || d.email).trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 text-[11px] text-muted-foreground">{tTop('followers', { count: d.followers })}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleFollowDeveloper(d.email)}
                          className="shrink-0 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                          {followedDevelopers.map((v) => v.toLowerCase()).includes(d.email.toLowerCase()) ? tTop('unfollow') : tTop('follow')}
                        </button>
                      </div>

                    {d.website ? (
                      <a
                        href={d.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {t('visit')}
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/50">
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
              <div className="py-8 text-center text-sm text-muted-foreground">{t('loading')}</div>
            ) : list.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{message || t('empty')}</div>
            ) : (
              <div className="space-y-3">
                {list.map((d, idx) => (
                  <div
                    key={d.email}
                    className="flex items-start gap-3 rounded-xl border border-border bg-background/40 px-3 py-3"
                  >
                    <div className="w-12 shrink-0 flex items-center pt-0.5">{renderRank(idx + 1)}</div>
                    <div className="w-9 h-9 shrink-0 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                      {(d.name || d.email).trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-foreground truncate">{d.name || d.email}</div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{t('favorites', { count: d.favorites })}</span>
                            <span>·</span>
                            <span>{t('likes', { count: d.likes })}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {t('score', { score: d.score })}
                        </Badge>
                      </div>

                      {d.website ? (
                        <a
                          href={d.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {t('visit')}
                        </a>
                      ) : null}
                    </div>
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
