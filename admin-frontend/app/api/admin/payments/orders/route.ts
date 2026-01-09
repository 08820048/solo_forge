import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type SponsorshipOrder = {
  id: string;
  user_email: string;
  user_id?: string | null;
  product_id: string;
  placement: string;
  slot_index?: number | null;
  requested_months: number;
  paid_months?: number | null;
  status: string;
  provider: string;
  provider_checkout_id?: string | null;
  provider_order_id?: string | null;
  amount_usd_cents?: number | null;
  grant_id?: number | null;
  created_at: string;
  updated_at: string;
};

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

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => params.append(key, value));

    const response = await fetch(`${BACKEND_API_URL}/admin/payments/orders?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<SponsorshipOrder[]>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch orders' },
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

