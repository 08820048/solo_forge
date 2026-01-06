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
 * 查询赞助队列（后端：admin_list_sponsorship_grants）。
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => params.append(key, value));

    const response = await fetch(`${BACKEND_API_URL}/admin/sponsorship/grants?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });

    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch sponsorship grants' },
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
 * DELETE
 * 删除赞助记录（后端：admin_delete_sponsorship_grant）。
 */
export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const idRaw = String(searchParams.get('id') || '').trim();
    const id = Number.parseInt(idRaw, 10);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid id' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/sponsorship/grants?id=${encodeURIComponent(String(id))}`, {
      method: 'DELETE',
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });

    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to delete sponsorship grant' },
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
