import { NextResponse, type NextRequest } from 'next/server';
import { getAdminEmailAllowlist } from '../_auth';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    const email = String(body?.email || '').trim().toLowerCase();
    const allowlist = getAdminEmailAllowlist();
    const allowed = Boolean(email) && allowlist.length > 0 && allowlist.includes(email);
    return NextResponse.json<ApiResponse<{ allowed: boolean }>>({ success: true, data: { allowed } });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Bad Request';
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status: 400 });
  }
}

