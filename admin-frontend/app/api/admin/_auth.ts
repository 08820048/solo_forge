import { createClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

type AdminUser = { email: string; userId: string };

export function getBearerToken(request: NextRequest): string | null {
  const raw = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const match = raw.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export function getAdminEmailAllowlist(): string[] {
  const raw = (process.env.ADMIN_EMAILS || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireUser(request: NextRequest): Promise<AdminUser> {
  const token = getBearerToken(request);
  if (!token) {
    throw new Error('Missing Authorization bearer token');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const key = anonKey || publishableKey;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error('Invalid session');
  }

  const email = (data.user.email || '').trim().toLowerCase();
  if (!email) {
    throw new Error('Invalid session');
  }

  return { email, userId: data.user.id };
}

export async function requireAdmin(request: NextRequest): Promise<AdminUser> {
  const allowlist = getAdminEmailAllowlist();
  if (allowlist.length === 0) {
    throw new Error('ADMIN_EMAILS is not configured');
  }

  const user = await requireUser(request);
  if (!allowlist.includes(user.email)) {
    throw new Error('Forbidden');
  }

  return user;
}

