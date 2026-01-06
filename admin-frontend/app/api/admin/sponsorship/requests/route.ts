import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

/**
 * readJsonSafe
 * 尝试解析后端响应 JSON；遇到空响应或非 JSON 时返回 null。
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
 * getBackendAdminToken
 * 读取并校验 BACKEND_ADMIN_TOKEN，用于调用 Rust 后端的 /admin/* 接口。
 */
function getBackendAdminToken() {
  const token = BACKEND_ADMIN_TOKEN;
  if (!token) throw new Error('Missing BACKEND_ADMIN_TOKEN');
  return token;
}

/**
 * GET
 * 获取赞助请求列表（后端：admin_list_sponsorship_requests）。
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const response = await fetch(`${BACKEND_API_URL}/admin/sponsorship/requests?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !data?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: data?.message || 'Failed to fetch sponsorship requests' },
        { status: response.status || 502 }
      );
    }
    if (!data) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}

/**
 * POST
 * 对赞助请求执行动作（process/reject）（后端：admin_sponsorship_request_action）。
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing body' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/sponsorship/requests/action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !data?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: data?.message || 'Failed to process sponsorship request' },
        { status: response.status || 502 }
      );
    }
    if (!data) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}
