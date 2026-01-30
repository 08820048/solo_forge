import { NextRequest, NextResponse } from 'next/server';
import { getAdminEmailAllowlist, requireUser } from '../admin/_auth';
import { getDirectBackendApiUrl } from '@/lib/backend-api';

function getBackendApiUrl(): string {
  const raw = (process.env.BACKEND_API_URL || 'http://localhost:8080/api').trim();
  const normalized = raw.replace(/\/+$/, '');
  if (!normalized) return 'http://localhost:8080/api';
  if (normalized.endsWith('/api')) return normalized;
  return `${normalized}/api`;
}

const BACKEND_API_URL = getBackendApiUrl();

function getForwardUserAgent(request: NextRequest): string {
  return request.headers.get('User-Agent') || request.headers.get('user-agent') || 'Mozilla/5.0';
}

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * getLangFromRequest
 * 从请求头读取 Accept-Language，用于后端提示信息本地化。
 */
function getLangFromRequest(request: NextRequest): string {
  return request.headers.get('Accept-Language') || 'en';
}

/**
 * getBackendUnavailableMessage
 * 统一生成“后端不可用”的用户可读错误信息。
 */
function getBackendUnavailableMessage(lang: string): string {
  if (lang.toLowerCase().startsWith('zh')) {
    return '后端服务不可用：请确认已启动 backend（默认 http://localhost:8080），或在 frontend/.env.local 配置 BACKEND_API_URL。';
  }
  return 'Backend is unavailable. Start the backend (default http://localhost:8080) or set BACKEND_API_URL in frontend/.env.local.';
}

/**
 * fetchWithTimeout
 * 包装 fetch，避免后端不可用时请求挂起过久导致前端体验不佳。
 */
async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = 6000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * readJsonSafe
 * 安全解析 Response body 为 JSON；非 JSON 或空 body 时返回 null。
 */
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
 * isSameEmail
 * 规范化邮箱并进行大小写不敏感比较。
 */
function isSameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = String(a || '').trim().toLowerCase();
  const y = String(b || '').trim().toLowerCase();
  return Boolean(x) && x === y;
}

/**
 * requireOwnerOrAdmin
 * 校验当前 bearer token 对应用户是否为产品所有者或管理员。
 */
async function requireOwnerOrAdmin(request: NextRequest, productId: string, lang: string) {
  const user = await requireUser(request);
  const allowlist = getAdminEmailAllowlist();
  if (allowlist.length > 0 && allowlist.includes(user.email)) return { user, ownerEmail: user.email, admin: true };

  const backendUrl = `${BACKEND_API_URL}/products/${encodeURIComponent(productId)}`;
  let res = await fetchWithTimeout(backendUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'Accept-Language': lang,
      'User-Agent': getForwardUserAgent(request),
      Authorization: request.headers.get('Authorization') || '',
    },
    cache: 'no-store',
  });
  if (res.status === 403) {
    const directBase = getDirectBackendApiUrl(request);
    if (directBase) {
      const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
      res = await fetchWithTimeout(directUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Accept-Language': lang,
          'User-Agent': getForwardUserAgent(request),
          Authorization: request.headers.get('Authorization') || '',
        },
        cache: 'no-store',
      });
    }
  }
  const json = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(res);
  if (res.status === 404) {
    return { user, ownerEmail: null as string | null, admin: false, notFound: true as const };
  }
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || 'Failed to fetch product');
  }
  const data = json.data as { maker_email?: unknown } | null;
  const ownerEmail = typeof data?.maker_email === 'string' ? data.maker_email : null;
  if (!ownerEmail || !isSameEmail(ownerEmail, user.email)) {
    const err = new Error('Forbidden');
    (err as { code?: string }).code = 'FORBIDDEN';
    throw err;
  }
  return { user, ownerEmail, admin: false };
}

