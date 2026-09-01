import { NextResponse } from 'next/server';
import { getMixedQuotes } from '@/lib/marketData';

export const dynamic = 'force-dynamic';

/**
 * KARIŞIK FİYAT BESLEMESİ (P3 + dinamik pozisyonlar)
 *
 * GET /api/market/quotes?symbols=OZATD,TUPRS,TLY,DFI,...
 *
 * - BIST hisseleri → Yahoo Finance chart API (.IS)
 * - TEFAS fonları → fonaly.com (birim pay fiyatı + günlük getiri)
 * - Önce fon, sonra hisse denenir; ilk başarılı döner
 * - Çözülemeyen kod → null → arayüz "VERİ EKSİK" gösterir (uydurma yok)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get('symbols') ?? '';
    const codes = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (codes.length === 0) {
      return NextResponse.json({ quotes: {} });
    }
    const quotes = await getMixedQuotes(codes);
    return NextResponse.json({ quotes, requested: codes.length, at: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: 'Fiyatlar çekilemedi' }, { status: 500 });
  }
}
