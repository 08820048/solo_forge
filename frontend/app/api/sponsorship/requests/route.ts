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

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * handlePost
 * 处理前台赞助登记请求，将数据转发到后端写入 sponsorship_requests。
 */
async function handlePost(request: NextRequest) {
  const lang = request.headers.get('Accept-Language') || 'en';

  const body = (await request.json().catch(() => null)) as
    | {
        email?: string;
        product?: string;
        placement?: string;
        duration_days?: number;
        note?: string | null;
        top_side?: 'left' | 'right';
        slot_index?: number;
      }
    | null;

  const email = (body?.email || '').trim();
  const productRef = (body?.product || '').trim();
  const placement = (body?.placement || '').trim();
  const durationDays = Number(body?.duration_days || 0);

  if (!email || !productRef || !placement || !durationDays || durationDays <= 0) {
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        message:
          lang.startsWith('zh') ?
            '缺少必填字段（邮箱 / 产品 / 展示位置 / 展示时长）。'
          : 'Missing required fields (email / product / placement / duration).',
      },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    email,
    product_ref: productRef,
    placement,
    duration_days: durationDays,
    note: (body?.note || '').trim() || null,
  };

  if (typeof body?.slot_index === 'number') {
    payload.slot_index = body.slot_index;
  } else if (placement === 'home_top' && body?.top_side) {
    payload.slot_index = body.top_side === 'right' ? 1 : 0;
  }

  try {
    const backendUrl = `${BACKEND_API_URL}/sponsorship/requests`;
    const bodyJson = JSON.stringify(payload);
    let response = await fetch(backendUrl, {
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
        response = await fetch(directUrl, {
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

    const text = await response.text();
    let data: ApiResponse<unknown> | null = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as ApiResponse<unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok || !data?.success) {
      return NextResponse.json<ApiResponse<null>>(
        {
          success: false,
          message:
            data?.message ||
            (lang.startsWith('zh') ? '提交赞助信息失败，请稍后重试。' : 'Failed to submit sponsorship request.'),
        },
        { status: response.status || 502 }
      );
    }

    return NextResponse.json<ApiResponse<null>>(
      {
        success: true,
        message:
          data.message ||
          (lang.startsWith('zh') ? '赞助信息已提交，我们会尽快处理。' : 'Sponsorship request submitted successfully.'),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error submitting sponsorship request:', error);
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        message: lang.startsWith('zh') ? '网络错误，请稍后重试。' : 'Network error. Please try again later.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handlePost(request);
}
