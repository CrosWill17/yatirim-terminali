/**
 * calibrateWeights — Gölge Portföy Kalibrasyon Motoru (Modül 1)
 * 
 * Amaç: Dünkü TEFAS gerçek getirisi (G_gercek) ile sistemin tahmini (P_getiri)
 * arasındaki sapma Δ'yı kapatacak en mantıklı ağırlık senaryosunu bul.
 * 
 * Matematiksel Yaklaşım (detaylı):
 * 
 * 1. Tahmin Formülü:
 *    P_getiri = Σ_i (W_i_old * R_i) / 100
 *    W_i_old: dünkü eski ağırlık (%), R_i: hissenin dünkü getirisi (%)
 *    Örn: THYAO %5 ağırlık, dün %+2 → katkı 0.1 pp
 * 
 * 2. Sapma:
 *    Δ = G_gercek - P_getiri
 *    Δ > 0 → fon tahminimizden iyi → yönetici iyi hisseleri artırmış veya kötüleri azaltmış
 *    Δ < 0 → fon kötü → tersi
 * 
 * 3. Ağırlık Kaydırma Matematiği:
 *    Bir hisse j'den k'ye x% kaydırırsak (toplam 100 sabit):
 *    Yeni P' = P + x*(R_k - R_j)/100
 *    Yani Δ'yı kapatmak için gereken kaydırma:
 *    x = Δ * 100 / (R_k - R_j)
 *    Bu, tek bir trade ile Δ'yı açıklama formülü.
 * 
 * 4. Optimizasyon Problemi:
 *    Minimize: Σ |dW_i|  (toplam devir, L1 norm — yönetici az trade yapar)
 *    Subject to:
 *      Σ(dW_i * R_i) = Δ*100  (Δ'yı açıkla)
 *      Σ dW_i = 0  (nakit sabit ise) veya Σ W'_i = 100
 *      0 ≤ W'_i ≤ maxSingle (SPK %10)
 *      |dW_i| ≤ maxDailyTurnover (günlük plausibility)
 * 
 *    Bu lineer programlama, ama Vercel serverless'te ağır solver yok.
 *    Heuristik greedy çözüm:
 *      - R_i'ye göre hisseleri sırala (en kötü → en iyi)
 *      - Δ>0 ise en kötüden en iyiye kaydır, Δ<0 ise tersi
 *      - Her adımda max kaydırılabilir miktarı hesapla (SPK + mevcut ağırlık limiti)
 *      - Δ residual bitene kadar devam
 * 
 * 5. Yeni Hisse Girişi:
 *    Eğer Δ, mevcut hisselerle açıklanamıyorsa (residual > epsilon),
 *    yönetici dün listede olmayan yeni bir hisse almış olabilir.
 *    stockPerformances içinde oldWeights'te olmayan ama dün çok iyi performans
 *    gösteren ticker'ları aday olarak al, en iyisinden nakit veya en kötüden
 *    kaydırarak %1-3 yeni giriş yap.
 * 
 * 6. Nakit/VİOP:
 *    Nakit R=0 varsayılır. Eğer Δ pozitif ve tüm hisseler negatif ise,
 *    nakit azaltılıp hisse artırılmış olabilir. Bu durumda toplam hisse ağırlığı
 *    artar, nakit azalır. Bizim modelde toplam hisse 100'e normalize edilir,
 *    nakit implicit.
 * 
 * Float Hassasiyeti:
 *   - Tüm ağırlıklar 4 ondalık (0.0001% = 1bp) yuvarlanır
 *   - Toplama hatası için epsilon 0.001% tolerans
 *   - Hesaplamalar Number (IEEE 754 double) ama toFixed(4) ile stabilize
 */

import type {
  FundWeight,
  StockPerformance,
  CalibrationResult,
  CalibrationConfig,
  WeightAdjustment,
} from './types';
import { DEFAULT_CALIBRATION_CONFIG } from './types';
import { validateWeights, normalizeWeightsTo100 } from './validateWeights';

/** Eski ağırlıklarla dünkü tahmini getiriyi hesapla: Σ(W_i * R_i)/100 */
function computePredictedReturn(
  weights: FundWeight[],
  performances: StockPerformance[]
): number {
  const perfMap = new Map<string, number>();
  for (const p of performances) {
    perfMap.set(p.ticker.toUpperCase(), p.changePct);
  }

  let total = 0;
  for (const w of weights) {
    const r = perfMap.get(w.ticker.toUpperCase());
    if (r != null && Number.isFinite(r)) {
      total += w.weightPct * r;
    }
    // fiyatı olmayan hisse katkı 0 — uydurma yok
  }
  return total / 100; // % cinsinden getiri, örn. 1.23
}

