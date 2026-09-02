/**
 * validateWeights — Ağırlık doğrulama middleware'i
 * 
 * Matematiksel doğruluk için:
 * - Toplam ağırlık her zaman %100'e eşit olmalı (1.00) — epsilon toleransı ile
 * - Tek hisse ağırlığı SPK limiti ≤ %10
 * - Negatif ağırlık yok, NaN/Infinity yok
 * - Min etki filtresi %0.01 altı uyarı (ama hata değil)
 * 
 * Vercel serverless'te her upsert öncesi çağrılır.
 */

import type { FundWeight, CalibrationConfig } from './types';

export interface ValidationResult {
  ok: boolean;
  totalWeightPct: number;
  errors: string[];
  warnings: string[];
}

/**
 * Ağırlık listesini doğrular.
 * 
 * @param weights - FundWeight[] listesi
 * @param config - Kalibrasyon config (maxSingle, epsilon vs)
 * @returns ValidationResult — ok false ise DB'ye yazma
 */
export function validateWeights(
  weights: FundWeight[],
  config: Pick<CalibrationConfig, 'maxSingleWeightPct' | 'minWeightPct' | 'targetTotalWeightPct' | 'epsilon'>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (weights.length === 0) {
    return { ok: false, totalWeightPct: 0, errors: ['ağırlık listesi boş'], warnings: [] };
  }

  let total = 0;
  const seen = new Set<string>();

  for (const w of weights) {
    // Tip güvenliği
    if (!w.ticker || typeof w.ticker !== 'string') {
      errors.push(`geçersiz ticker: ${JSON.stringify(w.ticker)}`);
      continue;
    }
    const ticker = w.ticker.toUpperCase();

    if (seen.has(ticker)) {
      errors.push(`duplicate ticker: ${ticker}`);
    }
    seen.add(ticker);

    // Sayı kontrolleri — float/decimal sorunlarını yakala
    if (!Number.isFinite(w.weightPct)) {
      errors.push(`${ticker}: weightPct NaN/Infinity (${w.weightPct})`);
      continue;
    }
    if (w.weightPct < 0) {
      errors.push(`${ticker}: negatif ağırlık %${w.weightPct}`);
    }
    if (w.weightPct > config.maxSingleWeightPct + config.epsilon) {
      errors.push(
        `${ticker}: SPK limiti aşımı %${w.weightPct.toFixed(4)} > %${config.maxSingleWeightPct} (tek hisse max)`
      );
    }
    if (w.weightPct > 0 && w.weightPct < config.minWeightPct) {
      warnings.push(`${ticker}: min etki altı %${w.weightPct.toFixed(4)} < %${config.minWeightPct} (filtrelenebilir)`);
    }

    total += w.weightPct;
  }

  // Toplam %100 kontrolü — epsilon toleransı ile
  // Neden epsilon? Float toplama hatası: 0.1 + 0.2 !== 0.3
  // Çözüm: total'i 1e-4 hassasiyetle yuvarla ve epsilon ile karşılaştır
  const totalRounded = Number(total.toFixed(4));
  const diff = Math.abs(totalRounded - config.targetTotalWeightPct);

  if (diff > config.epsilon) {
    // Eğer nakit/VİOP hesaba katılmıyorsa toplam <100 olabilir — bu durumda uyarı, hata değil
    // Ama hisse senedi yoğun fon (THF) için 95-100 arası beklenir, serbest fon (TLY) için 80-100
    if (totalRounded < 50) {
      errors.push(`toplam ağırlık çok düşük %${totalRounded.toFixed(4)} < %50 (parse hatası olabilir)`);
    } else if (totalRounded > 100.5) {
      errors.push(`toplam ağırlık %${totalRounded.toFixed(4)} > %100.5 (aşım)`);
    } else {
      warnings.push(
        `toplam ağırlık %${totalRounded.toFixed(4)} ≠ %${config.targetTotalWeightPct} (fark %${diff.toFixed(4)}, nakit/VİOP farkı olabilir)`
      );
    }
  }

  return {
    ok: errors.length === 0,
    totalWeightPct: totalRounded,
    errors,
    warnings,
  };
}

/**
 * Ağırlıkları %100'e normalize eder (nakit ayarı).
 * 
 * Kullanım: kalibrasyon sonrası toplam 99.8 ise kalan 0.2'yi nakit'e ekle
 * veya tüm hisselere oransal dağıt.
 * 
 * @param weights - mevcut ağırlıklar
 * @param target - hedef toplam (100)
 * @returns normalize edilmiş yeni liste (orijinali değiştirmez)
 */
export function normalizeWeightsTo100(
  weights: FundWeight[],
  target = 100
): FundWeight[] {
  const total = weights.reduce((s, w) => s + w.weightPct, 0);
  if (total === 0) return weights;

  const factor = target / total;
  return weights.map((w) => ({
    ...w,
    weightPct: Number((w.weightPct * factor).toFixed(4)),
  }));
}
