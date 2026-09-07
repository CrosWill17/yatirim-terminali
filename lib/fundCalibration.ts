/**
 * FON TAHMİNİ KALİBRASYONU — tahmini gerçeğe yaklaştırma
 *
 * PROBLEM: computeFundPrediction yalnızca fiyatı BİLİNEN hisseleri toplar.
 * DFI'da kapsam %53 ise, kalan %47'nin katkısı sıfır sayılır ve tahmin
 * sistematik olarak sıfıra doğru BASIK çıkar. Kullanıcının örneği tam bu:
 *
 *     tahmin %0.89  →  gerçekleşen %0.95     (tahmin ~%6 düşük)
 *
 * ÇÖZÜM: iki aşamalı düzeltme.
 *
 *  (1) KAPSAM GROSS-UP (anında, veri gerektirmez)
 *      Kapsanmayan kısım da ortalama olarak aynı yönde hareket ediyorsa
 *      tahmin 100/covered kadar büyütülmelidir. %53 kapsam → ×1.887.
 *      Bu bir varsayım ama SIFIR varsayımından (şu anki durum) kesinlikle iyi.
 *
 *  (2) ÖĞRENİLEN KATSAYI (fund_nav_daily geçmişinden)
 *      f = Σ(est·actual) / Σ(est²)  — orijinden geçen en küçük kareler.
 *      Bu, (1) dahil tüm sistematik sapmaları tek sayıya toplar.
 *
 * NEDEN ÇARPIMSAL, TOPLAMSAL DEĞİL: fon getirileri oran; %0.5 tahminin
 * hatası ile %5 tahminin hatası aynı mutlak büyüklükte değil. Çarpımsal
 * model "tahmin yüzde X kadar düşük kalıyor" der, ki gözlemlenen bu.
 *
 * AŞIRI UYDURMA KORUMASI: az örneklemle öğrenilen katsayı gürültüdür.
 * MIN_SAMPLES altındaysa 1.0 döner, ve sonuç daima [FACTOR_MIN, FACTOR_MAX]
 * aralığına kırpılır.
 */

/** fund_nav_daily'den gelen, gerçekleşeni BİLİNEN bir gün. */
export interface CalibrationSample {
  estimated_pct: number;
  /** Tahminin kapsadığı ağırlık (%). gross-up için; yoksa null. */
  covered_pct: number | null;
  actual_pct: number;
}

export interface CalibrationResult {
  /** Uygulanacak çarpımsal katsayı. Yeterli veri yoksa 1. */
  factor: number;
  sampleCount: number;
  confidence: 'yok' | 'dusuk' | 'orta' | 'yuksek';
  /** Katsayı uygulanMADAN ortalama mutlak hata (pp). */
  rawMeanAbsError: number;
  /** Katsayı uygulandIktan sonra ortalama mutlak hata (pp). */
  calibratedMeanAbsError: number;
  /** Katsayı hatayı gerçekten azalttı mı? Azaltmadıysa UI bunu söylemeli. */
  improved: boolean;
}

/** Bu sayının altında öğrenilmiş katsayı GÜVENİLMEZ → 1.0 döner. */
export const MIN_SAMPLES = 5;
export const FACTOR_MIN = 0.5;
export const FACTOR_MAX = 3.0;

/**
 * Kapsam gross-up'ı: %53 kapsamalı tahmini %100'e ölçekler.
 *
 * coveredPct çok küçükse (ör. %5) katsayı 20'ye fırlar ve tahmin saçmalar.
 * Bu yüzden MIN_COVERAGE_FOR_GROSSUP altında düzeltme YAPILMAZ — "hiçbir
 * şey bilmemek", "çok az şeyden çok fazla şey çıkarmak"tan iyidir.
 */
export const MIN_COVERAGE_FOR_GROSSUP = 15;

export function grossUpForCoverage(
  estimatedPct: number,
  coveredPct: number | null | undefined,
): number {
  if (!Number.isFinite(estimatedPct)) return 0;
  const c = Number(coveredPct);
  if (!Number.isFinite(c) || c < MIN_COVERAGE_FOR_GROSSUP || c >= 100) return estimatedPct;
  return estimatedPct * (100 / c);
}

