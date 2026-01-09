import type { MetadataRoute } from 'next';
import { routing } from '@/i18n/routing';

function getSiteUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  const vercel = (process.env.VERCEL_URL || '').trim();
  if (vercel) return `https://${vercel}`.replace(/\/+$/, '');

  if (process.env.NODE_ENV === 'development') return 'http://localhost:3000';

  return 'https://soloforge.dev';
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getSiteUrl();
  const now = new Date();
  const staticPathnames = Object.keys(routing.pathnames).filter((p) => !p.includes('['));

  const entries: MetadataRoute.Sitemap = [];
  for (const locale of routing.locales) {
    for (const pathname of staticPathnames) {
      const suffix = pathname === '/' ? '' : pathname;
      entries.push({
        url: `${base}/${locale}${suffix}`,
        lastModified: now,
        changeFrequency: pathname === '/' ? 'daily' : 'weekly',
        priority: pathname === '/' ? 1 : 0.7,
      });
    }
  }

  return entries;
}

