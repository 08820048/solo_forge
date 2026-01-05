'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Image from 'next/image';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ProfileFormState = {
  name: string;
  avatarUrl: string;
};

const AVATAR_BUCKET = 'avatars';
const MAX_AVATAR_BYTES = 3 * 1024 * 1024;

function getInitialProfileState(): ProfileFormState {
  try {
    const raw = localStorage.getItem('sf_user');
    if (!raw) return { name: '', avatarUrl: '' };
    const parsed = JSON.parse(raw) as { name?: string; avatarUrl?: string } | null;
    return {
      name: (parsed?.name || '').trim(),
      avatarUrl: (parsed?.avatarUrl || '').trim(),
    };
  } catch {
    return { name: '', avatarUrl: '' };
  }
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tAuth = useTranslations('auth');
  const [form, setForm] = useState<ProfileFormState>(() => getInitialProfileState());
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        const sessionUser = data.session?.user;
        if (!sessionUser) {
          setCurrentEmail(null);
          setCurrentUserId(null);
          return;
        }
        setCurrentEmail(sessionUser.email ?? null);
        setCurrentUserId(sessionUser.id ?? null);
        const meta = (sessionUser.user_metadata ?? {}) as Record<string, unknown>;
        const nameRaw = (meta.full_name || meta.name || sessionUser.email || '') as string;
        const avatarRaw = (meta.avatar_url || meta.picture) as string | undefined;
        const name = String(nameRaw || '').trim();
        const avatarUrl = avatarRaw ? String(avatarRaw).trim() : '';
        setForm({
          name,
          avatarUrl,
        });
      } catch {
      }
    }
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onPickAvatarFile(file: File | null) {
    if (!file) return;
    setError(null);
    setSuccess(null);

    if (file.size > MAX_AVATAR_BYTES) {
      setError(t('avatarTooLarge'));
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError(t('avatarInvalidType'));
      return;
    }
    if (!currentUserId) {
      setError(t('notLoggedIn'));
      return;
    }

    setUploading(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const path = `${currentUserId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
        upsert: false,
        contentType: file.type,
        cacheControl: '3600',
      });
      if (uploadError) {
        setError(getErrorMessage(uploadError, t('avatarUploadFailed')));
        return;
      }

      const { data: urlData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = (urlData?.publicUrl || '').trim();
      if (!publicUrl) {
        setError(t('avatarUploadFailed'));
        return;
      }
      setForm((prev) => ({ ...prev, avatarUrl: publicUrl }));
      setSuccess(t('avatarUploaded'));
    } catch (e) {
      setError(getErrorMessage(e, t('avatarUploadFailed')));
    } finally {
      setUploading(false);
    }
  }

  async function onSave() {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const name = form.name.trim();
      const avatarUrl = form.avatarUrl.trim();
      const updates: Record<string, unknown> = {};
      if (name) updates.full_name = name;
      if (!name) updates.full_name = null;
      if (avatarUrl) updates.avatar_url = avatarUrl;
      if (!avatarUrl) updates.avatar_url = null;

      const { data, error } = await supabase.auth.updateUser({ data: updates });
      if (error) {
        setError(getErrorMessage(error, tAuth('unknownError')));
        return;
      }

      const updatedUser = data.user;
      if (updatedUser) {
        const meta = (updatedUser.user_metadata ?? {}) as Record<string, unknown>;
        const nameRaw = (meta.full_name || meta.name || updatedUser.email || '') as string;
        const avatarRaw = (meta.avatar_url || meta.picture) as string | undefined;
        const stored = {
          name: String(nameRaw || ''),
          email: updatedUser.email ?? undefined,
          avatarUrl: avatarRaw ? String(avatarRaw) : undefined,
        };
        try {
          localStorage.setItem('sf_user', JSON.stringify(stored));
          window.dispatchEvent(new Event('sf_user_updated'));
        } catch {
        }
        if (stored.email) {
          try {
            const response = await fetch('/api/developers', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: stored.email,
                user_id: stored.email,
                name: stored.name,
                avatar_url: stored.avatarUrl ?? null,
              }),
            });
            if (response.ok) {
              try {
                window.dispatchEvent(new Event('sf_developers_updated'));
              } catch {}
            }
          } catch {
          }
        }
        setForm({
          name: stored.name,
          avatarUrl: stored.avatarUrl ?? '',
        });
      }

      setSuccess(t('saved'));
    } catch (e) {
      setError(getErrorMessage(e, tAuth('unknownError')));
    } finally {
      setSaving(false);
    }
  }

  const avatarPreviewUrl = form.avatarUrl.trim();

  return (
    <div className="max-w-xl mx-auto py-12">
      <h1 className="text-2xl font-semibold mb-2">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mb-8">{t('subtitle')}</p>

      {!currentEmail ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {t('notLoggedIn')}
        </div>
      ) : null}

      <div className="space-y-6 mt-4">
        <div className="flex items-center gap-4">
          <div className="relative w-16 h-16 rounded-full border border-border bg-muted overflow-hidden flex items-center justify-center text-lg font-semibold">
            {avatarPreviewUrl ? (
              <Image
                src={avatarPreviewUrl}
                alt={form.name || currentEmail || 'Avatar'}
                width={64}
                height={64}
                className="w-full h-full object-cover"
                unoptimized
                loader={({ src }) => src}
              />
            ) : (
              <span>{(form.name || currentEmail || 'U').slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            <div>{t('avatarTip')}</div>
          </div>
        </div>

        <div>
          <Label htmlFor="sf-profile-avatar-file" className="block text-sm font-medium text-muted-foreground mb-1">
            {t('uploadAvatar')}
          </Label>
          <Input
            id="sf-profile-avatar-file"
            type="file"
            accept="image/*"
            disabled={!currentEmail || uploading}
            onChange={(e) => void onPickAvatarFile(e.target.files?.[0] ?? null)}
          />
          <p className="mt-1 text-xs text-muted-foreground">{t('uploadHelp')}</p>
        </div>

        <div>
          <Label htmlFor="sf-profile-name" className="block text-sm font-medium text-muted-foreground mb-1">
            {t('name')}
          </Label>
          <Input
            id="sf-profile-name"
            type="text"
            autoComplete="name"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={t('namePlaceholder')}
          />
        </div>

        <div>
          <Label htmlFor="sf-profile-avatar" className="block text-sm font-medium text-muted-foreground mb-1">
            {t('avatarUrl')}
          </Label>
          <Input
            id="sf-profile-avatar"
            type="url"
            inputMode="url"
            value={form.avatarUrl}
            readOnly
            placeholder={t('avatarUrlPlaceholder')}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!form.avatarUrl || saving || uploading}
              onClick={() => setForm((prev) => ({ ...prev, avatarUrl: '' }))}
            >
              {t('clearAvatar')}
            </Button>
          </div>
        </div>

        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {success ? <div className="text-sm text-emerald-600 dark:text-emerald-400">{success}</div> : null}

        <div className="pt-2">
          <Button
            type="button"
            onClick={() => void onSave()}
            disabled={saving || uploading || !currentEmail}
            className="bg-black text-white hover:bg-black/90"
          >
            {saving ? t('saving') : uploading ? t('uploading') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
