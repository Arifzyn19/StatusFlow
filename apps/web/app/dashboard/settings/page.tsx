'use client';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, FieldError, Skeleton } from '@/components/ui/ui';

const limitsSchema = z.object({
  maxUploadSizeMB: z.coerce.number().int().min(1).max(2048),
  maxVideoDurationSeconds: z.coerce.number().int().min(5).max(600),
  maxConcurrentUploads: z.coerce.number().int().min(1).max(8),
  maxConcurrentFfmpeg: z.coerce.number().int().min(1).max(4),
});

const pwSchema = z.object({
  currentPassword: z.string().min(1, 'Required'),
  newPassword: z.string().min(8, 'Minimum 8 characters'),
});

export default function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });

  const limits = useForm<z.infer<typeof limitsSchema>>({
    resolver: zodResolver(limitsSchema),
    values: settings.data
      ? {
          maxUploadSizeMB: settings.data.maxUploadSizeMB,
          maxVideoDurationSeconds: settings.data.maxVideoDurationSeconds,
          maxConcurrentUploads: settings.data.maxConcurrentUploads,
          maxConcurrentFfmpeg: settings.data.maxConcurrentFfmpeg,
        }
      : undefined,
  });

  const save = useMutation({
    mutationFn: (v: z.infer<typeof limitsSchema>) => api.saveSettings(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });

  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });
  const changePw = useMutation({
    mutationFn: (v: z.infer<typeof pwSchema>) => api.changePassword(v.currentPassword, v.newPassword),
    onSuccess: () => pw.reset(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-fog">Admin security, upload limits and system info. Secrets are never shown.</p>
      </div>

      <section className="card space-y-4">
        <h2 className="text-sm font-medium">Change password</h2>
        <form className="grid max-w-md gap-3" onSubmit={pw.handleSubmit((v) => changePw.mutate(v))}>
          <div>
            <label className="label" htmlFor="cur">Current password</label>
            <input id="cur" type="password" className="input" {...pw.register('currentPassword')} />
            <FieldError message={pw.formState.errors.currentPassword?.message} />
          </div>
          <div>
            <label className="label" htmlFor="new">New password</label>
            <input id="new" type="password" className="input" {...pw.register('newPassword')} />
            <FieldError message={pw.formState.errors.newPassword?.message} />
          </div>
          {changePw.isSuccess && <p className="text-sm text-emerald-300">Password updated.</p>}
          {changePw.isError && <p className="text-sm text-red-300">{(changePw.error as Error).message}</p>}
          <Button className="w-fit" disabled={changePw.isPending}>
            {changePw.isPending ? 'Saving…' : 'Update password'}
          </Button>
        </form>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-medium">Upload limits</h2>
        {settings.isLoading && <Skeleton className="h-40" />}
        {settings.data && (
          <form className="grid max-w-2xl gap-3 sm:grid-cols-2" onSubmit={limits.handleSubmit((v) => save.mutate(v))}>
            <div>
              <label className="label" htmlFor="s-size">Max size (MB)</label>
              <input id="s-size" type="number" className="input" {...limits.register('maxUploadSizeMB')} />
            </div>
            <div>
              <label className="label" htmlFor="s-dur">Max duration (s)</label>
              <input id="s-dur" type="number" className="input" {...limits.register('maxVideoDurationSeconds')} />
            </div>
            <div>
              <label className="label" htmlFor="s-conc">Concurrent uploads</label>
              <input id="s-conc" type="number" className="input" {...limits.register('maxConcurrentUploads')} />
            </div>
            <div>
              <label className="label" htmlFor="s-ff">Concurrent ffmpeg</label>
              <input id="s-ff" type="number" className="input" {...limits.register('maxConcurrentFfmpeg')} />
            </div>
            <div className="sm:col-span-2">
              {save.isSuccess && <p className="text-sm text-emerald-300">Settings saved. Restart may be needed for concurrency changes.</p>}
              {save.isError && <p className="text-sm text-red-300">{(save.error as Error).message}</p>}
              <Button className="mt-1 w-fit" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save limits'}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="text-sm font-medium">Application</h2>
        <p className="text-sm text-fog">StatusFlow v{settings.data?.version ?? '1.0.0'} · Video Status only (v1).</p>
        <p className="text-sm text-fog">
          Allowed formats: {(settings.data?.allowedVideoMime ?? []).join(', ')}. WhatsApp may compress videos on
          publish — the app never claims lossless delivery.
        </p>
        <p className="text-sm text-fog">Sessions live in a restricted server directory and are never exposed to the browser.</p>
      </section>
    </div>
  );
}
