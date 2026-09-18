'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button, FieldError } from '@/components/ui/ui';

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const setupCheck = useQuery({
    queryKey: ['setup-check'],
    queryFn: async () => {
      try {
        await api.me();
        router.replace('/dashboard');
        return { hasSession: true };
      } catch {
        return { hasSession: false };
      }
    },
  });

  const form = useForm<Form>({ resolver: zodResolver(schema) });
  const login = useMutation({
    mutationFn: (v: Form) =>
      mode === 'setup' ? api.setup(v.email, v.password) : api.login(v.email, v.password),
    onSuccess: () => router.push('/dashboard'),
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold text-accent">StatusFlow</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {mode === 'setup' ? 'Create admin account' : 'Sign in'}
          </h1>
          <p className="mt-1 text-sm text-fog">
            {mode === 'setup'
              ? 'First-run setup. This creates the admin user.'
              : 'Access your WhatsApp Status dashboard.'}
          </p>
        </div>
        <form
          className="card space-y-4"
          onSubmit={form.handleSubmit((v) => login.mutate(v))}
        >
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" {...form.register('email')} />
            <FieldError message={form.formState.errors.email?.message} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" autoComplete="current-password" {...form.register('password')} />
            <FieldError message={form.formState.errors.password?.message} />
          </div>
          {login.isError && (
            <p className="rounded-md border border-red-900/60 bg-red-950 px-3 py-2 text-sm text-red-200">
              {(login.error as Error).message}
            </p>
          )}
          <Button className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Please wait…' : mode === 'setup' ? 'Create account' : 'Sign in'}
          </Button>
          <button
            type="button"
            className="w-full text-center text-xs text-fog hover:text-white"
            onClick={() => setMode(mode === 'setup' ? 'login' : 'setup')}
          >
            {mode === 'setup' ? 'Already set up? Sign in' : 'First run? Create admin account'}
          </button>
        </form>
        {setupCheck.isLoading && <p className="mt-4 text-center text-xs text-fog">Checking session…</p>}
      </div>
    </main>
  );
}
