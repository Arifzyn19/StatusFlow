import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes } from 'react';

export function cn(...v: (string | false | null | undefined)[]) {
  return twMerge(clsx(...v));
}

const statusTone: Record<string, string> = {
  CONNECTED: 'bg-emerald-950 text-emerald-300 border border-emerald-900/60',
  SUCCESS: 'bg-emerald-950 text-emerald-300 border border-emerald-900/60',
  QR_REQUIRED: 'bg-amber-950 text-amber-300 border border-amber-900/60',
  CONNECTING: 'bg-amber-950 text-amber-300 border border-amber-900/60',
  VALIDATING: 'bg-amber-950 text-amber-300 border border-amber-900/60',
  PROCESSING: 'bg-amber-950 text-amber-300 border border-amber-900/60',
  PUBLISHING: 'bg-sky-950 text-sky-300 border border-sky-900/60',
  QUEUED: 'bg-ink-700 text-fog border border-line',
  DISCONNECTED: 'bg-ink-700 text-fog border border-line',
  LOGGED_OUT: 'bg-ink-700 text-fog border border-line',
  ERROR: 'bg-red-950 text-red-300 border border-red-900/60',
  FAILED: 'bg-red-950 text-red-300 border border-red-900/60',
  CANCELLED: 'bg-ink-700 text-fog border border-line',
};

export function Badge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('badge', statusTone[status] ?? 'bg-ink-700 text-fog border border-line', className)}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

export function Button({
  variant = 'primary',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      className={cn(
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-ghost',
        variant === 'danger' && 'btn-danger',
        className,
      )}
      {...rest}
    />
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="text-sm font-medium text-white">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-sm text-fog">{hint}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-ink-700', className)} />;
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-red-300">{message}</p>;
}
