import { describe, expect, it } from 'vitest';
import {
  FACTOR_MAX,
  FACTOR_MIN,
  MIN_COVERAGE_FOR_GROSSUP,
  MIN_SAMPLES,
  calibrateEstimate,
  computeCalibrationFactor,
  grossUpForCoverage,
  isActualAvailable,
  type CalibrationSample,
} from './fundCalibration';

/** n adet örnek üretür; her biri actual = est × ratio + gürültü. */
function samples(
  n: number,
  ratio: number,
  covered: number | null = 100,
  noise = 0,
): CalibrationSample[] {
  return Array.from({ length: n }, (_, i) => {
    const est = 0.5 + i * 0.25;
    const jitter = noise === 0 ? 0 : ((i % 5) - 2) * noise;
    return { estimated_pct: est, covered_pct: covered, actual_pct: est * ratio + jitter };
  });
}

describe('grossUpForCoverage', () => {
  it('%53 kapsam → tahmini 100/53 ile büyütür', () => {
    // Kullanıcının DFI senaryosu: kapsam %53,23
    const r = grossUpForCoverage(0.5, 53.23);
    expect(r).toBeCloseTo(0.5 * (100 / 53.23), 6);
  });

  it('%100 kapsam → değiştirmez', () => {
    expect(grossUpForCoverage(1.2, 100)).toBe(1.2);
  });

  it('kapsam yoksa (null) → değiştirmez', () => {
    expect(grossUpForCoverage(1.2, null)).toBe(1.2);
    expect(grossUpForCoverage(1.2, undefined)).toBe(1.2);
  });

  it('çok düşük kapsamda DÜZELTMEZ — 20× katsayı saçmalardı', () => {
    // %5 kapsam → 100/5 = 20× ; bu yüzden gross-up atlanır
    expect(grossUpForCoverage(0.3, 5)).toBe(0.3);
    expect(MIN_COVERAGE_FOR_GROSSUP).toBe(15);
  });

  it('eşik tam sınırda uygulanır (%15 → düzeltir)', () => {
    expect(grossUpForCoverage(1, 15)).toBeCloseTo(100 / 15, 6);
  });

  it('sonlu olmayan girdi → 0', () => {
    expect(grossUpForCoverage(Number.NaN, 50)).toBe(0);
  });
});

