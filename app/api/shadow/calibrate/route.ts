/**
 * Modül 1: Günlük Toplu İşlem ve Kalibrasyon (Daily Batch & Calibration)
 * 
 * POST /api/shadow/calibrate?fundCode=TLY
 * Vercel Cron: her sabah 09:30 TRT (06:30 UTC) tetikler
 * 
 * Adımlar:
 * 1. TEFAS'tan dünün gerçek fon getirisi G_gercek çek (retry + fallback)
 * 2. DB'den dünkü eski ağırlıklar ve dünkü BIST R_i ile P_getiri hesapla
 * 3. Δ = G_gercek - P_getiri
 * 4. |Δ| > %0.1 ise calibrateWeights() → yeni W_i
 * 5. calibration_log + fund_holdings (source=calibration) yaz
 * 
 * Güvenlik: CRON_SECRET header kontrolü (Vercel Cron)
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { fetchTefasDailyReturn, getYesterdayBistDate } from '@/lib/shadowPortfolio/tefas';
import { fetchYesterdayPerformances } from '@/lib/shadowPortfolio/marketApi';
import { calibrateWeights } from '@/lib/shadowPortfolio/calibrateWeights';
import { loadLatestCalibratedWeights, saveCalibrationLog, saveTefasReturn, upsertCalibratedWeights } from '@/lib/shadowPortfolio/db';
import { DEFAULT_CALIBRATION_CONFIG } from '@/lib/shadowPortfolio/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel serverless max 60sn (hobby 10sn, pro 60sn)

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fundCode = (searchParams.get('fundCode') ?? searchParams.get('code') ?? 'TLY').toUpperCase();
  const force = searchParams.get('force') === '1';

  // Cron secret kontrolü (opsiyonel, Vercel'de CRON_SECRET set edilir)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}` && searchParams.get('secret') !== cronSecret) {
      // Vercel Cron kendi header'ını atar, ama biz ek koruma ekleyelim
      // Eğer istek Vercel Cron'dan değilse 401
      const isVercelCron = req.headers.get('x-vercel-cron') === '1';
      if (!isVercelCron) {
        return NextResponse.json({ error: 'Unauthorized (cron secret)' }, { status: 401 });
      }
    }
  }

  if (!/^[A-Z0-9]{2,10}$/.test(fundCode)) {
    return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 });
  }

  try {
    const yesterday = getYesterdayBistDate();
    const today = new Date().toISOString().slice(0, 10);

    // 1. Gerçek TEFAS getirisi G_gercek
    let tefasReturn = await fetchTefasDailyReturn(fundCode, yesterday);
    
    if (!tefasReturn) {
      // Fallback: Supabase tefas_returns son kayıt veya 0
      // Burada null ise kalibrasyon yapılamaz, logla ve çık
      return NextResponse.json({
        ok: false,
        fundCode,
        error: `TEFAS gerçek getiri alınamadı (${yesterday}), retry sonrası fallback yok — işlem atlandı`,
        yesterday,
      }, { status: 202 });
    }

    // TEFAS getirisini kaydet
    await saveTefasReturn(tefasReturn);

    // 2. Eski ağırlıklar (dün sabahki kalibre)
    const oldWeights = await loadLatestCalibratedWeights(fundCode);
    if (!oldWeights || oldWeights.length === 0) {
      return NextResponse.json({
        ok: false,
        fundCode,
        error: `Eski ağırlık yok (fund_holdings boş), önce KAP PDF yükle`,
        yesterday,
      }, { status: 404 });
    }

    // 3. Dünkü BIST performansları R_i
    const tickers = oldWeights.map((w) => w.ticker);
    const yesterdayPerfs = await fetchYesterdayPerformances(tickers, yesterday);

    if (yesterdayPerfs.length === 0) {
      return NextResponse.json({
        ok: false,
        fundCode,
        error: `Dünkü BIST performansları alınamadı (${yesterday})`,
        yesterday,
      }, { status: 202 });
    }

    // 4. Kalibrasyon
    const result = calibrateWeights(
      oldWeights,
      tefasReturn.returnPct,
      yesterdayPerfs,
      DEFAULT_CALIBRATION_CONFIG
    );

    // 5. DB yaz — sadece kalibre edildiyse veya force=1
    if (result.calibrated || force) {
      await upsertCalibratedWeights(fundCode, result.newWeights, today);
      await saveCalibrationLog({
        fund_code: fundCode,
        calibration_date: today,
        yesterday_date: yesterday,
        old_predicted_return_pct: result.oldPredictedReturnPct,
        actual_return_pct: result.actualReturnPct,
        delta_pct: result.deltaPct,
        explained_delta_pct: result.explainedDeltaPct,
        residual_delta_pct: result.residualDeltaPct,
        confidence: result.confidence,
        total_turnover_pct: result.adjustments.reduce((s, a) => s + Math.abs(a.deltaWeightPct), 0) / 2,
        new_weights: result.newWeights,
        adjustments: result.adjustments,
        notes: result.notes,
      });
    }

    return NextResponse.json({
      ok: true,
      fundCode,
      yesterday,
      today,
      ...result,
      tefasSource: tefasReturn.source,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shadow/calibrate] ${fundCode} hatası:`, msg);
    return NextResponse.json({ error: `Kalibrasyon hatası: ${msg}` }, { status: 500 });
  }
}

// GET de aynı işi yapsın (Vercel Cron GET ile tetikler)
export async function GET(req: NextRequest) {
  return POST(req);
}
