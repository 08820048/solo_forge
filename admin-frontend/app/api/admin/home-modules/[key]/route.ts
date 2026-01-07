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
 * 读取指定 home_module_state（后端：admin_get_home_module_state）。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  try {
    await requireAdmin(request);

    const { key } = await context.params;
    const moduleKey = String(key || '').trim();
    if (!moduleKey) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid key' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/home-modules/${encodeURIComponent(moduleKey)}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });

    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch home module state' },
        { status: response.status || 502 }
      );
    }
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}

/**
 * PUT
 * 更新指定 home_module_state（后端：admin_put_home_module_state）。
 */
export async function PUT(request: NextRequest, context: { params: Promise<{ key: string }> }) {
  try {
    await requireAdmin(request);

    const { key } = await context.params;
    const moduleKey = String(key || '').trim();
    if (!moduleKey) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid key' }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as { mode?: string | null; today_ids?: unknown } | null;
    const todayIds = Array.isArray(body?.today_ids) ? body?.today_ids : null;
    if (!todayIds) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid today_ids' }, { status: 400 });
    }

    const payload = {
      mode: body?.mode ?? 'manual',
      today_ids: todayIds,
    };

    const response = await fetch(`${BACKEND_API_URL}/admin/home-modules/${encodeURIComponent(moduleKey)}`, {
      method: 'PUT',
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'Content-Type': 'application/json',
        'x-admin-token': getBackendAdminToken(),
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });

    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to update home module state' },
        { status: response.status || 502 }
      );
    }
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}
