import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type Category = {
  id: string;
  name_en: string;
  name_zh: string;
  icon: string;
  color: string;
};

async function readJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function getBackendAdminToken() {
  const token = BACKEND_ADMIN_TOKEN;
  if (!token) throw new Error('Missing BACKEND_ADMIN_TOKEN');
  return token;
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const response = await fetch(`${BACKEND_API_URL}/admin/categories`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<Category[]>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch categories' },
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

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = (await request.json().catch(() => null)) as { categories?: Category[] } | null;
    const categories = Array.isArray(body?.categories) ? body?.categories : null;
    if (!categories) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing categories' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/categories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      body: JSON.stringify({ categories }),
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to upsert categories' },
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

