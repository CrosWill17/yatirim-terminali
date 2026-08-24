import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { text, handle } = await req.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Metin gerekli' }, { status: 400 });
    }

    // 1. Bilinen Fon Kodları veya 3-5 harfli büyük harf semboller
    const knownFunds = ['TLY', 'DFI', 'KGM', 'TP2', 'THF', 'GUM', 'YZG', 'MJG', 'DMG', 'GMC', 'BURCE', 'MASFN', 'SARAE', 'EKIM'];
    const fundRegex = new RegExp(`\\b(${knownFunds.join('|')})\\b`, 'i');
    const fundMatch = text.match(fundRegex);
    const fundCode = fundMatch ? fundMatch[1].toUpperCase() : 'BILINMEYEN';

    // 2. Yüzde Formatı Tespiti (%0.45, 0.45%, yüzde 0.45, -%1.2 vb.)
    // "KAPATACAK" gibi kelime tuzaklarından kaçınan regex
    const pctRegex = /(?:%|yüzde\s*)?\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:%|yüzde)?/i;
    const pctMatches = text.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/i) || text.match(/%\s*([+-]?\d+(?:[.,]\d+)?)/i);

    let predictedReturnPct = 0;
    if (pctMatches) {
      predictedReturnPct = parseFloat(pctMatches[1].replace(',', '.'));
    }

    // Kategori Tespiti
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
        predictorHandle: handle || '@sevketozhan',
        rawText: text,
        extractedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Ayrıştırma hatası' }, { status: 500 });
  }
}
