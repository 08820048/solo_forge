import Link from 'next/link';

/**
 * AdminPage
 * 主站内置管理后台已下线；此页面仅作为迁移提示与跳转入口。
 */
export default function AdminPage() {
  const adminAppUrl = String(process.env.NEXT_PUBLIC_ADMIN_APP_URL || process.env.ADMIN_APP_URL || '').trim();

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-muted-foreground">当前主站不再提供内置管理后台页面。</div>
      {adminAppUrl ? (
        <Link className="underline underline-offset-4 hover:text-foreground" href={adminAppUrl}>
          打开独立管理后台
        </Link>
      ) : (
        <div className="text-sm text-muted-foreground">请配置 NEXT_PUBLIC_ADMIN_APP_URL 以启用跳转。</div>
      )}
    </div>
  );
}
