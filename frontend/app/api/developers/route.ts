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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = (searchParams.get('kind') || '').toLowerCase();
    const limit = searchParams.get('limit');

    const params = new URLSearchParams();
    if (limit) params.set('limit', limit);

    const path =
      kind === 'popularity_last_month'
        ? '/developers/popularity-last-month'
        : kind === 'recent'
          ? '/developers/recent'
        : '/developers/top';

    const response = await fetch(`${BACKEND_API_URL}${path}?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to fetch developers' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching developers:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { action?: string; email?: string; user_id?: string };
    const action = (body.action || '').toLowerCase();
    const email = (body.email || '').trim();
    const userId = (body.user_id || '').trim();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Missing email' }, { status: 400 });
    }
    if (!userId || userId.toLowerCase().startsWith('anon_')) {
      return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }

    const subPath = action === 'unfollow' ? 'unfollow' : 'follow';
    const response = await fetch(`${BACKEND_API_URL}/developers/${encodeURIComponent(email)}/${subPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      body: JSON.stringify({ user_id: userId }),
      cache: 'no-store',
    });

    const data = await readJsonSafe<ApiResponse<unknown>>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to update follow state' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error updating follow state:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}