function meanAbs(pairs: ReadonlyArray<readonly [number, number]>): number {
  if (pairs.length === 0) return 0;
  const total = pairs.reduce((s, [pred, act]) => s + Math.abs(pred - act), 0);
  return total / pairs.length;
}

/**
 * Geçmişten çarpımsal katsayı öğrenir.
 *
 * Örneklem önce gross-up'tan geçirilir: katsayı, gross-up'tan ARTA KALAN
 * sapmayı ölçmeli. Yoksa kapsam düzeltmesi iki kez uygulanmış olur.
 */
export function computeCalibrationFactor(
  samples: readonly CalibrationSample[],
): CalibrationResult {
  const usable = samples.filter(
    (s) =>
      Number.isFinite(s.estimated_pct) &&
      Number.isFinite(s.actual_pct) &&
      s.estimated_pct !== 0, // est=0 ise çarpımsal model hiçbir şey öğrenemez
  );

  const empty: CalibrationResult = {
    factor: 1,
    sampleCount: usable.length,
    confidence: 'yok',
    rawMeanAbsError: meanAbs(usable.map((s) => [s.estimated_pct, s.actual_pct])),
    calibratedMeanAbsError: meanAbs(usable.map((s) => [s.estimated_pct, s.actual_pct])),
    improved: false,
  };
  if (usable.length < MIN_SAMPLES) return empty;

  const grossed = usable.map((s) => ({
    est: grossUpForCoverage(s.estimated_pct, s.covered_pct),
    act: s.actual_pct,
  }));

  // f = Σ(est·act) / Σ(est²)  — orijinden geçen en küçük kareler.
  let num = 0;
  let den = 0;
  for (const { est, act } of grossed) {
    num += est * act;
    den += est * est;
  }
  if (den === 0 || !Number.isFinite(num / den)) return empty;

  const raw = num / den;
  const factor = Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));

  const rawErr = meanAbs(grossed.map(({ est, act }) => [est, act] as const));
  const calErr = meanAbs(grossed.map(({ est, act }) => [est * factor, act] as const));

  const confidence: CalibrationResult['confidence'] =
    usable.length >= 20 ? 'yuksek' : usable.length >= 10 ? 'orta' : 'dusuk';

  return {
    factor: Number(factor.toFixed(5)),
    sampleCount: usable.length,
    confidence,
    rawMeanAbsError: Number(rawErr.toFixed(4)),
    calibratedMeanAbsError: Number(calErr.toFixed(4)),
    improved: calErr < rawErr,
  };
}

/**
 * Bugünün tahminini üretir: ham tahmin → gross-up → öğrenilen katsayı.
 * UI'daki "anlık tahmin" alanı bunu gösterir.
 */
export function calibrateEstimate(
  rawEstimatedPct: number,
  coveredPct: number | null | undefined,
  factor: number,
): number {
  const grossed = grossUpForCoverage(rawEstimatedPct, coveredPct);
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return grossed * f;
}

/**
 * Dünün gerçekleşenini backfill etmeli miyiz?
 *
 * Kullanıcının verdiği yayım saatleri:
 *   TLY, THF → aynı gün ~22:00
 *   DFI      → ertesi gün ~08:00
 *
 * `hourIstanbul` Europe/Istanbul saati (0-23), `isNextDay` ise kayıt gününden
 * bir sonraki güne geçilip geçilmediği.
 */
export function isActualAvailable(
  fundCode: string,
  hourIstanbul: number,
  isNextDay: boolean,
): boolean {
  const code = String(fundCode ?? '').trim().toUpperCase();
  // Sabit liste bilinçli: üç fon için davranış farklı ve kullanıcı verdi.
  // Listedeki dışı fonlar DFI gibi temkinli varsayılır (ertesi sabah).
  if (code === 'TLY' || code === 'THF') return hourIstanbul >= 22 || isNextDay;
  return isNextDay && hourIstanbul >= 8;
}
