import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

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
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const response = await fetch(`${BACKEND_API_URL}/home/sponsored-top?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      cache: 'no-store',
    });

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to fetch sponsored products' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching sponsored products:', error);
    return NextResponse.json({ success: false, message: 'Network error. Please try again later.' }, { status: 500 });
  }
}

