import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type SupabaseAuthStorage = 'local' | 'session';

let localClient: SupabaseClient | null = null;
let sessionClient: SupabaseClient | null = null;

const AUTH_STORAGE_KEY = 'sf_auth_storage';

/**
 * setSupabaseAuthStoragePreference
 * 保存“记住我”对应的认证存储偏好：local(记住) / session(不记住)。
 */
export function setSupabaseAuthStoragePreference(storage: SupabaseAuthStorage) {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTH_STORAGE_KEY, storage);
  } catch {}
}

/**
 * getSupabaseAuthStoragePreference
 * 读取认证存储偏好：local(记住) / session(不记住)。
 */
export function getSupabaseAuthStoragePreference(): SupabaseAuthStorage {
  try {
    if (typeof window === 'undefined') return 'local';
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
    return raw === 'session' ? 'session' : 'local';
  } catch {
    return 'local';
  }
}

/**
 * getSupabaseBrowserClient
 * 获取 Supabase 浏览器端 client；支持 localStorage / sessionStorage 两种会话持久化策略。
 */
export function getSupabaseBrowserClient(options?: { storage?: SupabaseAuthStorage }) {
  const storage = options?.storage ?? 'local';
  const cached = storage === 'session' ? sessionClient : localClient;
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const key = anonKey || publishableKey;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  }

  if (typeof window === 'undefined') {
    throw new Error('getSupabaseBrowserClient must be called in the browser');
  }

  const nextClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: storage === 'session' ? window.sessionStorage : window.localStorage,
    },
  });

  if (storage === 'session') sessionClient = nextClient;
  else localClient = nextClient;

  return nextClient;
}
