import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAdminSession } from '@/lib/admin-auth';
import { Logo } from '@/components/ui/primitives';
import LogoutButton from '@/components/admin/LogoutButton';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-elevated/90 backdrop-blur">
        <div className="container-x flex h-16 items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <Link href="/admin" aria-label="MTK Codex admin home">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <Link href="/admin" className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-muted hover:text-fg">
                Leads
              </Link>
              <Link href="/admin/outreach" className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-muted hover:text-fg">
                Outreach
              </Link>
              <Link href="/admin/docs" className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted transition hover:bg-muted hover:text-fg">
                Playbook
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-fg-subtle md:inline">{session.email}</span>
            <LogoutButton />
          </div>
        </div>
        <nav className="container-x flex items-center gap-1 pb-2 sm:hidden">
          <Link href="/admin" className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Leads
          </Link>
          <Link href="/admin/outreach" className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Outreach
          </Link>
          <Link href="/admin/docs" className="rounded-lg px-3 py-1.5 text-sm text-fg-muted hover:text-fg">
            Playbook
          </Link>
        </nav>
      </header>
      <main className="container-x py-8">{children}</main>
    </div>
  );
}
