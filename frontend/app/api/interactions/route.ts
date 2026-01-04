import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      product_id?: string;
      user_id?: string;
    };

    const action = (body.action || '').toLowerCase();
    const productId = (body.product_id || '').trim();

    if (!productId) {
      return NextResponse.json({ success: false, message: 'Missing product_id' }, { status: 400 });
    }

    const subPath =
      action === 'unlike'
        ? 'unlike'
        : action === 'favorite'
          ? 'favorite'
          : action === 'unfavorite'
            ? 'unfavorite'
            : 'like';

    const response = await fetch(`${BACKEND_API_URL}/products/${encodeURIComponent(productId)}/${subPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      body: JSON.stringify({ user_id: body.user_id }),
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to update interaction' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating interaction:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}
