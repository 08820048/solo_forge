import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../_auth';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    return NextResponse.json<ApiResponse<{ email: string }>>({ success: true, data: { email: user.email } });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unauthorized';
    const status = message === 'Forbidden' ? 403 : 401;
    return NextResponse.json<ApiResponse<null>>({ success: false, message }, { status });
  }
}

