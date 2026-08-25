import { describe, it, expect } from 'vitest';
import {
  calculateGramGold,
  calculateGoldSilverRatio,
  calculateTax,
  calculateAccuracyScore,
  updateTrustScore,
  blendForecast,
  calculateRealReturn,
} from './calculations';

describe('calculateGramGold', () => {
  it('ons + USD/TRY ile gram altını hesaplar', () => {
    // 4615.80 $ / 31.1034768 * 48.0987 ≈ 7143.6
    const gram = calculateGramGold(4615.8, 48.0987);
    expect(gram).toBeGreaterThan(7100);
    expect(gram).toBeLessThan(7160);
  });

  it('girdi eksikse 0 döner', () => {
    expect(calculateGramGold(0, 48)).toBe(0);
    expect(calculateGramGold(4615, 0)).toBe(0);
  });
});

describe('calculateGoldSilverRatio', () => {
  it('rasyo 70 altındaysa gümüş pahalıdır', () => {
    const r = calculateGoldSilverRatio(4615.8, 67.84);
    expect(r.status).toBe('GUMUS_PAHALI');
    expect(r.ratio).toBeCloseTo(68.04, 1);
  });

  it('rasyo 85 üstündeyse gümüş ucuzdur', () => {
    const r = calculateGoldSilverRatio(3300, 38);
    expect(r.status).toBe('GUMUS_UCUZ');
  });

  it('70-85 arası dengededir', () => {
    const r = calculateGoldSilverRatio(3200, 40);
    expect(r.status).toBe('DENGEDE');
  });

  it('veri yoksa güvenli düşer', () => {
    const r = calculateGoldSilverRatio(0, 40);
    expect(r.ratio).toBe(0);
    expect(r.interpretation).toBe('Veri yok');
  });
});

describe('calculateTax', () => {
  it('BIST hissesinde stopaj %0', () => {
    const t = calculateTax('BIST_HISSE', 'BURCE', 1000, 1500);
    expect(t.taxRate).toBe(0);
    expect(t.taxAmount).toBe(0);
    expect(t.profit).toBe(500);
  });

  it('TEFAS fonunda stopaj %17.5', () => {
    const t = calculateTax('TEFAS_FON', 'TLY', 1000, 1500);
    expect(t.taxRate).toBe(0.175);
    expect(t.taxAmount).toBeCloseTo(87.5);
    expect(t.netRevenue).toBeCloseTo(1412.5);
  });

  it('zararda vergi kesilmez', () => {
    const t = calculateTax('TEFAS_FON', 'TLY', 1000, 900);
    expect(t.profit).toBe(0);
    expect(t.taxAmount).toBe(0);
  });

  it('THF (hisse yoğun fon) stopajsızdır', () => {
    const t = calculateTax('TEFAS_FON', 'THF', 1000, 1500);
    expect(t.taxRate).toBe(0);
  });
});

describe('calculateAccuracyScore', () => {
  it('fark 0.05 altı → 100', () => expect(calculateAccuracyScore(0.45, 0.44)).toBe(100));
  it('fark 0.10 altı → 80', () => expect(calculateAccuracyScore(0.5, 0.58)).toBe(80));
  it('fark 0.20 altı → 60', () => expect(calculateAccuracyScore(0.5, 0.68)).toBe(60));
  it('fark 0.50 altı → 30', () => expect(calculateAccuracyScore(0.5, 0.95)).toBe(30));
  it('fark 0.50 ve üstü → 0', () => expect(calculateAccuracyScore(0.5, 1.2)).toBe(0));
});

describe('updateTrustScore', () => {
  it('0.7 × eski + 0.3 × isabet uygular', () => {
    // 0.7 × 78.5 + 0.3 × 100 = 54.95 + 30 = 84.95
    expect(updateTrustScore(78.5, 100)).toBeCloseTo(84.95, 2);
  });
  it('0 ve 100 aralığında sınırlar', () => {
    expect(updateTrustScore(99, 0)).toBeLessThan(99);
    expect(updateTrustScore(0, 100)).toBeCloseTo(30);
  });
});

describe('blendForecast', () => {
  it('0.6 model + 0.4 benchmark', () => {
    expect(blendForecast(1.0, 0.5)).toBeCloseTo(0.8);
  });
});

describe('calculateRealReturn', () => {
  it('Fisher denklemiyle reel getiriyi hesaplar', () => {
    // %40 nominal, %30 enflasyon → 1.4/1.3 - 1 ≈ %7.69
    expect(calculateRealReturn(40, 30)).toBeCloseTo(7.69, 1);
  });
  it('sıfır enflasyonda nominali döndürür', () => {
    expect(calculateRealReturn(10, 0)).toBe(10);
  });
});
