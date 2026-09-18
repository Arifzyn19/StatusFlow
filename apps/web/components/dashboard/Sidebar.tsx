'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Smartphone,
  UploadCloud,
  History,
  Settings,
  LogOut,
  Activity,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/components/ui/ui';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/accounts', label: 'Accounts', icon: Smartphone },
  { href: '/dashboard/upload', label: 'Upload', icon: UploadCloud },
  { href: '/dashboard/history', label: 'History', icon: History },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      router.push('/login');
    },
  });

  return (
    <aside className="flex w-full flex-row items-center gap-1 overflow-x-auto border-b border-line bg-ink-900 px-4 py-3 md:h-screen md:w-60 md:flex-col md:items-stretch md:gap-1 md:overflow-visible md:px-3 md:py-6">
      <Link href="/dashboard" className="mr-4 flex items-center gap-2 md:mb-6 md:mr-0 md:px-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent">
          <Activity className="h-4 w-4 text-white" />
        </span>
        <span className="text-sm font-semibold tracking-tight text-white">StatusFlow</span>
      </Link>
      <nav className="flex flex-row gap-1 md:flex-col">
        {NAV.map((n) => {
          const active = n.exact ? path === n.href : path.startsWith(n.href);
          const Icon = n.icon;
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm',
                active ? 'bg-ink-700 text-white' : 'text-fog hover:bg-ink-800 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto md:ml-0 md:mt-auto md:px-1">
        <button
          onClick={() => logout.mutate()}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-fog hover:bg-ink-800 hover:text-white"
        >
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </aside>
  );
}
