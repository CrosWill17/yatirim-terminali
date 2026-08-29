import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/supabaseServer';
import { ASSET_META } from '@/lib/serverSeed';

export const dynamic = 'force-dynamic';

/**
 * KANONİK VARLIK ADLARI/TÜRLERİ — SUNUCU TARAFI (P0/P1)
 *
 * Bu eşleme PORTFÖY KODLARINI içerdiği için client bundle'ında durmaz.
 * Yalnızca geçerli oturumu olan kullanıcıya döner:
 *
 *   GET /api/asset-meta
 *   Authorization: Bearer <supabase access_token>
 *
 * İstemci, girişten sonra buradan çeker ve ekranlarda gösterim için kullanır.
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  }
  return NextResponse.json({ assetMeta: ASSET_META });
}
