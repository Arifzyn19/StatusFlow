'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { QrCode, RefreshCw, LogOut, Trash2, Plus, Smartphone, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Empty, Skeleton, FieldError } from '@/components/ui/ui';

const schema = z.object({ name: z.string().min(1, 'Name is required').max(80) });

function QrBox({ accountId, status }: { accountId: string; status: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['qr', accountId, status],
    queryFn: () => api.accountQr(accountId),
    refetchInterval:
      status === 'QR_REQUIRED' || status === 'CONNECTING' || status === 'DISCONNECTED' ? 3000 : false,
  });
  if (status === 'CONNECTED') return <p className="text-sm text-emerald-300">Connected — no QR needed.</p>;
  if (status === 'LOGGED_OUT')
    return <p className="text-sm text-fog">Logged out. Remove and re-add the account, or use pairing code below.</p>;
  if (isLoading) return <Skeleton className="h-48 w-48" />;
  if (!data?.qrDataUrl)
    return (
      <div className="text-sm text-fog">
        <p>Waiting for QR… it refreshes automatically.</p>
        {data?.reason && <p className="mt-1 text-amber-300">{data.reason}</p>}
      </div>
    );
  return (
    <div className="flex flex-col items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.qrDataUrl}
        alt="WhatsApp QR code"
        className={`h-48 w-48 rounded-md border border-line bg-white p-2 ${data.stale ? 'opacity-40' : ''}`}
      />
      {data.stale ? (
        <p className="text-xs text-amber-300">
          {data.reason ?? 'Connection interrupted — fetching a fresh code…'}{' '}
          <span className="text-fog">The previous code no longer scans; a new one appears automatically.</span>
        </p>
      ) : (
        <p className="text-xs text-fog">Scan with WhatsApp → Linked devices. Codes expire after ~60s and refresh automatically.</p>
      )}
    </div>
  );
}

function PairingBox({ accountId, status }: { accountId: string; status: string }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const pair = useMutation({
    mutationFn: () => api.pairing(accountId, phone.replace(/[\s+()-]/g, '')),
    onSuccess: (r) => setCode(r.code),
  });

  if (status === 'CONNECTED') return null;
  return (
    <div className="rounded-md border border-line bg-ink-900 p-3">
      <p className="text-xs font-medium uppercase tracking-wider text-fog">Or link with a code</p>
      {code ? (
        <div className="mt-2 text-center">
          <p className="text-2xl font-semibold tracking-[0.2em] text-white">{code}</p>
          <p className="mt-1 text-xs text-fog">
            On your phone: WhatsApp → Settings → Linked devices → Link a device → <b>Link with phone number</b> →
            enter this code. Expires in a few minutes; request a new one if it fails.
          </p>
          <button className="mt-2 text-xs text-fog underline hover:text-white" onClick={() => { setCode(null); pair.reset(); }}>
            Use a different number
          </button>
        </div>
      ) : (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setCode(null);
            pair.mutate();
          }}
        >
          <input
            className="input"
            placeholder="201012345678 (country code + number, no +)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
          />
          <Button disabled={pair.isPending || phone.replace(/\D/g, '').length < 8}>
            {pair.isPending ? '…' : 'Get code'}
          </Button>
        </form>
      )}
      {pair.isError && <p className="mt-1 text-xs text-red-300">{(pair.error as Error).message}</p>}
      <p className="mt-1 text-[11px] text-fog">Use the number of the phone holding the WhatsApp account. Tip: request the code after a QR appears above — that confirms WhatsApp is reachable. A wrong number breaks this session — then remove and re-add the account.</p>
    </div>
  );
}

export default function AccountsPage() {
  const qc = useQueryClient();
  const [qrFor, setQrFor] = useState<string | null>(null);
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, refetchInterval: 8000 });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const create = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => api.createAccount(v.name),
    onSuccess: (acc) => {
      form.reset();
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setQrFor(acc.id);
    },
  });
  const reconnect = useMutation({
    mutationFn: api.reconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const sync = useMutation({
    mutationFn: api.syncContacts,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const logoutAcc = useMutation({
    mutationFn: api.logoutAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const remove = useMutation({
    mutationFn: api.removeAccount,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">WhatsApp accounts</h1>
        <p className="mt-0.5 text-sm text-fog">Connect accounts via QR, monitor status, reconnect or remove.</p>
      </div>

      <form className="card flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={form.handleSubmit((v) => create.mutate(v))}>
        <div className="flex-1">
          <label className="label" htmlFor="name">New account name</label>
          <input id="name" className="input" placeholder="e.g. Main business line" {...form.register('name')} />
          <FieldError message={form.formState.errors.name?.message} />
        </div>
        <Button disabled={create.isPending}>
          <Plus className="h-4 w-4" /> {create.isPending ? 'Adding…' : 'Add account'}
        </Button>
      </form>
      {create.isError && (
        <p className="rounded-md border border-red-900/60 bg-red-950 px-3 py-2 text-sm text-red-200">
          {(create.error as Error).message}
        </p>
      )}

      {accounts.isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      )}
      {accounts.data?.length === 0 && (
        <Empty title="No accounts yet" hint="Add your first WhatsApp account above, then scan the QR code." />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts.data?.map((a) => (
          <article key={a.id} className="card space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-700">
                  <Smartphone className="h-4 w-4 text-fog" />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{a.name}</p>
                  <p className="text-xs text-fog">
                    {a.phoneNumber ?? 'Phone not linked yet'}
                    {a.lastConnectedAt ? ` · last seen ${new Date(a.lastConnectedAt).toLocaleString()}` : ''}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-fog">
                    <Users className="h-3 w-3" />
                    {a.contactCount > 0 ? (
                      <span>{a.contactCount} contact{a.contactCount === 1 ? '' : 's'} synced — Status audience ready</span>
                    ) : (
                      <span className="text-amber-300">No contacts synced — Status won’t post until you sync</span>
                    )}
                  </p>
                </div>
              </div>
              <Badge status={a.status} />
            </div>

            {qrFor === a.id && (
              <div className="space-y-3">
                <QrBox accountId={a.id} status={a.status} />
                <PairingBox accountId={a.id} status={a.status} />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setQrFor(qrFor === a.id ? null : a.id)}>
                <QrCode className="h-4 w-4" /> {qrFor === a.id ? 'Hide QR' : 'Show QR'}
              </Button>
              <Button variant="ghost" onClick={() => reconnect.mutate(a.id)} disabled={reconnect.isPending}>
                <RefreshCw className="h-4 w-4" /> Reconnect
              </Button>
              <Button
                variant="ghost"
                onClick={() => sync.mutate(a.id)}
                disabled={sync.isPending || a.status !== 'CONNECTED'}
                title="Pull the address-book snapshot WhatsApp needs to deliver Status updates"
              >
                <Users className="h-4 w-4" /> {sync.isPending ? 'Syncing…' : 'Sync contacts'}
              </Button>
              <Button variant="ghost" onClick={() => logoutAcc.mutate(a.id)}>
                <LogOut className="h-4 w-4" /> Logout
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  if (confirm(`Remove "${a.name}"? This deletes its session.`)) remove.mutate(a.id);
                }}
              >
                <Trash2 className="h-4 w-4" /> Remove
              </Button>
            </div>
            {sync.isError && (
              <p className="text-xs text-red-300">{(sync.error as Error).message}</p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
