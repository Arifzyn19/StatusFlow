'use client';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { useLiveEvents } from '@/lib/useEvents';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  useLiveEvents();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
