import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/supabaseServer';
import {
  SEED_POSITIONS, SEED_DECISIONS, SEED_INITIAL_CAPITAL, SEED_CASH_BALANCE,
} from '@/lib/serverSeed';

export const dynamic = 'force-dynamic';

/**
 * YERLEŞİK PORTFÖY (SEED) — SUNUCU TARAFI
 *
 * Seed verisi client bundle'ında DURMAZ (site herkese açık; View Source ile
 * okunabilirdi). Bu route veriyi yalnızca GEÇERLİ Supabase oturumu olan
 * kullanıcıya döndürür:
 *
 *   Authorization: Bearer <supabase access_token>
 *
 * Token sunucuda `auth.getUser(token)` ile doğrulanır. Oturum yoksa 401 —
 * hiçbir portföy verisi sızmaz. Log'da token/e-posta YOK.
 */
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json(
      { error: 'Oturum gerekli — yerleşik portföy yalnızca giriş yapmış kullanıcıya verilir.' },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ok: true,
    positions: SEED_POSITIONS,
    decisions: SEED_DECISIONS,
    initialCapital: SEED_INITIAL_CAPITAL,
    cashBalance: SEED_CASH_BALANCE,
  });
}
