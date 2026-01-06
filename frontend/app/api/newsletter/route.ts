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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    const email = (body?.email || '').trim();

    const response = await fetch(`${BACKEND_API_URL}/newsletter/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'en',
      },
      body: JSON.stringify({ email }),
    });

    const data = await readJsonSafe<{ success?: boolean; data?: unknown; message?: string }>(response);
    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: data?.message || 'Failed to subscribe' },
        { status: response.status }
      );
    }

    if (!data) {
      return NextResponse.json({ success: false, message: 'Invalid response from backend' }, { status: 502 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error subscribing newsletter:', error);
    return NextResponse.json({ success: false, message: 'Network error. Please try again later.' }, { status: 500 });
  }
}

