import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

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
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const response = await fetch(`${BACKEND_API_URL}/products?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: data?.message || 'Failed to fetch products' },
        { status: response.status }
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

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);

    const body = (await request.json().catch(() => null)) as
      | { id?: string; status?: string; rejection_reason?: string | null }
      | null;
    const id = String(body?.id || '').trim();
    const status = String(body?.status || '').trim().toLowerCase();
    const rejectionReason = body?.rejection_reason == null ? null : String(body.rejection_reason);

    if (!id) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing id' }, { status: 400 });
    }
    if (!status || !['pending', 'approved', 'rejected'].includes(status)) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Invalid status' }, { status: 400 });
    }
    if (status === 'rejected') {
      const v = String(rejectionReason ?? '').trim();
      if (!v) {
        return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing rejection_reason' }, { status: 400 });
      }
    }

    const response = await fetch(`${BACKEND_API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
      },
      body: JSON.stringify(
        status === 'rejected'
          ? { status, rejection_reason: String(rejectionReason ?? '').trim() }
          : { status }
      ),
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: data?.message || 'Failed to update product' },
        { status: response.status }
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

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing id' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: data?.message || 'Failed to delete product' },
        { status: response.status }
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
