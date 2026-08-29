import { NextResponse } from 'next/server';
import { getStockQuotes } from '@/lib/marketData';

export const dynamic = 'force-dynamic';

/**
 * FON HİSSELERİ FİYATLARI (P3 — Günlük Tahmin + Fon İçeriği)
 *
 * GET /api/market/quotes?symbols=OZATD,TUPRS,...
 *
 * Yalnızca KAMUYA AÇIK fiyat verisi döner (BIST hisse fiyatı + günlük değişim).
 * Kodlar sunucuda doğrulanır (A-Z0-9, 2-10 karakter, en çok 60 kod).
 * Fiyatı çözülemeyen kod → null → arayüz "VERİ EKSİK" gösterir, katkı 0 sayılır.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('symbols') ?? '';
    const codes = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (codes.length === 0) {
      return NextResponse.json({ quotes: {} });
    }
    const quotes = await getStockQuotes(codes);
    return NextResponse.json({ quotes, requested: codes.length, at: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Fiyatlar çekilemedi' }, { status: 500 });
  }
}
