/**
 * Gün sonu (18:20) snapshot'ını HESAPLAYAN saf mantık.
 *
 * Neden ayrı dosya: scripts/fund_holdings/day-end.ts (cron) ve ileride eklenecek
 * istemci tetikleyicisi aynı kararı vermeli. Supabase I/O'su burada YOK — bu
 * sayede gerçek veritabanı olmadan birim testle doğrulanabiliyor.
 *
 * AKIŞ (fon başına):
 *   1. computeFundPrediction  → ham tahmin + kapsam
 *   2. computeCalibrationFactor → geçmişten öğrenilen katsayı
 *   3. calibrateEstimate      → düzeltilmiş tahmin (kayıt edilecek değer)
 *   4. shouldTakeDayEndSnapshot → yazılacak mı?
 */
import { computeFundPrediction, type FundHolding, type HoldingPrice } from './fundHoldings';
import { calibrateEstimate, computeCalibrationFactor } from './fundCalibration';
import { istanbulDateStr, shouldTakeDayEndSnapshot, type DayEndDecision } from './dayEnd';
import type { FundNavDailyRow } from './types';

export interface DayEndFundInput {
  fundCode: string;
  holdings: FundHolding[];
}

export interface DayEndDraft {
  fund_code: string;
  nav_date: string;
  /** Kalibre edilmiş tahmin — fund_nav_daily.estimated_pct */
  estimated_pct: number;
  covered_pct: number;
  /** Bu satır yazılırken uygulanan katsayı (geriye dönük değerlendirme için). */
  calib_factor: number;
}

export interface DayEndPlanItem {
  fundCode: string;
  decision: DayEndDecision;
  /** decision.run === true ise dolu. */
  draft: DayEndDraft | null;
  /** Karar verilirken kullanılan ham değerler — log/teşhis için. */
  raw: {
    predictedPct: number | null;
    coveredPct: number | null;
    factor: number;
    calibratedPct: number | null;
    historySamples: number;
  };
}

export interface DayEndPlan {
  navDate: string;
  toWrite: DayEndPlanItem[];
  skipped: DayEndPlanItem[];
}

/**
 * Fon listesi + fiyatlar + geçmiş → yazılacak satırlar.
 *
 * `now` enjekte edilebilir: testler saati sabitler, üretim `new Date()` kullanır.
 */
export function buildDayEndPlan(
  funds: DayEndFundInput[],
  prices: Record<string, HoldingPrice | null>,
  navHistory: FundNavDailyRow[],
  now: Date = new Date(),
): DayEndPlan {
  const navDate = istanbulDateStr(now);

  // Geçmişi fon bazında grupla; katsayı yalnız gerçekleşeni BİLİNEN günlerden öğrenilir.
  const historyByFund = new Map<string, FundNavDailyRow[]>();
  for (const r of navHistory) {
    const list = historyByFund.get(r.fund_code) ?? [];
    list.push(r);
    historyByFund.set(r.fund_code, list);
  }

  const toWrite: DayEndPlanItem[] = [];
  const skipped: DayEndPlanItem[] = [];

  for (const f of funds) {
    const pred = computeFundPrediction(f.fundCode, f.holdings, prices);
    const history = historyByFund.get(f.fundCode) ?? [];

    const cal = computeCalibrationFactor(
      history
        .filter((r) => r.estimated_pct != null && r.actual_pct != null)
        .map((r) => ({
          estimated_pct: r.estimated_pct as number,
          covered_pct: r.covered_pct,
          actual_pct: r.actual_pct as number,
        })),
    );

    const calibrated =
      pred.predictedPct != null && Number.isFinite(pred.predictedPct)
        ? calibrateEstimate(pred.predictedPct, pred.coveredPct, cal.factor)
        : null;

    const hasSnapshotToday = history.some((r) => r.nav_date === navDate);

    const decision = shouldTakeDayEndSnapshot({
      now,
      hasSnapshotToday,
      estimatedPct: calibrated,
      coveredPct: pred.coveredPct,
    });

    const raw = {
      predictedPct: pred.predictedPct,
      coveredPct: pred.coveredPct,
      factor: cal.factor,
      calibratedPct: calibrated,
      historySamples: cal.sampleCount,
    };

    const item: DayEndPlanItem = {
      fundCode: f.fundCode,
      decision,
      raw,
      draft:
        decision.run && calibrated != null
          ? {
              fund_code: f.fundCode,
              nav_date: navDate,
              // NUMERIC(9,4) — 4 basamağa yuvarla, DB'nin yapacağı yuvarlamayla aynı.
              estimated_pct: Number(calibrated.toFixed(4)),
              covered_pct: Number(pred.coveredPct.toFixed(4)),
              calib_factor: Number(cal.factor.toFixed(5)),
            }
          : null,
    };

    if (item.draft) toWrite.push(item);
    else skipped.push(item);
  }

  return { navDate, toWrite, skipped };
}
