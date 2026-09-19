'use client';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UploadCloud, X, Film } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Empty } from '@/components/ui/ui';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';

function friendlyPublishError(e: unknown): string {
  const msg = e instanceof Error ? e.message : 'Upload failed';
  if (e instanceof TypeError || /failed to fetch|network ?error|load failed|timeout/i.test(msg)) {
    return 'Cannot reach the server — the API may be restarting. Wait a few seconds and retry.';
  }
  return msg;
}

export default function UploadPage() {
  const qc = useQueryClient();
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats });
  const [accountId, setAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const connected = useMemo(
    () => (accounts.data ?? []).filter((a) => a.status === 'CONNECTED'),
    [accounts.data],
  );
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const result = useQuery({
    queryKey: ['upload', resultId],
    queryFn: () => api.uploadDetail(resultId!),
    enabled: !!resultId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s && ['SUCCESS', 'FAILED', 'CANCELLED'].includes(s) ? false : 2000;
    },
  });

  const publish = useMutation({
    mutationFn: async () => {
      if (!accountId || !file) throw new Error('Select an account and a video first.');
      const fd = new FormData();
      fd.append('accountId', accountId);
      fd.append('file', file, file.name);
      setProgress(10);
      const res = await fetch('/api/uploads', { method: 'POST', body: fd, credentials: 'include' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'Upload failed');
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (r) => {
      setResultId(r.id);
      setProgress(30);
      qc.invalidateQueries({ queryKey: ['uploads'] });
    },
    onError: () => setProgress(null),
  });

  const cancel = useMutation({
    mutationFn: () => api.cancelUpload(resultId!),
    onSuccess: () => result.refetch(),
  });

  const maxMB = stats.data?.limits.maxUploadSizeMB ?? 128;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload Status</h1>
        <p className="mt-0.5 text-sm text-fog">Publish a video directly to a connected WhatsApp Status.</p>
      </div>

      <section className="card space-y-4">
        <div>
          <label className="label" htmlFor="account">WhatsApp account (connected only)</label>
          <select
            id="account"
            className="input"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Select account…</option>
            {connected.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} {a.phoneNumber ? `· ${a.phoneNumber}` : ''} · {a.contactCount} contacts
              </option>
            ))}
          </select>
          {accounts.data && connected.length === 0 && (
            <p className="mt-1 text-xs text-amber-300">No connected accounts. Connect one under Accounts first.</p>
          )}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) {
              setFile(f);
              setResultId(null);
              setProgress(null);
            }
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? 'border-accent bg-accent-soft' : 'border-line bg-ink-900'
          }`}
        >
          <UploadCloud className="h-6 w-6 text-fog" />
          <p className="mt-2 text-sm text-white">Drag & drop a video, or tap to browse</p>
          <p className="mt-1 text-xs text-fog">
            MP4 · MOV · WebM (if supported) — max {maxMB} MB · max {stats.data?.limits.maxVideoDurationSeconds ?? 90}s
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFile(f);
                setResultId(null);
                setProgress(null);
              }
            }}
          />
        </div>

        {file && (
          <div className="rounded-md border border-line bg-ink-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Film className="h-4 w-4 text-fog" />
                <div>
                  <p className="text-sm text-white">{file.name}</p>
                  <p className="text-xs text-fog">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || 'unknown type'}
                  </p>
                </div>
              </div>
              <button
                className="rounded-md p-1 text-fog hover:text-white"
                onClick={() => {
                  setFile(null);
                  setResultId(null);
                  setProgress(null);
                }}
                aria-label="Remove video"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {previewUrl && (
              <video src={previewUrl} controls playsInline className="mt-3 max-h-72 w-full rounded-md bg-black" />
            )}
          </div>
        )}

        {publish.isError && (
          <p className="rounded-md border border-red-900/60 bg-red-950 px-3 py-2 text-sm text-red-200">
            {friendlyPublishError(publish.error)}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!accountId || !file || publish.isPending}
            onClick={() => publish.mutate()}
          >
            <UploadCloud className="h-4 w-4" />
            {publish.isPending ? 'Starting…' : 'Upload to Status'}
          </Button>
          {resultId && result.data && !['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.data.status) && (
            <Button variant="ghost" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel
            </Button>
          )}
        </div>

        {result.data && (
          <div className="rounded-md border border-line bg-ink-900 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-white">Publishing status</p>
              <Badge status={result.data.status} />
            </div>
            {progress != null && !['SUCCESS', 'FAILED', 'CANCELLED'].includes(result.data.status) && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div className="h-full animate-pulse rounded-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            )}
            <div className="mt-2 text-xs text-fog">
              {result.data.duration != null && <span>{Math.round(result.data.duration)}s</span>}
              {result.data.width != null && (
                <span> · {result.data.width}×{result.data.height}</span>
              )}
            </div>
            {result.data.status === 'SUCCESS' && (
              <p className="mt-2 text-sm text-emerald-300">Published — confirmed by WhatsApp.</p>
            )}
            {result.data.status === 'FAILED' && (
              <p className="mt-2 text-sm text-red-300">
                Failed{result.data.errorCode ? ` (${result.data.errorCode})` : ''}: {result.data.errorMessage ?? 'Unknown error'}
              </p>
            )}
          </div>
        )}
      </section>

      {!file && (
        <Empty title="No video selected" hint="Choose a file to preview metadata before publishing. Nothing is uploaded until you confirm." />
      )}
    </div>
  );
}
