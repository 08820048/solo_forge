import { NextRequest, NextResponse } from 'next/server';
import { getAdminEmailAllowlist, requireUser } from '../../admin/_auth';

/**
 * getBackendApiUrl
 * 读取并规范化后端 API 基地址，确保以 /api 结尾。
 */
function getBackendApiUrl(): string {
  const raw = (process.env.BACKEND_API_URL || 'http://localhost:8080/api').trim();
  const normalized = raw.replace(/\/+$/, '');
  if (!normalized) return 'http://localhost:8080/api';
  if (normalized.endsWith('/api')) return normalized;
  return `${normalized}/api`;
}

const BACKEND_API_URL = getBackendApiUrl();
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

type ApiError = {
  code: string;
  trace_id: string;
  degraded: boolean;
  hint?: string | null;
  detail?: string | null;
};

type ApiResponse<T> = { success: boolean; data?: T; message?: string; error?: ApiError | null };

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * getForwardUserAgent
 * 将浏览器侧 User-Agent 透传给后端，降低代理请求被风控拦截的概率。
 */
function getForwardUserAgent(request: NextRequest): string {
  return request.headers.get('User-Agent') || request.headers.get('user-agent') || 'Mozilla/5.0';
}

/**
 * getDirectBackendApiUrl
 * 生产环境下为浏览器提供直连后端的兜底地址（用于绕过上游代理被拦截的情况）。
 */
function getDirectBackendApiUrl(request: NextRequest): string | null {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (!host) return null;
  if (host.includes('localhost') || host.includes('127.0.0.1')) return null;
  return 'https://api.soloforge.dev/api';
}

function getLangFromRequest(request: NextRequest): string {
  return request.headers.get('Accept-Language') || 'en';
}

function getBackendUnavailableMessage(lang: string): string {
  if (lang.toLowerCase().startsWith('zh')) {
    return '后端服务不可用：请确认已启动 backend（默认 http://localhost:8080），或在 frontend/.env.local 配置 BACKEND_API_URL。';
  }
  return 'Backend is unavailable. Start the backend (default http://localhost:8080) or set BACKEND_API_URL in frontend/.env.local.';
}

function isSameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  return Boolean(x) && x === y;
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const lang = getLangFromRequest(request);
  const awaited = await params;
  const id = String(awaited?.id || '').trim();
  if (!id) {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing id' }, { status: 400 });
  }

  try {
    const user = await requireUser(request);
    const allowlist = getAdminEmailAllowlist();
    const isAdmin = allowlist.length > 0 && allowlist.includes(user.email);

    const backendUrl = `${BACKEND_API_URL}/products/${encodeURIComponent(id)}`;
    let response = await fetchWithTimeout(backendUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
        ...(BACKEND_ADMIN_TOKEN ? { 'x-admin-token': BACKEND_ADMIN_TOKEN } : {}),
      },
      cache: 'no-store',
    });

    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetchWithTimeout(directUrl, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Accept-Language': lang,
            'User-Agent': getForwardUserAgent(request),
            ...(BACKEND_ADMIN_TOKEN ? { 'x-admin-token': BACKEND_ADMIN_TOKEN } : {}),
          },
          cache: 'no-store',
        });
      }
    }

    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (response.status === 404) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '未找到该产品。' : 'Product not found' },
        { status: 404 }
      );
    }
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || `Failed to fetch product (${response.status})` },
        { status: response.status }
      );
    }

    const data = json.data as { maker_email?: unknown } | null;
    const ownerEmail = typeof data?.maker_email === 'string' ? data.maker_email : null;
    if (!isAdmin && !isSameEmail(ownerEmail, user.email)) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '无权限查看该产品。' : 'Forbidden' },
        { status: 403 }
      );
    }

    return NextResponse.json<ApiResponse<unknown>>({ success: true, data: json.data });
  } catch (error) {
    const msg = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message) : '';
    if (msg.includes('Missing Authorization bearer token') || msg.includes('Invalid session')) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '请先登录后再查看产品详情。' : 'Unauthorized' },
        { status: 401 }
      );
    }

    console.error('Error fetching product (private):', error);
    return NextResponse.json<ApiResponse<null>>({ success: false, message: getBackendUnavailableMessage(lang) }, { status: 502 });
  }
}
