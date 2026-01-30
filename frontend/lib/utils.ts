import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * plainTextFromMarkdown
 * 将短文本中的常见 Markdown 语法尽量转为纯文本，用于列表/卡片等轻量展示场景。
 */
export function plainTextFromMarkdown(input: string): string {
  const raw = (input ?? '').toString();
  if (!raw) return '';

  let text = raw.replace(/\r\n/g, '\n');

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/`([^`]+)`/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/\*([^*]+)\*/g, '$1');
  text = text.replace(/_([^_]+)_/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');
  text = text.replace(/^\s{0,3}(#{1,6}\s+)/gm, '');
  text = text.replace(/^\s{0,3}>\s?/gm, '');
  text = text.replace(/^\s{0,3}([-*+]\s+)/gm, '');
  text = text.replace(/^\s{0,3}(\d+\.\s+)/gm, '');

  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/**
 * isKnownRemoteImageUrl
 * 判断是否为允许交给 next/image 优化的远程图片地址（白名单域名）。
 */
export function isKnownRemoteImageUrl(url: string | null | undefined): boolean {
  const raw = (url || '').trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'lh3.googleusercontent.com') return true;
    if (host === 'avatars.githubusercontent.com') return true;
    if (host === 'api.dicebear.com') return true;
    if (host.endsWith('.supabase.co')) return true;
    return false;
  } catch {
    return false;
  }
}

export function getPublicDirectBackendApiUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_DIRECT_BACKEND_API_URL || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\/+$/, '');
  if (!normalized) return null;
  if (normalized.endsWith('/api')) return normalized;
  return `${normalized}/api`;
}
