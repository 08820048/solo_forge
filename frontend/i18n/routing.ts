import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const routing = defineRouting({
  // A list of all locales that are supported
  locales: ['en', 'zh'],

  // Used when no locale matches
  defaultLocale: 'en',
  // Always prefix routes with the locale (e.g., /en, /zh)
  localePrefix: 'always',

  // The `pathnames` object holds pairs of internal and
  // external paths. Based on the locale, the external
  // paths are rewritten to the shared, internal ones.
  pathnames: {
    '/': '/',
    '/products': '/products',
    '/products/[slug]': '/products/[slug]',
    '/leaderboard': '/leaderboard',
    '/pricing': '/pricing',
    '/developer': '/developer',
    '/developer/products/[id]': '/developer/products/[id]',
    '/makers/[email]': '/makers/[email]',
    '/profile': '/profile',
    '/submit': '/submit',
    '/about': '/about',
    '/feedback': '/feedback'
  }
});

// Lightweight wrappers around Next.js' navigation APIs
// that will consider the routing configuration
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
