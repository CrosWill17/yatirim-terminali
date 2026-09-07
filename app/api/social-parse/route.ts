import { NextResponse } from 'next/server';
import { parseSocialTweet } from '@/lib/parseSocial';
import { getUserFromRequest } from '@/lib/supabaseServer';
import { createRateLimiter, clientKey, retryAfterSeconds } from '@/lib/rateLimit';

/**
 * SOSYAL MEDYA TAHMİN AYRIŞTIRICI (UI — elle yapıştırılan metin)
 *
 * POST /api/social-parse
 * Authorization: Bearer <supabase access_token>   ← ZORUNLU
 *
 * Ayrıştırma mantığının TEK KAYNAĞI: lib/parseSocial.ts
 * (GitHub Actions twitter-sync hattı ile aynı modülü kullanır.)
 *
 * OTURUM NEDEN ŞART: uç auth'suzdu (curl ile doğrulandı: token'sız POST HTTP 200
 * dönüyordu) ve yanıtta `predictorHandle: "@sevketozhan"` sabitini sızdırıyordu.
 * Tek çağıranı app/page.tsx:756 (handleParseTweet) — o da yalnızca girişli
 * kullanıcının gördüğü "📱 Sosyal Doğrulama" sekmesinde.
 */

/** Kullanıcı başına 60 sn'de 20 ayrıştırma. */
const limiter = createRateLimiter();
const WINDOW_MS = 60_000;
const LIMIT = 20;

/**
 * Takip edilen tek tahmin kaynağı. Eskiden burada
 * `parsed.fundCode ? '@sevketozhan' : '@sevketozhan'` gibi iki kolu da aynı
 * değeri döndüren bir ternary vardı; tek sabite indirildi.
 */
const DEFAULT_HANDLE = '@sevketozhan';

export async function POST(req: Request) {
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
    const body = await req.json().catch(() => null);
    const text = body?.text;
    const handle = typeof body?.handle === 'string' ? body.handle.trim() : '';

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Metin gerekli' }, { status: 400 });
    }

    // Savunma: çok uzun metin regex'i gereksiz yere yorar.
    if (text.length > 4000) {
      return NextResponse.json({ error: 'Metin çok uzun (en fazla 4000 karakter)' }, { status: 400 });
    }

    const parsed = parseSocialTweet(text);

    // Öncelik: isteğin gönderdiği handle → metindeki @handle → varsayılan.
    const predictorHandle = handle || parsed.predictorHandle || DEFAULT_HANDLE;

    return NextResponse.json({
      success: true,
      parsed: {
        fundCode: parsed.fundCode ?? 'BILINMEYEN',
        // null = sayı çözülemedi (VERİ EKSİK) — uydurma 0 yazılmaz
        predictedReturnPct: parsed.value,
        hasPercentSign: parsed.hasPercentSign,
        category: parsed.category,
        predictorHandle,
        rawText: parsed.rawText,
        extractedAt: new Date().toISOString(),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Ayrıştırma hatası' }, { status: 500 });
  }
}
