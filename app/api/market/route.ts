import { NextResponse } from 'next/server';
import { getMarketData } from '@/lib/marketData';

export const dynamic = 'force-dynamic';

/**
 * CANLI PİYASA VERİSİ
 * Yahoo Finance (BIST 100, USD/TRY, Ons Altın/Gümüş, BIST hisseleri) ve
 * fonaly.com (TEFAS fon birim pay fiyatları) sunucu tarafında çekilir.
 * Kaynaklara ulaşılamazsa gerçek 25.08.2026 snapshot'ına düşer ve
 * `source: 'seed'` olarak işaretlenir.
 */
export async function GET() {
  try {
    const data = await getMarketData();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Piyasa verisi çekilemedi' }, { status: 500 });
  }
}
