'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Smartphone, UploadCloud, CheckCircle2, XCircle, Cpu, HardDrive } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Skeleton, Empty } from '@/components/ui/ui';

function Stat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-fog">{label}</p>
        <span className="text-fog">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export default function OverviewPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['stats'], queryFn: api.stats });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (isError || !data) {
    return <Empty title="Could not load dashboard" hint="Check that the API is running and you are signed in." />;
  }

  const memPct = Math.round((data.system.usedMem / Math.max(1, data.system.totalMem)) * 100);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-0.5 text-sm text-fog">Accounts, uploads and system health at a glance.</p>
        </div>
        <Link href="/dashboard/upload" className="btn-primary">
          <UploadCloud className="h-4 w-4" /> Quick upload
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Accounts" value={data.accounts.total} icon={<Smartphone className="h-4 w-4" />} />
        <Stat label="Connected" value={data.accounts.connected} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Uploads" value={data.uploads.total} icon={<UploadCloud className="h-4 w-4" />} />
        <Stat label="Failed" value={data.uploads.failed} icon={<XCircle className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="text-sm font-medium">Recent activity</h2>
          <div className="mt-3 space-y-2">
            {data.recent.length === 0 && <p className="text-sm text-fog">No uploads yet.</p>}
            {data.recent.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{r.originalFilename}</p>
                  <p className="text-xs text-fog">{new Date(r.createdAt).toLocaleString()}</p>
                </div>
                <Badge status={r.status} />
              </div>
            ))}
          </div>
          <Link href="/dashboard/history" className="mt-3 inline-block text-sm text-accent hover:underline">
            View history →
          </Link>
        </section>

        <section className="card">
          <h2 className="text-sm font-medium">System resources</h2>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-center gap-2 text-fog">
              <Cpu className="h-4 w-4" />
              <span>{data.system.cpuCount} CPUs · load {data.system.loadAvg[0]?.toFixed(2)}</span>
            </div>
            <div>
              <div className="flex justify-between text-xs text-fog">
                <span>Memory</span>
                <span>{memPct}% · {fmtBytes(data.system.usedMem)} / {fmtBytes(data.system.totalMem)}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full rounded-full bg-accent" style={{ width: `${memPct}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2 text-fog">
              <HardDrive className="h-4 w-4" />
              <span>{data.system.diskFree != null ? `Disk free ${fmtBytes(data.system.diskFree)}` : 'Disk usage unavailable'}</span>
            </div>
            <p className="text-xs text-fog">
              Limits: {data.limits.maxUploadSizeMB} MB · {data.limits.maxVideoDurationSeconds}s ·{' '}
              {data.limits.maxConcurrentUploads} uploads · {data.limits.maxConcurrentFfmpeg} ffmpeg
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
