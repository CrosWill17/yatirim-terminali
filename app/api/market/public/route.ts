import { NextResponse } from 'next/server';
import { getPublicMarketData } from '@/lib/marketData';

export const dynamic = 'force-dynamic';

/**
 * HALKA AÇIK PİYASA VERİSİ (P1 — Misafir Modu)
 *
 * Oturum GEREKTİRMEZ. Yalnızca kamuya açık veri döner:
 * endeksler + lib/publicWatchlist.ts içindeki standart hisseler ve
 * altın/gümüş enstrümanları. Portföy kodu/tutarı bu yanıtta YOKTUR.
 */
export async function GET() {
  try {
    const data = await getPublicMarketData();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Halka açık piyasa verisi çekilemedi' }, { status: 500 });
  }
}
