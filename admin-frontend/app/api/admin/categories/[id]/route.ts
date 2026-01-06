import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

function getBackendAdminToken() {
  const token = BACKEND_ADMIN_TOKEN;
  if (!token) throw new Error('Missing BACKEND_ADMIN_TOKEN');
  return token;
}

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request);
    const { id } = await ctx.params;
    const categoryId = String(id || '').trim();
    if (!categoryId) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing id' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/categories/${encodeURIComponent(categoryId)}`, {
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
        { success: false, message: json?.message || 'Failed to delete category' },
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

