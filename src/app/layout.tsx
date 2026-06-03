import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'QuantDesk',
  description: 'Self-hosted swing-trading research terminal',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col">{children}</body>
    </html>
  );
}
