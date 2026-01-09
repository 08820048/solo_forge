import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '../_auth';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';
const BACKEND_ADMIN_TOKEN = (process.env.BACKEND_ADMIN_TOKEN || '').trim();

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

type PricingPlanBenefit = {
  id: number;
  sort_order: number;
  text_en: string;
  text_zh: string;
  available: boolean;
};

type PricingPlanCampaign = {
  active: boolean;
  percent_off?: number | null;
  title_en?: string | null;
  title_zh?: string | null;
  creem_product_id?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
};

type PricingPlan = {
  id: string;
  plan_key: string;
  placement?: string | null;
  monthly_usd_cents?: number | null;
  creem_product_id?: string | null;
  title_en: string;
  title_zh: string;
  badge_en?: string | null;
  badge_zh?: string | null;
  description_en?: string | null;
  description_zh?: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  benefits: PricingPlanBenefit[];
  campaign: PricingPlanCampaign;
  created_at: string;
  updated_at: string;
};

type UpsertPricingPlanBenefit = {
  id?: number | null;
  sort_order: number;
  text_en: string;
  text_zh: string;
  available: boolean;
};

type UpsertPricingPlanRequest = {
  id?: string | null;
  plan_key: string;
  placement?: string | null;
  monthly_usd_cents?: number | null;
  creem_product_id?: string | null;
  title_en: string;
  title_zh: string;
  badge_en?: string | null;
  badge_zh?: string | null;
  description_en?: string | null;
  description_zh?: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
  benefits: UpsertPricingPlanBenefit[];
  campaign: PricingPlanCampaign;
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

    const { searchParams } = new URL(request.url);
    const params = new URLSearchParams();
    searchParams.forEach((value, key) => params.append(key, value));

    const response = await fetch(`${BACKEND_API_URL}/admin/pricing-plans?${params.toString()}`, {
      headers: {
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<PricingPlan[]>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to fetch pricing plans' },
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
    const body = (await request.json().catch(() => null)) as UpsertPricingPlanRequest | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json<ApiResponse<null>>({ success: false, message: 'Missing payload' }, { status: 400 });
    }

    const response = await fetch(`${BACKEND_API_URL}/admin/pricing-plans`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': request.headers.get('Accept-Language') || 'zh',
        'x-admin-token': getBackendAdminToken(),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const json = await readJsonSafe<ApiResponse<PricingPlan>>(response);
    if (!response.ok || !json?.success) {
      return NextResponse.json<ApiResponse<null>>(
        { success: false, message: json?.message || 'Failed to upsert pricing plan' },
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

