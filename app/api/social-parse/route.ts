import { NextResponse } from 'next/server';

/**
 * SOSYAL MEDYA TAHMİN AYRIŞTIRICI
 * Tweet/metin içinden: fon kodu, tahmini getiri (%), kategori ve @handle çıkarır.
 */
export async function POST(req: Request) {
  try {
    const { text, handle } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Metin gerekli' }, { status: 400 });
    }

    // 1. Bilinen fon/hisse kodları; yoksa 3-5 harfli büyük sembol
    const knownFunds = ['TLY', 'DFI', 'KGM', 'TP2', 'THF', 'GUM', 'YZG', 'MJG', 'DMG', 'GMC', 'BURCE', 'MASFN', 'SARAE', 'EKIM'];
    const fundRegex = new RegExp(`\\b(${knownFunds.join('|')})\\b`, 'i');
    const fundMatch = text.match(fundRegex);
    let fundCode = fundMatch ? fundMatch[1].toUpperCase() : 'BILINMEYEN';
    if (fundCode === 'BILINMEYEN') {
      const generic = text.match(/\b([A-Z]{3,5})\b/);
      if (generic) fundCode = generic[1];
    }

    // 2. Yüzde formatı: %0.45 / 0.45% / yüzde 0.45 / -%1.2
    const pctMatches =
      text.match(/([+-]?%?\s*\d+(?:[.,]\d+)?)\s*%/i) ||
      text.match(/%\s*([+-]?\d+(?:[.,]\d+)?)/i) ||
      text.match(/yüzde\s*([+-]?\d+(?:[.,]\d+)?)/i);

    let predictedReturnPct = 0;
    if (pctMatches) {
      predictedReturnPct = parseFloat(pctMatches[1].replace(',', '.')) || 0;
    }

    // 3. @handle tespiti (metinde @kullanici varsa)
    let predictorHandle = handle || '@sevketozhan';
    const handleMatch = text.match(/@([A-Za-z0-9_]{2,30})/);
    if (!handle && handleMatch) predictorHandle = `@${handleMatch[1]}`;

    // 4. Kategori tespiti
    let category = 'GUNLUK_GETIRI';
    const lower = text.toLowerCase();
    if (lower.includes('kap') || lower.includes('bildirim')) category = 'KAP_DUYURUSU';
    else if (lower.includes('içerik') || lower.includes('portföy dağılım')) category = 'ICERIK_DEGISIKLIGI';
    else if (lower.includes('sektör') || lower.includes('bist') || lower.includes('faiz')) category = 'SEKTOR_YORUMU';

    return NextResponse.json({
      success: true,
      parsed: {
        fundCode,
        predictedReturnPct,
        category,
        predictorHandle,
        rawText: text,
        extractedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Ayrıştırma hatası' }, { status: 500 });
  }
}
