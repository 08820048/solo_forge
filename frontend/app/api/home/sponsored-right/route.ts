import { NextRequest, NextResponse } from 'next/server';

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

/**
 * getForwardUserAgent
 * 将浏览器侧 User-Agent 透传给后端，降低代理请求被风控拦截的概率。
 */
function getForwardUserAgent(request: NextRequest): string {
  return request.headers.get('User-Agent') || request.headers.get('user-agent') || 'Mozilla/5.0';
}

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const response = await fetch(`${BACKEND_API_URL}/home/sponsored-right?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
        'User-Agent': getForwardUserAgent(request),
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to fetch sponsored products' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching sponsored products:', error);
    return NextResponse.json({ success: false, message: 'Network error. Please try again later.' }, { status: 500 });
  }
}