export async function POST(request: NextRequest) {
  const lang = getLangFromRequest(request);
  try {
    const body = await request.json();

    const backendUrl = `${BACKEND_API_URL}/products`;
    const bodyJson = JSON.stringify(body);
    let response = await fetchWithTimeout(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
      },
      body: bodyJson,
      cache: 'no-store',
    });
    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetchWithTimeout(directUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Language': lang,
            'User-Agent': getForwardUserAgent(request),
          },
          body: bodyJson,
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to submit product' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error submitting product:', error);
    return NextResponse.json(
      { success: false, message: getBackendUnavailableMessage(lang) },
      { status: 502 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const lang = getLangFromRequest(request);
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ success: false, message: 'Missing id' }, { status: 400 });
    }

    const auth = await requireOwnerOrAdmin(request, id, lang);
    if ((auth as { notFound?: boolean }).notFound) {
      return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    }

    const body = await request.json();
    const backendUrl = `${BACKEND_API_URL}/products/${encodeURIComponent(id)}`;
    const bodyJson = JSON.stringify(body);
    let response = await fetchWithTimeout(backendUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
      },
      body: bodyJson,
      cache: 'no-store',
    });
    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetchWithTimeout(directUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Language': lang,
            'User-Agent': getForwardUserAgent(request),
          },
          body: bodyJson,
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to update product' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null;
    if (code === 'FORBIDDEN') {
      return NextResponse.json(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '无权限更新该产品。' : 'Forbidden' },
        { status: 403 }
      );
    }
    const msg = error && typeof error === 'object' && 'message' in error ? (error as { message?: unknown }).message : null;
    if (typeof msg === 'string' && msg.includes('Missing Authorization bearer token')) {
      return NextResponse.json(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '请先登录后再更新产品。' : 'Unauthorized' },
        { status: 401 }
      );
    }
    console.error('Error updating product:', error);
    return NextResponse.json(
      { success: false, message: getBackendUnavailableMessage(lang) },
      { status: 502 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const lang = getLangFromRequest(request);
  try {
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ success: false, message: 'Missing id' }, { status: 400 });
    }

    const auth = await requireOwnerOrAdmin(request, id, lang);
    if ((auth as { notFound?: boolean }).notFound) {
      return NextResponse.json({ success: false, message: 'Product not found' }, { status: 404 });
    }

    const backendUrl = `${BACKEND_API_URL}/products/${encodeURIComponent(id)}`;
    let response = await fetchWithTimeout(backendUrl, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
      },
      cache: 'no-store',
    });
    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetchWithTimeout(directUrl, {
          method: 'DELETE',
          headers: {
            Accept: 'application/json',
            'Accept-Language': lang,
            'User-Agent': getForwardUserAgent(request),
          },
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to delete product' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? (error as { code?: unknown }).code : null;
    if (code === 'FORBIDDEN') {
      return NextResponse.json(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '无权限删除该产品。' : 'Forbidden' },
        { status: 403 }
      );
    }
    const msg = error && typeof error === 'object' && 'message' in error ? (error as { message?: unknown }).message : null;
    if (typeof msg === 'string' && msg.includes('Missing Authorization bearer token')) {
      return NextResponse.json(
        { success: false, message: lang.toLowerCase().startsWith('zh') ? '请先登录后再删除产品。' : 'Unauthorized' },
        { status: 401 }
      );
    }
    console.error('Error deleting product:', error);
    return NextResponse.json(
      { success: false, message: getBackendUnavailableMessage(lang) },
      { status: 502 }
    );
  }
}

export async function GET(request: NextRequest) {
  const lang = getLangFromRequest(request);
  try {
    const { searchParams } = new URL(request.url);

    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const backendUrl = `${BACKEND_API_URL}/products?${params.toString()}`;
    let response = await fetchWithTimeout(backendUrl, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
      },
      cache: 'no-store',
    });
    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetchWithTimeout(directUrl, {
          headers: {
            Accept: 'application/json',
            'Accept-Language': lang,
            'User-Agent': getForwardUserAgent(request),
          },
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to fetch products' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { success: false, message: getBackendUnavailableMessage(lang) },
      { status: 502 }
    );
  }
}
