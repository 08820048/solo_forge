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

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="#000"/><text x="32" y="41" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-size="32" font-weight="700" fill="#fff">S</text></svg>`;
const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconSvg)}`;

export const metadata: Metadata = {
  title: "SoloForge Admin",
  description: "SoloForge 管理后台",
  icons: {
    icon: faviconUrl,
    apple: faviconUrl,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-full bg-background text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
