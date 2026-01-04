import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => {
      params.append(key, value);
    });

    const response = await fetch(`${BACKEND_API_URL}/search?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      cache: 'no-store',
    });

    const text = await response.text();
    let data: ApiResponse<unknown> | null = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text) as ApiResponse<unknown>;
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || `Failed to search (${response.status})` },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error searching:', error);
    return NextResponse.json(
      { success: false, message: 'Network error. Please try again later.' },
      { status: 500 }
    );
  }
}
