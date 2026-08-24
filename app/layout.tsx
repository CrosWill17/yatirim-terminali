import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Yatırım Terminali v3.0 — BIST, Fon & Emtia',
  description: 'Canlı Portföy Yönetim Paneli, Karar Merkezi & Sosyal Doğrulama Motoru',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="tr" className="dark">
      <body className="bg-[#0a0d14] text-slate-100 min-h-screen antialiased selection:bg-sky-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
