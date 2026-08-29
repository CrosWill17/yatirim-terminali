import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getMarketData } from '@/lib/marketData';
import { getUserFromRequest } from '@/lib/supabaseServer';

export const dynamic = 'force-dynamic';

/**
 * CANLI PİYASA VERİSİ — KİŞİSEL (oturum zorunlu)
 * Yahoo Finance (BIST 100, USD/TRY, Ons Altın/Gümüş, BIST hisseleri) ve
 * fonaly.com (TEFAS fon birim pay fiyatları) sunucu tarafında çekilir.
 * Kaynaklara ulaşılamazsa gerçek 25.08.2026 snapshot'ına düşer ve
 * `source: 'seed'` olarak işaretlenir.
 *
 * DİKKAT (P1): Bu uç kullanıcının POZİSYON KODLARINI (portföy bileşimini)
 * döndürdüğü için oturum doğrulaması ister. Misafir ekranı bunun yerine
 * kimlik gerektirmeyen /api/market/public ucunu kullanır.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  }
  try {
    const data = await getMarketData();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Piyasa verisi çekilemedi' }, { status: 500 });
  }
}