/** Performans map'ini hazırla, eksik ticker'ları logla */
function buildPerfMap(performances: StockPerformance[]): Map<string, StockPerformance> {
  const map = new Map<string, StockPerformance>();
  for (const p of performances) {
    if (!p.ticker) continue;
    map.set(p.ticker.toUpperCase(), p);
  }
  return map;
}

/**
 * Ana kalibrasyon fonksiyonu — Modül 1'in kalbi
 *
 * @param oldWeights - Dün sabahki kalibre edilmiş ağırlıklar (W_i_old)
 * @param actualReturn - TEFAS'tan dünün gerçek fon getirisi G_gercek (%)
 * @param stockPerformances - Dünkü hisse performansları R_i (BIST)
 * @param config - Opsiyonel config override
 * @returns CalibrationResult — yeni ağırlıklar + açıklamalar
 */
export function calibrateWeights(
  oldWeights: FundWeight[],
  actualReturn: number,
  stockPerformances: StockPerformance[],
  config: Partial<CalibrationConfig> = {}
): CalibrationResult {
  const cfg: CalibrationConfig = { ...DEFAULT_CALIBRATION_CONFIG, ...config };
  const notes: string[] = [];
  const adjustments: WeightAdjustment[] = [];

  // 0. Validasyon — girişler
  if (oldWeights.length === 0) {
    return {
      newWeights: [],
      oldPredictedReturnPct: 0,
      actualReturnPct: actualReturn,
      deltaPct: actualReturn,
      explainedDeltaPct: 0,
      residualDeltaPct: actualReturn,
      adjustments: [],
      confidence: 0,
      calibrated: false,
      notes: ['eski ağırlık listesi boş, kalibrasyon yapılamaz'],
    };
  }

  if (!Number.isFinite(actualReturn)) {
    return {
      newWeights: oldWeights,
      oldPredictedReturnPct: 0,
      actualReturnPct: actualReturn,
      deltaPct: 0,
      explainedDeltaPct: 0,
      residualDeltaPct: 0,
      adjustments: [],
      confidence: 0,
      calibrated: false,
      notes: [`actualReturn NaN/Infinity: ${actualReturn}`],
    };
  }

  const perfMap = buildPerfMap(stockPerformances);

  // 1. Eski tahmini hesapla
  const oldPredicted = computePredictedReturn(oldWeights, stockPerformances);
  const delta = actualReturn - oldPredicted;

  notes.push(
    `Eski tahmin P=${oldPredicted.toFixed(4)}% , Gerçek G=${actualReturn.toFixed(4)}% , Δ=${delta.toFixed(4)}%`
  );

  // 2. Eşik kontrolü — |Δ| ≤ %0.1 ise kalibrasyon yok
  if (Math.abs(delta) <= cfg.deltaThresholdPct) {
    notes.push(`|Δ|=%${Math.abs(delta).toFixed(4)} ≤ eşik %${cfg.deltaThresholdPct} → kalibrasyon atlandı (gürültü)`);
    return {
      newWeights: oldWeights.map((w) => ({ ...w, prevWeightPct: w.weightPct })),
      oldPredictedReturnPct: Number(oldPredicted.toFixed(4)),
      actualReturnPct: Number(actualReturn.toFixed(4)),
      deltaPct: Number(delta.toFixed(4)),
      explainedDeltaPct: 0,
      residualDeltaPct: Number(delta.toFixed(4)),
      adjustments: [],
      confidence: 1, // eşik altı = zaten doğru
      calibrated: false,
      notes,
    };
  }

  // 3. Çalışma kopyası — ağırlıkları mutable map yap
  //    Float hatasını önlemek için 4 ondalık tut
  const weightMap = new Map<string, FundWeight>();
  for (const w of oldWeights) {
    weightMap.set(w.ticker.toUpperCase(), {
      ...w,
      ticker: w.ticker.toUpperCase(),
      weightPct: Number(w.weightPct.toFixed(4)),
    });
  }

  // Performansları da map'e ekle, eski ağırlıkta olmayan ama dün iyi olan hisseler için aday listesi
  const existingTickers = new Set(weightMap.keys());
  const candidateNewTickers: StockPerformance[] = [];
  for (const p of stockPerformances) {
    const t = p.ticker.toUpperCase();
    if (!existingTickers.has(t) && Math.abs(p.changePct) > 1) {
      // Sadece |R|>1% olan yeni hisseler aday (gürültü değil)
      candidateNewTickers.push(p);
    }
  }
  // En iyi performanslı yeni adayları sırala
  candidateNewTickers.sort((a, b) => b.changePct - a.changePct);

  // 4. Mevcut hisseleri R_i'ye göre sırala
  //    Δ>0 ise en kötüden en iyiye kaydırma mantıklı
  //    Δ<0 ise en iyiden en kötüye
  const sortedByPerf = [...oldWeights]
    .map((w) => {
      const perf = perfMap.get(w.ticker.toUpperCase());
      return {
        weight: weightMap.get(w.ticker.toUpperCase())!,
        perf: perf?.changePct ?? 0,
      };
    })
    .sort((a, b) => a.perf - b.perf); // kötü → iyi

  let residualDelta = delta; // kapatılması gereken Δ
  let totalTurnover = 0; // toplam kaydırılan ağırlık (plausibility için)

  // Yardımcı: max kaydırılabilir miktar (SPK + mevcut)
  const maxShiftFrom = (w: FundWeight): number => {
    // Bu hisseden en fazla ne kadar azaltabiliriz? 0'a kadar
    // Ama günlük max devir limiti de var
    return Math.min(w.weightPct, cfg.maxDailyTurnoverPct);
  };
  const maxShiftTo = (w: FundWeight): number => {
    // Bu hisseye en fazla ne kadar ekleyebiliriz? SPK %10'a kadar
    return Math.max(0, cfg.maxSingleWeightPct - w.weightPct);
  };

  // 5. Greedy kaydırma döngüsü — Δ işaretine göre yön
  //    Δ>0: en kötüden (düşük R) en iyiye (yüksek R) kaydır → getiri artar
  //    Δ<0: en iyiden en kötüye kaydır → getiri azalır
  //    Formül: x = residual*100 / (R_to - R_from)
  //    x>0 ise anlamlı, yoksa pair'i değiştir
  let iterations = 0;
  const maxIterations = sortedByPerf.length * 4;

  // İki pointer: low = kötü, high = iyi
  let lowIdx = 0;
  let highIdx = sortedByPerf.length - 1;

  while (Math.abs(residualDelta) > cfg.epsilon && iterations < maxIterations) {
    iterations++;

    // Δ>0 için from=low (kötü), to=high (iyi)
    // Δ<0 için from=high (iyi), to=low (kötü) — ters yön
    const isPos = residualDelta > 0;
    const fromEntry = isPos ? sortedByPerf[lowIdx] : sortedByPerf[highIdx];
    const toEntry = isPos ? sortedByPerf[highIdx] : sortedByPerf[lowIdx];

    if (!fromEntry || !toEntry || fromEntry.weight.ticker === toEntry.weight.ticker) break;

    const rFrom = fromEntry.perf;
    const rTo = toEntry.perf;
    const rDiff = rTo - rFrom; // Δ>0 için pozitif olmalı, Δ<0 için de pozitif (çünkü from=high, to=low → rDiff negatif olur, ama residual de negatif → requiredShift pozitif)

    // Eğer rDiff işaret olarak residual ile uyumsuz ise bu pair Δ'yı kapatamaz
    // Örn: residual>0 ama rDiff<0 → x negatif olur → işe yaramaz
    if (Math.abs(rDiff) < 0.01) {
      // performans farkı yok
      if (isPos) lowIdx++;
      else highIdx--;
      if (lowIdx >= highIdx) break;
      continue;
    }

    const requiredShift = (residualDelta * 100) / rDiff;

    if (requiredShift < 0 || !Number.isFinite(requiredShift)) {
      // Yön yanlış, pointer ilerlet
      if (isPos) lowIdx++;
      else highIdx--;
      if (lowIdx >= highIdx) break;
      continue;
    }

    const wFrom = weightMap.get(fromEntry.weight.ticker)!;
    const wTo = weightMap.get(toEntry.weight.ticker)!;

    const maxFrom = maxShiftFrom(wFrom);
    const maxTo = maxShiftTo(wTo);
    const remainingTurnover = cfg.maxDailyTurnoverPct - totalTurnover;
    const maxPossible = Math.min(maxFrom, maxTo, remainingTurnover);

    if (maxPossible < cfg.minWeightPct) {
      // bu pair bitti
      if (maxFrom < cfg.minWeightPct) {
        if (isPos) lowIdx++;
        else highIdx--;
      } else {
        if (isPos) highIdx--;
        else lowIdx++;
      }
      if (lowIdx >= highIdx) break;
      continue;
    }

    const actualShift = Math.min(requiredShift, maxPossible);

    const oldFrom = wFrom.weightPct;
    const oldTo = wTo.weightPct;

    wFrom.weightPct = Number((wFrom.weightPct - actualShift).toFixed(4));
    wTo.weightPct = Number((wTo.weightPct + actualShift).toFixed(4));

    totalTurnover += actualShift;
    const explained = (actualShift * rDiff) / 100;
    residualDelta = Number((residualDelta - explained).toFixed(6));

    adjustments.push({
      ticker: `${fromEntry.weight.ticker}→${toEntry.weight.ticker}`,
      oldWeightPct: Number(oldFrom.toFixed(4)),
      newWeightPct: Number(wFrom.weightPct.toFixed(4)),
      deltaWeightPct: Number((-actualShift).toFixed(4)),
      reason: `Δ ${delta > 0 ? '+' : ''}${delta.toFixed(3)}% kapatmak için ${fromEntry.weight.ticker} (%${rFrom.toFixed(2)}) → ${toEntry.weight.ticker} (%${rTo.toFixed(2)}) ${actualShift.toFixed(2)}% kaydırma, açıklanan ${explained.toFixed(4)}%`,
    });
    adjustments.push(
      {
        ticker: fromEntry.weight.ticker,
        oldWeightPct: Number(oldFrom.toFixed(4)),
        newWeightPct: Number(wFrom.weightPct.toFixed(4)),
        deltaWeightPct: Number((-actualShift).toFixed(4)),
        reason: `kaynak`,
      },
      {
        ticker: toEntry.weight.ticker,
        oldWeightPct: Number(oldTo.toFixed(4)),
        newWeightPct: Number(wTo.weightPct.toFixed(4)),
        deltaWeightPct: Number(actualShift.toFixed(4)),
        reason: `hedef`,
      }
    );

    notes.push(
      `Iter ${iterations}: ${fromEntry.weight.ticker}→${toEntry.weight.ticker} x=${actualShift.toFixed(2)}% Rdiff=${rDiff.toFixed(2)}% → explained ${explained.toFixed(4)}% residual ${residualDelta.toFixed(4)}%`
    );

    if (Math.abs(residualDelta) <= cfg.epsilon) break;

    if (actualShift >= maxPossible - 0.0001) {
      // from veya to tükendi
      if (wFrom.weightPct <= cfg.minWeightPct + cfg.epsilon) {
        if (isPos) lowIdx++;
        else highIdx--;
      }
      if (wTo.weightPct >= cfg.maxSingleWeightPct - cfg.epsilon) {
        if (isPos) highIdx--;
        else lowIdx++;
      }
    }

    if (lowIdx >= highIdx) break;
  }

  // 6. Yeni hisse girişi denemesi (residual hala büyükse)
  if (Math.abs(residualDelta) > cfg.deltaThresholdPct && candidateNewTickers.length > 0) {
    notes.push(`Residual Δ=%${residualDelta.toFixed(4)} hala büyük, yeni hisse girişi deneniyor (${candidateNewTickers.length} aday)`);
    // En iyi yeni aday
    const bestNew = candidateNewTickers[0];
    // En kötü mevcut hisseyi bul (ondan çal)
    const worstCurrent = sortedByPerf[0];
    if (worstCurrent) {
      const wWorst = weightMap.get(worstCurrent.weight.ticker)!;
      const available = Math.min(maxShiftFrom(wWorst), cfg.maxSingleWeightPct, 3); // yeni giriş max %3
      if (available >= 1) {
        const rDiffNew = bestNew.changePct - worstCurrent.perf;
        if (Math.abs(rDiffNew) > 0.1) {
          const requiredShiftNew = (residualDelta * 100) / rDiffNew;
          const shiftNew = Math.min(requiredShiftNew, available, 3);
          if (shiftNew > 0.5) {
            // Yeni hisse ekle
            const newWeight: FundWeight = {
              ticker: bestNew.ticker.toUpperCase(),
              weightPct: Number(shiftNew.toFixed(4)),
              companyName: null,
              assetType: 'hisse',
              prevWeightPct: 0,
            };
            weightMap.set(newWeight.ticker, newWeight);
            wWorst.weightPct = Number((wWorst.weightPct - shiftNew).toFixed(4));
            const explainedNew = (shiftNew * rDiffNew) / 100;
            residualDelta = Number((residualDelta - explainedNew).toFixed(6));
            totalTurnover += shiftNew;
            adjustments.push({
              ticker: `${worstCurrent.weight.ticker}→${newWeight.ticker} (YENİ)`,
              oldWeightPct: 0,
              newWeightPct: newWeight.weightPct,
              deltaWeightPct: newWeight.weightPct,
              reason: `yeni hisse girişi ${bestNew.ticker} R=%${bestNew.changePct.toFixed(2)} ile Δ kapatma`,
            });
            notes.push(`Yeni hisse ${newWeight.ticker} %${shiftNew.toFixed(2)} eklendi, explained ${explainedNew.toFixed(4)}%`);
          }
        }
      }
    }
  }

  // 7. Son ağırlık listesini oluştur
  let newWeights: FundWeight[] = Array.from(weightMap.values())
    .filter((w) => w.weightPct >= cfg.minWeightPct - cfg.epsilon) // min altı filtre
    .map((w) => ({
      ...w,
      weightPct: Number(w.weightPct.toFixed(4)),
      prevWeightPct: oldWeights.find((ow) => ow.ticker.toUpperCase() === w.ticker.toUpperCase())?.weightPct ?? 0,
    }));

  // 8. Toplam %100'e normalize et (nakit ayarı)
  //    Neden? Kaydırma sonrası yuvarlama hatası veya yeni hisse ekleme toplamı bozabilir
  //    Normalize, ağırlıkları oransal olarak 100'e çeker
  const rawTotal = newWeights.reduce((s, w) => s + w.weightPct, 0);
  if (Math.abs(rawTotal - cfg.targetTotalWeightPct) > cfg.epsilon) {
    notes.push(`Normalize öncesi toplam %${rawTotal.toFixed(4)} → %${cfg.targetTotalWeightPct} hedefe çekiliyor`);
    newWeights = normalizeWeightsTo100(newWeights as any, cfg.targetTotalWeightPct) as FundWeight[];
  }

  // 9. Validasyon
  const validation = validateWeights(newWeights, cfg);
  if (!validation.ok) {
    notes.push(`VALIDATION HATASI: ${validation.errors.join('; ')}`);
    // Hata durumunda eski ağırlıklara dön (güvenli fallback)
    return {
      newWeights: oldWeights,
      oldPredictedReturnPct: Number(oldPredicted.toFixed(4)),
      actualReturnPct: Number(actualReturn.toFixed(4)),
      deltaPct: Number(delta.toFixed(4)),
      explainedDeltaPct: 0,
      residualDeltaPct: Number(delta.toFixed(4)),
      adjustments: [],
      confidence: 0,
      calibrated: false,
      notes: [...notes, ...validation.errors],
    };
  }
  if (validation.warnings.length > 0) {
    notes.push(...validation.warnings.map((w) => `WARN: ${w}`));
  }

  // 10. Sonuç metrikleri
  const explainedDelta = delta - residualDelta;
  const confidence = Math.min(1, Math.max(0, 1 - Math.abs(residualDelta) / (Math.abs(delta) + 0.0001)));

  notes.push(
    `Kalibrasyon bitti: Δ=%${delta.toFixed(4)} → açıklanan %${explainedDelta.toFixed(4)} residual %${residualDelta.toFixed(4)} confidence ${(confidence * 100).toFixed(1)}% turnover %${totalTurnover.toFixed(2)}`
  );

  return {
    newWeights: newWeights.sort((a, b) => b.weightPct - a.weightPct),
    oldPredictedReturnPct: Number(oldPredicted.toFixed(4)),
    actualReturnPct: Number(actualReturn.toFixed(4)),
    deltaPct: Number(delta.toFixed(4)),
    explainedDeltaPct: Number(explainedDelta.toFixed(4)),
    residualDeltaPct: Number(residualDelta.toFixed(4)),
    adjustments,
    confidence: Number(confidence.toFixed(4)),
    calibrated: Math.abs(explainedDelta) > cfg.epsilon,
    notes,
  };
}
