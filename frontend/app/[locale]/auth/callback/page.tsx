'use client';

import { useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { getSupabaseAuthStoragePreference, getSupabaseBrowserClient } from '@/lib/supabase';

export default function SupabaseAuthCallbackPage() {
  const t = useTranslations('auth');
  const locale = useLocale();

  useEffect(() => {
    let cancelled = false;

    async function finishAuth() {
      try {
        const storage = getSupabaseAuthStoragePreference();
        const supabase = getSupabaseBrowserClient({ storage });
        await supabase.auth.getSession();
      } finally {
        if (!cancelled) {
          window.location.replace(`/${locale}`);
        }
      }
    }

    finishAuth();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center text-muted-foreground">
      {t('redirecting')}
    </div>
  );
}
