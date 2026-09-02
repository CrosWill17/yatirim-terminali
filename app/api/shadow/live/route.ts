/**
 * Modül 2: İstek Üzerine Canlı Hesaplama (On-Demand Live Engine)
 * 
 * GET /api/shadow/live?fundCode=TLY
 * 
 * Akış:
 * 1. DB'den sabah kalibre edilmiş ağırlıklar W_i (calibration_log veya fund_holdings source=calibration/kap-pdf)
 * 2. BIST canlı R_i (app/api/market/quotes)
 * 3. Toplam Getiri = Σ(W_i * R_i) + nakit/VİOP
 * 4. JSON dön
 * 
 * Vercel serverless: hızlı, cache 30sn, retry yok (istek üzerine)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { loadLatestCalibratedWeights } from '@/lib/shadowPortfolio/db';
import { computeFundPrediction } from '@/lib/fundHoldings';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fundCode = (searchParams.get('fundCode') ?? searchParams.get('code') ?? 'TLY').toUpperCase();

  if (!/^[A-Z0-9]{2,10}$/.test(fundCode)) {
    return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 });
  }

  try {
    // 1. Kalibre edilmiş ağırlıklar
    const weights = await loadLatestCalibratedWeights(fundCode);
    if (!weights || weights.length === 0) {
      return NextResponse.json(
        { error: `Fon ${fundCode} için kalibre edilmiş ağırlık yok (önce /api/shadow/calibrate çalıştır)` },
        { status: 404 }
      );
    }

    // 2. Canlı fiyatlar — market quotes API'mizi çağır (server-side fetch)
    //    Vercel'de internal fetch, 60sn cache'li
    const tickers = weights.map((w) => w.ticker);
    const baseUrl = req.nextUrl.origin;
    const quotesUrl = `${baseUrl}/api/market/quotes?symbols=${tickers.join(',')}`;

    let liveMap: Record<string, { changePct: number; price: number }> = {};
    try {
      const res = await fetch(quotesUrl, { next: { revalidate: 30 } });
      if (res.ok) {
        const json = await res.json();
        liveMap = json.quotes ?? json ?? {};
      }
    } catch {
      // canlı veri alınamazsa missing olarak raporlanır
    }

    // 3. Hesaplama: Σ(W_i * R_i)
    const holdings = weights.map((w) => ({
      ticker: w.ticker,
      name: w.companyName ?? null,
      weightPct: w.weightPct,
      prevWeightPct: w.prevWeightPct ?? null,
    }));

    const prices: Record<string, { price: number; changePct: number } | null> = {};
    for (const w of weights) {
      const q = liveMap[w.ticker.toUpperCase()];
      if (q && Number.isFinite(q.changePct)) {
        prices[w.ticker.toUpperCase()] = { price: Number(q.price ?? 0), changePct: Number(q.changePct) };
      } else {
        prices[w.ticker.toUpperCase()] = null;
      }
    }

    const prediction = computeFundPrediction(fundCode, holdings, prices);

    // 4. JSON dön
    return NextResponse.json({
      ok: true,
      fundCode,
      totalReturnPct: prediction.predictedPct != null ? Number(prediction.predictedPct.toFixed(4)) : null,
      coveredWeightPct: Number(prediction.coveredPct.toFixed(2)),
      contributions: prediction.contributions.map((c) => ({
        ticker: c.ticker,
        weightPct: Number(c.weightPct.toFixed(2)),
        changePct: Number(c.changePct.toFixed(2)),
        impactPct: Number(c.impactPct.toFixed(4)),
      })),
      missingTickers: prediction.missingTickers,
      weightCount: weights.length,
      calculatedAt: new Date().toISOString(),
      source: 'shadow-live-engine',
      // Vercel cache header
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Canlı hesaplama hatası: ${msg}` }, { status: 500 });
  }
}
