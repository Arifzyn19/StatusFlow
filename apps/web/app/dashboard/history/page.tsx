'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Empty, Skeleton } from '@/components/ui/ui';

export default function HistoryPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [accountId, setAccountId] = useState('');
  const [search, setSearch] = useState('');

  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts });
  const list = useQuery({
    queryKey: ['uploads', page, status, accountId, search],
    queryFn: () => api.uploads({ page, pageSize: 15, status: status || undefined, accountId: accountId || undefined, search: search || undefined }),
  });

  const del = useMutation({
    mutationFn: api.deleteUpload,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  });

  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 15));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Upload history</h1>
        <p className="mt-0.5 text-sm text-fog">Every Status publish attempt, newest first.</p>
      </div>

      <div className="card flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="flex-1">
          <label className="label" htmlFor="q">Search filename</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fog" />
            <input
              id="q"
              className="input pl-9"
              placeholder="birthday.mp4…"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="f-account">Account</label>
          <select id="f-account" className="input" value={accountId} onChange={(e) => { setPage(1); setAccountId(e.target.value); }}>
            <option value="">All</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" className="input" value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All</option>
            {['QUEUED', 'VALIDATING', 'PROCESSING', 'PUBLISHING', 'SUCCESS', 'FAILED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {list.isLoading && <Skeleton className="h-64" />}
      {list.data?.data.length === 0 && (
        <Empty title="No uploads match" hint="Try clearing filters, or publish your first Status from the Upload page." />
      )}

      {list.data && list.data.data.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="table-head px-4 py-3">File</th>
                <th className="table-head px-4 py-3">Account</th>
                <th className="table-head px-4 py-3">Size</th>
                <th className="table-head px-4 py-3">Date</th>
                <th className="table-head px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right text-xs uppercase tracking-wider text-fog">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.data.map((u) => (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <p className="max-w-[240px] truncate text-white">{u.originalFilename}</p>
                    {u.errorMessage && <p className="mt-0.5 max-w-[240px] truncate text-xs text-red-300">{u.errorMessage}</p>}
                  </td>
                  <td className="px-4 py-3 text-fog">{u.accountName ?? u.accountId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-fog">{(u.fileSize / 1024 / 1024).toFixed(1)} MB</td>
                  <td className="px-4 py-3 text-fog">{new Date(u.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3"><Badge status={u.status} /></td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      className="px-2 py-1"
                      onClick={() => {
                        if (confirm('Delete this history record?')) del.mutate(u.id);
                      }}
                      aria-label={`Delete ${u.originalFilename}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-fog">
        <p>Page {page} of {totalPages} · {list.data?.total ?? 0} records</p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
