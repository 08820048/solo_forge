'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { Link as I18nLink } from '@/i18n/routing';
import LanguageSwitcher from './LanguageSwitcher';

export default function Footer() {
  const t = useTranslations('footer');
  const tNav = useTranslations('nav');
  const currentYear = new Date().getFullYear();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('sf_user');
      if (!raw) return;
      const parsed = JSON.parse(raw) as { email?: string } | null;
      const storedEmail = (parsed?.email || '').trim();
      if (storedEmail) {
        setEmail(storedEmail);
      }
    } catch {
    }
  }, []);

  async function onSubscribe() {
    setMessage(null);
    const value = email.trim();
    if (!value) {
      setMessage(t('newsletter.missingEmail'));
      return;
    }
    setSubmitting(true);
    try {
      const payload = JSON.stringify({ email: value });

      const proxyResponse = await fetch('/api/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const proxyData = (await proxyResponse.json().catch(() => ({}))) as { success?: boolean; message?: string } | undefined;
      if (proxyResponse.ok && proxyData?.success) {
        setMessage(t('newsletter.success'));
        return;
      }

      const shouldFallback =
        proxyResponse.status === 403 ||
        proxyResponse.status === 502 ||
        proxyResponse.status === 503;

      if (!shouldFallback) {
        setMessage(proxyData?.message || t('newsletter.failed'));
        return;
      }

      const directResponse = await fetch('https://api.soloforge.dev/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const directData = (await directResponse.json().catch(() => ({}))) as { success?: boolean; message?: string } | undefined;
      if (!directResponse.ok || !directData?.success) {
        setMessage(directData?.message || proxyData?.message || t('newsletter.failed'));
        return;
      }

      setMessage(t('newsletter.success'));
    } catch {
      setMessage(t('newsletter.failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer className="bg-background text-muted-foreground border-t border-border">
      <div className="mx-4 sm:mx-6 lg:mx-8 xl:mx-[290px] py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand + Newsletter */}
          <div className="col-span-1 md:col-span-2">
            <div className="mb-4">
              <div className="inline-flex items-center gap-2 text-xl font-semibold text-foreground bg-spotlight">
                <i className="ri-hammer-line text-foreground text-xl" aria-hidden="true" />
                <span>SoloForge</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground max-w-md font-sans">
                {t('description')}
              </p>
            </div>
            <div className="mt-4 space-y-2 max-w-md">
              <p className="text-xs text-muted-foreground font-sans">
                {t('newsletter.description')}
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('newsletter.placeholder')}
                  className="flex-1 rounded-md border border-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/60 font-sans"
                />
                <button
                  type="button"
                  onClick={onSubscribe}
                  disabled={submitting}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed font-sans"
                >
                  {submitting ? t('newsletter.submitting') : t('newsletter.submit')}
                </button>
              </div>
              {message ? (
                <p className="text-xs text-muted-foreground font-sans">
                  {message}
                </p>
              ) : null}
            </div>
          </div>

          {/* Links */}
          <div>
            <h3 className="text-foreground font-semibold mb-4 font-sans">Links</h3>
            <ul className="space-y-2">
              <li>
                <I18nLink href="/about" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('links.about')}
                </I18nLink>
              </li>
              <li>
                <a href="mailto:contact@soloforge.com" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('links.contact')}
                </a>
              </li>
              <li>
                <NextLink href="/terms" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('links.terms')}
                </NextLink>
              </li>
              <li>
                <NextLink href="/privacy" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('links.privacy')}
                </NextLink>
              </li>
            </ul>
          </div>

          {/* Social */}
          <div>
            <h3 className="text-foreground font-semibold mb-4 font-sans">{t('social.title')}</h3>
            <ul className="space-y-2">
              <li>
                <I18nLink href="/feedback" className="text-sm hover:text-foreground transition-colors font-sans">
                  {tNav('feedback')}
                </I18nLink>
              </li>
              <li>
                <a href="https://twitter.com/soloforge" target="_blank" rel="noopener noreferrer" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('social.twitter')}
                </a>
              </li>
              <li>
                <a href="https://github.com/soloforge" target="_blank" rel="noopener noreferrer" className="text-sm hover:text-foreground transition-colors font-sans">
                  {t('social.github')}
                </a>
              </li>
            </ul>
            <div className="mt-6">
              <LanguageSwitcher />
            </div>
          </div>
        </div>

        <div className="border-t border-border mt-8 pt-8 text-sm text-center text-muted-foreground font-sans">
          {t('copyright', { year: currentYear })}
        </div>
      </div>
    </footer>
  );
}
