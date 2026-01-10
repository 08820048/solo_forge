import { NextRequest, NextResponse } from 'next/server';

type ApiResponse<T> = { success: boolean; data?: T; message?: string };

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

/**
 * handlePost
 * 兼容旧版前台调用路径；支付创建接口已下线。
 */
async function handlePost(request: NextRequest) {
  const lang = request.headers.get('Accept-Language') || 'en';
  return NextResponse.json<ApiResponse<null>>(
    {
      success: false,
      message: lang.startsWith('zh') ? '支付接口已下线，请使用赞助申请流程。' : 'Checkout API has been disabled. Please submit a sponsorship request.',
    },
    { status: 410 }
  );
}

export async function POST(request: NextRequest) {
  return handlePost(request);
}
