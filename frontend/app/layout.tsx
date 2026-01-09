import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

function getSiteUrl(): URL {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (explicit) {
    try {
      return new URL(explicit.endsWith('/') ? explicit : `${explicit}/`);
    } catch {}
  }

  const vercel = (process.env.VERCEL_URL || '').trim();
  if (vercel) {
    try {
      return new URL(`https://${vercel}/`);
    } catch {}
  }

  if (process.env.NODE_ENV === 'development') {
    return new URL('http://localhost:3000/');
  }

  return new URL('https://soloforge.dev/');
}

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  title: {
    default: 'SoloForge',
    template: '%s · SoloForge',
  },
  description: "The Forge for Solo Makers' Products",
  alternates: {
    canonical: '/en',
    languages: {
      en: '/en',
      zh: '/zh',
    },
  },
  openGraph: {
    type: 'website',
    siteName: 'SoloForge',
    title: 'SoloForge',
    description: "The Forge for Solo Makers' Products",
    images: [
      {
        url: '/docs/imgs/image.jpg',
      },
    ],
  },
  twitter: {
    card: 'summary',
    title: 'SoloForge',
    description: "The Forge for Solo Makers' Products",
    images: ['/docs/imgs/image.jpg'],
  },
  icons: {
    icon: '/docs/imgs/image.jpg',
    apple: '/docs/imgs/image.jpg',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/remixicon@4.6.0/fonts/remixicon.css"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var theme = localStorage.getItem('theme');
                  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
                  var isDark = theme === 'dark' || (!theme || theme === 'system') && prefersDark;
                  var root = document.documentElement;
                  if (isDark) root.classList.add('dark');
                  else root.classList.remove('dark');

                  var varsRaw = localStorage.getItem('sf_theme_vars_v1');
                  if (varsRaw) {
                    var vars = JSON.parse(varsRaw);
                    if (vars && typeof vars === 'object') {
                      for (var key in vars) {
                        if (!Object.prototype.hasOwnProperty.call(vars, key)) continue;
                        if (typeof key !== 'string' || key.indexOf('--sf-') !== 0) continue;
                        var value = vars[key];
                        if (typeof value !== 'string') continue;
                        root.style.setProperty(key, value);
                      }
                    }
                  }
                } catch (e) {}
              })();
            `,
          }}
        />
        <script
          defer
          src="https://cloud.umami.is/script.js"
          data-website-id="5e299e26-ebfa-4417-b38b-2ab766409ac4"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