describe('computeCalibrationFactor', () => {
  it('yeterli örnek yoksa 1.0 döner (gürültüye uymaz)', () => {
    const r = computeCalibrationFactor(samples(3, 1.5));
    expect(r.factor).toBe(1);
    expect(r.sampleCount).toBe(3);
    expect(r.confidence).toBe('yok');
    expect(MIN_SAMPLES).toBe(5);
  });

  it('boş örneklem → 1.0, hata 0', () => {
    const r = computeCalibrationFactor([]);
    expect(r.factor).toBe(1);
    expect(r.sampleCount).toBe(0);
    expect(r.rawMeanAbsError).toBe(0);
  });

  it('sistematik 1.5× sapmayı öğrenir', () => {
    const r = computeCalibrationFactor(samples(20, 1.5));
    expect(r.factor).toBeCloseTo(1.5, 4);
    expect(r.confidence).toBe('yuksek');
  });

  it('sapma yoksa katsayı ~1.0', () => {
    const r = computeCalibrationFactor(samples(20, 1.0));
    expect(r.factor).toBeCloseTo(1.0, 4);
    expect(r.improved).toBe(false); // zaten hata 0, iyileşme yok
  });

  it('KULLANICININ ÖRNEĞİ: tahmin 0.89 → gerçekleşen 0.95 farkını kapatır', () => {
    // %6.7 sistematik düşüklük. 20 günlük geçmiş.
    const ratio = 0.95 / 0.89;
    const hist = samples(20, ratio);
    const r = computeCalibrationFactor(hist);

    expect(r.factor).toBeCloseTo(ratio, 3);
    // Düzeltme uygulanınca hata belirgin şekilde düşmeli
    expect(r.calibratedMeanAbsError).toBeLessThan(r.rawMeanAbsError);
    expect(r.improved).toBe(true);

    // Somut: 0.89 tahmini kalibre edilince 0.95'e yaklaşmalı
    const fixed = calibrateEstimate(0.89, 100, r.factor);
    expect(fixed).toBeCloseTo(0.95, 2);
  });

  it('gürültülü veride de ham hata düşer', () => {
    const r = computeCalibrationFactor(samples(30, 1.4, 100, 0.15));
    expect(r.calibratedMeanAbsError).toBeLessThan(r.rawMeanAbsError);
  });

  it('katsayı FACTOR_MIN/MAX aralığına kırpılır (aşırı uydurma koruması)', () => {
    const extreme = computeCalibrationFactor(samples(20, 50));
    expect(extreme.factor).toBe(FACTOR_MAX);

    const tiny = computeCalibrationFactor(samples(20, 0.01));
    expect(tiny.factor).toBe(FACTOR_MIN);
  });

  it('kapsam gross-up ile ÖĞRENİLEN katsayı birlikte çifte düzeltme YAPMAZ', () => {
    // actual = grossed × 1.0 ise, yani sapmanın tamamı kapsamdan geliyorsa,
    // gross-up sonrası öğrenilen katsayı ~1.0 olmalı (1.887 değil).
    const covered = 53;
    const hist: CalibrationSample[] = Array.from({ length: 20 }, (_, i) => {
      const est = 0.5 + i * 0.2;
      const grossed = est * (100 / covered);
      return { estimated_pct: est, covered_pct: covered, actual_pct: grossed };
    });
    const r = computeCalibrationFactor(hist);
    expect(r.factor).toBeCloseTo(1.0, 3);
  });

  it('est=0 olan örnekler elenir (çarpımsal model öğrenemez)', () => {
    const withZeros: CalibrationSample[] = [
      ...samples(10, 1.5),
      { estimated_pct: 0, covered_pct: 100, actual_pct: 2.5 },
    ];
    const r = computeCalibrationFactor(withZeros);
    expect(r.sampleCount).toBe(10);
  });

  it('güven seviyeleri örneklem sayısına göre artar', () => {
    expect(computeCalibrationFactor(samples(5, 1.2)).confidence).toBe('dusuk');
    expect(computeCalibrationFactor(samples(10, 1.2)).confidence).toBe('orta');
    expect(computeCalibrationFactor(samples(20, 1.2)).confidence).toBe('yuksek');
  });
});

describe('calibrateEstimate', () => {
  it('gross-up + katsayı birlikte uygulanır', () => {
    const r = calibrateEstimate(0.5, 50, 1.2);
    expect(r).toBeCloseTo(0.5 * 2 * 1.2, 6);
  });

  it('geçersiz katsayı → 1 gibi davranır (çökmez)', () => {
    expect(calibrateEstimate(1.5, 100, Number.NaN)).toBe(1.5);
    expect(calibrateEstimate(1.5, 100, 0)).toBe(1.5);
    expect(calibrateEstimate(1.5, 100, -1)).toBe(1.5);
  });
});

describe('isActualAvailable — TEFAS yayım saatleri', () => {
  it('TLY/THF aynı gün 22:00 sonrası uygun', () => {
    expect(isActualAvailable('TLY', 22, false)).toBe(true);
    expect(isActualAvailable('THF', 23, false)).toBe(true);
    expect(isActualAvailable('TLY', 21, false)).toBe(false);
  });

  it('DFI ertesi gün 08:00 sonrası uygun', () => {
    expect(isActualAvailable('DFI', 8, true)).toBe(true);
    expect(isActualAvailable('DFI', 9, true)).toBe(true);
    expect(isActualAvailable('DFI', 7, true)).toBe(false);
    // aynı gün hiç uygun değil
    expect(isActualAvailable('DFI', 23, false)).toBe(false);
  });

  it('ertesi güne geçildiğinde TLY/THF daima uygun', () => {
    expect(isActualAvailable('TLY', 3, true)).toBe(true);
  });

  it('bilinmeyen fon DFI gibi temkinli davranır', () => {
    expect(isActualAvailable('XYZ', 22, false)).toBe(false);
    expect(isActualAvailable('XYZ', 8, true)).toBe(true);
  });

  it('küçük harf kod da tanınır', () => {
    expect(isActualAvailable('tly', 22, false)).toBe(true);
  });
});
