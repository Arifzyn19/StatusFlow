import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'StatusFlow — WhatsApp Status Uploader',
  description: 'Manage WhatsApp accounts and publish video Status updates.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-ink-950 font-sans text-white antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
