import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

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

export async function POST(request: NextRequest) {
  const lang = getLangFromRequest(request);
  try {
    const body = await request.json();

    const response = await fetchWithTimeout(`${BACKEND_API_URL}/products`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': lang,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

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

    const body = await request.json();
    const response = await fetchWithTimeout(`${BACKEND_API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': lang,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

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

    const response = await fetchWithTimeout(`${BACKEND_API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Accept-Language': lang,
      },
      cache: 'no-store',
    });

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

    const response = await fetchWithTimeout(`${BACKEND_API_URL}/products?${params.toString()}`, {
      headers: {
        'Accept-Language': lang,
      },
      cache: 'no-store',
    });

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
