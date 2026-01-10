import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const adminAppUrl = String(process.env.NEXT_PUBLIC_ADMIN_APP_URL || process.env.ADMIN_APP_URL || '').trim();
  if (adminAppUrl) {
    redirect(adminAppUrl);
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-sm">
        <div className="text-base font-semibold">管理后台已迁移为独立项目</div>
        <div className="mt-2 text-muted-foreground">
          请在 frontend/.env.local 配置 NEXT_PUBLIC_ADMIN_APP_URL（例如 http://localhost:3002）。
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
