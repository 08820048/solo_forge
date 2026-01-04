'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { Link as I18nLink } from '@/i18n/routing';
import LanguageSwitcher from './LanguageSwitcher';

export default function Footer() {
  const t = useTranslations('footer');
  const tNav = useTranslations('nav');
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-background text-muted-foreground border-t border-border">
      <div className="mx-4 sm:mx-6 lg:mx-8 xl:mx-[290px] py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
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
