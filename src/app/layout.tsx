import type { Metadata } from 'next';
import Providers from './providers';
import { auth } from '../../auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'QuantDesk',
  description: 'Self-hosted swing-trading research terminal',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const isAdmin = !!session?.user?.isAdmin;
  const isLoggedIn = !!session?.user;
  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? null;

  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col">
        <Providers isAdmin={isAdmin} isLoggedIn={isLoggedIn} email={email} name={name}>{children}</Providers>
      </body>
    </html>
  );
}
