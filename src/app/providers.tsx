'use client';

import { SWRConfig } from 'swr';
import { SettingsProvider } from '@/components/providers/SettingsProvider';
import { AuthProvider } from '@/components/auth/AuthContext';

const fetcher = async (url: string): Promise<unknown> => {
  const r = await fetch(url);
  const data = (await r.json()) as { error?: string };
  if (!r.ok) throw new Error((data as { error?: string }).error ?? r.statusText);
  return data;
};

export default function Providers({
  isAdmin,
  isLoggedIn,
  email,
  name,
  children,
}: {
  isAdmin: boolean;
  isLoggedIn: boolean;
  email: string | null;
  name: string | null;
  children: React.ReactNode;
}) {
  return (
    <AuthProvider isAdmin={isAdmin} email={email} name={name}>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: false,
          dedupingInterval: 30_000,
        }}
      >
        {isLoggedIn ? (
          <SettingsProvider>
            {children}
          </SettingsProvider>
        ) : (
          children
        )}
      </SWRConfig>
    </AuthProvider>
  );
}
