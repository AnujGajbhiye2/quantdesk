'use client';

import { SWRConfig } from 'swr';

const fetcher = async (url: string): Promise<unknown> => {
  const r = await fetch(url);
  const data = (await r.json()) as { error?: string };
  if (!r.ok) throw new Error((data as { error?: string }).error ?? r.statusText);
  return data;
};

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: false,
        dedupingInterval: 30_000,
      }}
    >
      {children}
    </SWRConfig>
  );
}
