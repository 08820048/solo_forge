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
 * 创建 Creem 赞助支付：将请求转发到后端 /api/sponsorship/checkout，返回 checkout_url。
 */
async function handlePost(request: NextRequest) {
  const lang = request.headers.get('Accept-Language') || 'en';

  const authorization = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  if (!authorization.trim()) {
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: lang.startsWith('zh') ? '请先登录后再发起支付。' : 'Please sign in first.' },
      { status: 401 }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        product_ref?: string;
        placement?: string;
        slot_index?: number | null;
        months?: number;
        note?: string | null;
        plan_id?: string | null;
        plan_key?: string | null;
      }
    | null;

  const productRef = String(body?.product_ref || '').trim();
  const placement = String(body?.placement || '').trim();
  const months = Number(body?.months || 0);
  const note = (body?.note || '').toString().trim();
  const slotIndexRaw = body?.slot_index;
  const slotIndex = typeof slotIndexRaw === 'number' ? slotIndexRaw : null;
  const planId = String(body?.plan_id || '').trim();
  const planKey = String(body?.plan_key || '').trim();

  if (!productRef || !placement || !months || months <= 0) {
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        message: lang.startsWith('zh') ? '缺少必填字段（产品 / 展示位置 / 购买月数）。' : 'Missing required fields.',
      },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    product_ref: productRef,
    placement,
    months,
    note: note || null,
  };
  if (slotIndex !== null) payload.slot_index = slotIndex;
  if (planId) payload.plan_id = planId;
  if (planKey) payload.plan_key = planKey;

  try {
    const backendUrl = `${BACKEND_API_URL}/sponsorship/checkout`;
    const bodyJson = JSON.stringify(payload);
    let response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Language': lang,
        'User-Agent': getForwardUserAgent(request),
        Authorization: authorization,
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
            Authorization: authorization,
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
            data?.message || (lang.startsWith('zh') ? '创建支付失败，请稍后重试。' : 'Failed to create checkout.'),
        },
        { status: response.status || 502 }
      );
    }

    return NextResponse.json<ApiResponse<unknown>>({ success: true, data: data.data }, { status: 200 });
  } catch {
    return NextResponse.json<ApiResponse<null>>(
      { success: false, message: lang.startsWith('zh') ? '网络错误，请稍后重试。' : 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handlePost(request);
}
