import { NextResponse } from 'next/server';
import { getMixedQuotes } from '@/lib/marketData';
import { getUserFromRequest } from '@/lib/supabaseServer';
import { createRateLimiter, clientKey, retryAfterSeconds } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * KARIŞIK FİYAT BESLEMESİ (P3 + dinamik pozisyonlar)
 *
 * GET /api/market/quotes?symbols=OZATD,TUPRS,TLY,DFI,...
 * Authorization: Bearer <supabase access_token>   ← ZORUNLU
 *
 * - BIST hisseleri → Yahoo Finance chart API (.IS)
 * - TEFAS fonları → fonaly.com (birim pay fiyatı + günlük getiri)
 * - Önce fon, sonra hisse denenir; ilk başarılı döner
 * - Çözülemeyen kod → null → arayüz "VERİ EKSİK" gösterir (uydurma yok)
 *
 * OTURUM NEDEN ŞART: bu uç sunucudan dışarı çıkar. Auth'suz bırakıldığında
 * (curl ile doğrulandı: token'sız istek HTTP 200 dönüyordu) site herkese açık
 * bir scrape proxy'sine dönüşüyor ve Yahoo/fonaly sunucu IP'mizi banlayabiliyor.
 * Çağıran iki yer de (app/page.tsx:216 ve :389) zaten `isGuest` kontrolüyle
 * korunuyor, yani misafir akışı bu uca hiç dokunmuyor — misafir ekranı
 * kimlik gerektirmeyen /api/market/public'i kullanır.
 */

/** Kullanıcı başına 60 sn'de 30 istek — arayüz 60 sn'de bir yoklar. */
const limiter = createRateLimiter();
const WINDOW_MS = 60_000;
const LIMIT = 30;

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  }

  const rl = limiter.check(clientKey(req, user.id), { windowMs: WINDOW_MS, limit: LIMIT });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Çok fazla istek — biraz sonra tekrar deneyin' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds(rl.resetAt)) } }
    );
  }

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
