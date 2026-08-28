import { NextResponse } from 'next/server';
import { parseSocialTweet } from '@/lib/parseSocial';

/**
 * SOSYAL MEDYA TAHMİN AYRIŞTIRICI (UI — elle yapıştırılan metin)
 * Ayrıştırma mantığının TEK KAYNAĞI: lib/parseSocial.ts
 * (GitHub Actions twitter-sync hattı ile aynı modülü kullanır.)
 */
export async function POST(req: Request) {
  try {
    const { text, handle } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Metin gerekli' }, { status: 400 });
    }

    const parsed = parseSocialTweet(text);
    const predictorHandle =
      handle || parsed.predictorHandle || (parsed.fundCode ? '@sevketozhan' : '@sevketozhan');

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
