import { NextRequest, NextResponse } from 'next/server';

const BACKEND_API_URL = process.env.BACKEND_API_URL || 'http://localhost:8080/api';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * handlePost
 * 处理前台赞助登记请求，将数据转发到后端写入 sponsorship_requests。
 */
async function handlePost(request: NextRequest) {
  const lang = request.headers.get('Accept-Language') || 'en';

  const body = (await request.json().catch(() => null)) as
    | {
        email?: string;
        product?: string;
        placement?: string;
        duration_days?: number;
        note?: string | null;
        top_side?: 'left' | 'right';
        slot_index?: number;
      }
    | null;

  const email = (body?.email || '').trim();
  const productRef = (body?.product || '').trim();
  const placement = (body?.placement || '').trim();
  const durationDays = Number(body?.duration_days || 0);

  if (!email || !productRef || !placement || !durationDays || durationDays <= 0) {
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        message:
          lang.startsWith('zh') ?
            '缺少必填字段（邮箱 / 产品 / 展示位置 / 展示时长）。'
          : 'Missing required fields (email / product / placement / duration).',
      },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    email,
    product_ref: productRef,
    placement,
    duration_days: durationDays,
    note: (body?.note || '').trim() || null,
  };

  if (typeof body?.slot_index === 'number') {
    payload.slot_index = body.slot_index;
  } else if (placement === 'home_top' && body?.top_side) {
    payload.slot_index = body.top_side === 'right' ? 1 : 0;
  }

  try {
    const response = await fetch(`${BACKEND_API_URL}/sponsorship/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': lang,
      },
      body: JSON.stringify(payload),
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

    if (!response.ok || !data?.success) {
      return NextResponse.json<ApiResponse<null>>(
        {
          success: false,
          message:
            data?.message ||
            (lang.startsWith('zh') ? '提交赞助信息失败，请稍后重试。' : 'Failed to submit sponsorship request.'),
        },
        { status: response.status || 502 }
      );
    }

    return NextResponse.json<ApiResponse<null>>(
      {
        success: true,
        message:
          data.message ||
          (lang.startsWith('zh') ? '赞助信息已提交，我们会尽快处理。' : 'Sponsorship request submitted successfully.'),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error submitting sponsorship request:', error);
    return NextResponse.json<ApiResponse<null>>(
      {
        success: false,
        message: lang.startsWith('zh') ? '网络错误，请稍后重试。' : 'Network error. Please try again later.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handlePost(request);
}
