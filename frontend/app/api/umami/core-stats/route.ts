import { NextRequest, NextResponse } from 'next/server';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type UmamiCoreStats = {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
  comparison?: {
    pageviews: number;
    visitors: number;
    visits: number;
    bounces: number;
    totaltime: number;
  } | null;
};

/**
 * getUmamiBaseUrl
 * 读取并规范化 Umami 服务地址，确保不以 / 结尾。
 */
function getUmamiBaseUrl(): string | null {
  const raw = (process.env.UMAMI_BASE_URL || '').trim();
  const normalized = raw.replace(/\/+$/, '');
  return normalized ? normalized : null;
}

/**
 * buildUmamiApiUrl
 * 根据不同部署形态拼接 Umami API 地址：
 * - Umami Cloud: baseUrl 通常为 https://api.umami.is/v1（不带 /api 前缀）
 * - 自托管 Umami: baseUrl 通常为 https://yourserver（API 前缀为 /api）
 */
function buildUmamiApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = `/${String(path || '').replace(/^\/+/, '')}`;
  if (baseUrl.endsWith('/v1') || baseUrl.includes('api.umami.is/v1')) {
    return `${baseUrl}${normalizedPath}`;
  }
  return `${baseUrl}/api${normalizedPath}`;
}

/**
 * getUmamiWebsiteId
 * 读取 Umami 站点 ID（Website ID）。
 */
function getUmamiWebsiteId(): string | null {
  const raw = (process.env.UMAMI_WEBSITE_ID || '').trim();
  return raw ? raw : null;
}

/**
 * getUmamiStaticAuth
 * 读取固定认证信息（支持 UMAMI_TOKEN / UMAMI_API_KEY）。
 */
function getUmamiStaticAuth(): { type: 'bearer' | 'apiKey'; value: string } | null {
  const bearer = (process.env.UMAMI_TOKEN || '').trim();
  if (bearer) return { type: 'bearer', value: bearer };
  const apiKey = (process.env.UMAMI_API_KEY || '').trim();
  if (apiKey) return { type: 'apiKey', value: apiKey };
  return null;
}

/**
 * getUmamiLoginCredential
 * 读取 Umami 登录凭证（用于换取 API Token）。
 */
function getUmamiLoginCredential(): { username: string; password: string } | null {
  const username = (process.env.UMAMI_USERNAME || '').trim();
  const password = (process.env.UMAMI_PASSWORD || '').trim();
  if (!username || !password) return null;
  return { username, password };
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

/**
 * resolveRangeDays
 * 将 range 参数解析为天数（默认 30 天）。
 */
function resolveRangeDays(range: string | null): number {
  const r = (range || '').trim().toLowerCase();
  if (r === '24h' || r === '1d') return 1;
  if (r === '7d') return 7;
  if (r === '30d') return 30;
  const asNumber = Number(r.replace(/[^0-9.]/g, ''));
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.min(365, Math.max(1, Math.floor(asNumber)));
  return 30;
}

/**
 * getUmamiAuthToken
 * 获取 Umami 认证信息（优先固定 Token/API Key，缺失则尝试登录换取 Token）。
 */
async function getUmamiAuth(baseUrl: string): Promise<{ type: 'bearer' | 'apiKey'; value: string } | null> {
  const staticAuth = getUmamiStaticAuth();
  if (staticAuth) return staticAuth;

  const credential = getUmamiLoginCredential();
  if (!credential) return null;

  const response = await fetch(buildUmamiApiUrl(baseUrl, '/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username: credential.username, password: credential.password }),
    cache: 'no-store',
  });

  const json = await readJsonSafe<
    | { token?: unknown }
    | { data?: { token?: unknown } }
    | { authToken?: unknown }
    | { jwt?: unknown }
    | null
  >(response);

  if (!response.ok || !json) return null;

  const token =
    (typeof (json as { token?: unknown }).token === 'string' && (json as { token?: string }).token) ||
    (typeof (json as { authToken?: unknown }).authToken === 'string' && (json as { authToken?: string }).authToken) ||
    (typeof (json as { jwt?: unknown }).jwt === 'string' && (json as { jwt?: string }).jwt) ||
    (typeof (json as { data?: { token?: unknown } }).data?.token === 'string' && (json as { data?: { token?: string } }).data?.token) ||
    null;

  const trimmed = token ? token.trim() : '';
  return trimmed ? { type: 'bearer', value: trimmed } : null;
}

/**
 * pickStatValue
 * 从 Umami 统计字段中提取 value 数值。
 */
function pickStatValue(raw: unknown): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'object' && raw && 'value' in raw) {
    const v = (raw as { value?: unknown }).value;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

export async function GET(request: NextRequest) {
  try {
    const baseUrl = getUmamiBaseUrl();
    const websiteId = getUmamiWebsiteId();
    if (!baseUrl || !websiteId) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: 'Umami 未配置（缺少 UMAMI_BASE_URL / UMAMI_WEBSITE_ID）。' },
        { status: 503 }
      );
    }

    const auth = await getUmamiAuth(baseUrl);
    if (!auth) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: 'Umami 认证失败（缺少 Token 或登录凭证）。' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const rangeDays = resolveRangeDays(searchParams.get('range'));
    const endAt = Date.now();
    const startAt = endAt - rangeDays * 24 * 60 * 60 * 1000;

    const url = new URL(buildUmamiApiUrl(baseUrl, `/websites/${websiteId}/stats`));
    url.searchParams.set('startAt', String(startAt));
    url.searchParams.set('endAt', String(endAt));
    url.searchParams.set('compare', 'true');

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth.type === 'apiKey') headers['x-umami-api-key'] = auth.value;
    else headers.Authorization = `Bearer ${auth.value}`;

    const response = await fetch(url.toString(), {
      headers: {
        ...headers,
      },
      cache: 'no-store',
    });

    const json = await readJsonSafe<Record<string, unknown> | null>(response);
    if (!response.ok || !json) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: `获取 Umami 统计失败（${response.status}）。` },
        { status: response.status || 502 }
      );
    }

    const pageviews = pickStatValue(json.pageviews);
    const visitors = pickStatValue(json.visitors ?? json.uniques);
    const visits = pickStatValue(json.visits);
    const bounces = pickStatValue(json.bounces);
    const totaltime = pickStatValue(json.totaltime);
    const comparisonRaw = (json.comparison || null) as Record<string, unknown> | null;
    const comparison = comparisonRaw
      ? {
          pageviews: pickStatValue(comparisonRaw.pageviews),
          visitors: pickStatValue(comparisonRaw.visitors ?? comparisonRaw.uniques),
          visits: pickStatValue(comparisonRaw.visits),
          bounces: pickStatValue(comparisonRaw.bounces),
          totaltime: pickStatValue(comparisonRaw.totaltime),
        }
      : null;

    return NextResponse.json<ApiResponse<UmamiCoreStats>>({
      success: true,
      data: { pageviews, visitors, visits, bounces, totaltime, comparison },
    });
  } catch {
    return NextResponse.json<ApiResponse<null>>({ success: false, message: '网络错误，请稍后重试。' }, { status: 500 });
  }
}
