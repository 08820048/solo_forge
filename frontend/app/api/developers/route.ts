import { NextRequest, NextResponse } from 'next/server';
import { getDirectBackendApiUrl } from '@/lib/backend-api';

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

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

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
    const email = (searchParams.get('email') || '').trim();
    const kind = (searchParams.get('kind') || '').toLowerCase();
    const limit = searchParams.get('limit');

    if (email) {
      if (kind === 'center_stats') {
        const backendUrl = `${BACKEND_API_URL}/developers/${encodeURIComponent(email)}/center-stats`;
        let response = await fetch(backendUrl, {
          headers: {
            Accept: 'application/json',
            'Accept-Language': request.headers.get('Accept-Language') || 'en',
            'User-Agent': getForwardUserAgent(request),
          },
          cache: 'no-store',
        });

        if (response.status === 403) {
          const directBase = getDirectBackendApiUrl(request);
          if (directBase) {
            const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
            response = await fetch(directUrl, {
              headers: {
                Accept: 'application/json',
                'Accept-Language': request.headers.get('Accept-Language') || 'en',
                'User-Agent': getForwardUserAgent(request),
              },
              cache: 'no-store',
            });
          }
        }

        const data = await readJsonSafe<ApiResponse<unknown>>(response);
        if (!response.ok) {
          return NextResponse.json(
            { success: false, message: data?.message || 'Failed to fetch developer stats' },
            { status: response.status }
          );
        }

        if (!data) {
          return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
        }

        return NextResponse.json(data);
      }

      const backendUrl = `${BACKEND_API_URL}/developers/${encodeURIComponent(email)}`;
      let response = await fetch(backendUrl, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': request.headers.get('Accept-Language') || 'en',
          'User-Agent': getForwardUserAgent(request),
        },
        cache: 'no-store',
      });

      if (response.status === 403) {
        const directBase = getDirectBackendApiUrl(request);
        if (directBase) {
          const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
          response = await fetch(directUrl, {
            headers: {
              Accept: 'application/json',
              'Accept-Language': request.headers.get('Accept-Language') || 'en',
              'User-Agent': getForwardUserAgent(request),
            },
            cache: 'no-store',
          });
        }
      }

      const data = await readJsonSafe<ApiResponse<unknown>>(response);
      if (!response.ok) {
        return NextResponse.json(
          { success: false, message: data?.message || 'Failed to fetch developer' },
          { status: response.status }
        );
      }

      if (!data) {
        return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
      }

      return NextResponse.json(data);
    }

    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);

    const path =
      kind === 'popularity_last_week'
        ? '/developers/popularity-last-week'
        : kind === 'popularity_last_month'
        ? '/developers/popularity-last-month'
        : kind === 'recent'
          ? '/developers/recent'
        : '/developers/top';

    const backendUrl = `${BACKEND_API_URL}${path}?${params.toString()}`;
    let response = await fetch(backendUrl, {
      headers: {
        Accept: 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
        'User-Agent': getForwardUserAgent(request),
      },
      cache: 'no-store',
    });

    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetch(directUrl, {
          headers: {
            Accept: 'application/json',
            'Accept-Language': request.headers.get('Accept-Language') || 'en',
            'User-Agent': getForwardUserAgent(request),
          },
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to fetch developers' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching developers:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { action?: string; email?: string; user_id?: string };
    const action = (body.action || '').toLowerCase();
    const email = (body.email || '').trim();
    const userId = (body.user_id || '').trim();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Missing email' }, { status: 400 });
    }
    if (!userId || userId.toLowerCase().startsWith('anon_')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    if (email.toLowerCase() === userId.toLowerCase()) {
      return NextResponse.json({ success: false, message: 'Cannot follow yourself' }, { status: 400 });
    }

    const subPath = action === 'unfollow' ? 'unfollow' : 'follow';
    const backendUrl = `${BACKEND_API_URL}/developers/${encodeURIComponent(email)}/${subPath}`;
    let response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
        'User-Agent': getForwardUserAgent(request),
      },
      body: JSON.stringify({ user_id: userId }),
      cache: 'no-store',
    });

    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetch(directUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Language': request.headers.get('Accept-Language') || 'en',
            'User-Agent': getForwardUserAgent(request),
          },
          body: JSON.stringify({ user_id: userId }),
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to update follow state' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating follow state:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      email?: string;
      user_id?: string;
      name?: string | null;
      avatar_url?: string | null;
      website?: string | null;
    };

    const email = (body.email || '').trim();
    const userId = (body.user_id || '').trim();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Missing email' }, { status: 400 });
    }
    if (!userId || userId.toLowerCase().startsWith('anon_')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const payload: Record<string, unknown> = { user_id: userId };
    if (typeof body.name !== 'undefined') payload.name = body.name;
    if (typeof body.avatar_url !== 'undefined') payload.avatar_url = body.avatar_url;
    if (typeof body.website !== 'undefined') payload.website = body.website;

    const backendUrl = `${BACKEND_API_URL}/developers/${encodeURIComponent(email)}`;
    let response = await fetch(backendUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
        'User-Agent': getForwardUserAgent(request),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    if (response.status === 403) {
      const directBase = getDirectBackendApiUrl(request);
      if (directBase) {
        const directUrl = backendUrl.replace(BACKEND_API_URL, directBase);
        response = await fetch(directUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'Accept-Language': request.headers.get('Accept-Language') || 'en',
            'User-Agent': getForwardUserAgent(request),
          },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
      }
    }

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to update developer profile' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating developer profile:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}
