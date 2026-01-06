import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-[100vh] flex items-center justify-center px-6">{children}</div>;
}

