import { describe, it, expect } from 'vitest';
import { calibrateWeights } from './calibrateWeights';
import type { FundWeight, StockPerformance } from './types';

const oldWeights: FundWeight[] = [
  { ticker: 'THYAO', weightPct: 10 },
  { ticker: 'ASELS', weightPct: 10 },
  { ticker: 'KCHOL', weightPct: 10 },
  { ticker: 'AKBNK', weightPct: 10 },
  { ticker: 'BIMAS', weightPct: 10 },
  { ticker: 'EREGL', weightPct: 10 },
  { ticker: 'TUPRS', weightPct: 10 },
  { ticker: 'SISE', weightPct: 10 },
  { ticker: 'SAHOL', weightPct: 10 },
  { ticker: 'YKBNK', weightPct: 10 },
];

const performances: StockPerformance[] = [
  { ticker: 'THYAO', changePct: 2, date: '2026-09-01' },
  { ticker: 'ASELS', changePct: 1, date: '2026-09-01' },
  { ticker: 'KCHOL', changePct: -1, date: '2026-09-01' },
  { ticker: 'AKBNK', changePct: 0.5, date: '2026-09-01' },
  { ticker: 'BIMAS', changePct: -0.5, date: '2026-09-01' },
  { ticker: 'EREGL', changePct: 3, date: '2026-09-01' },
  { ticker: 'TUPRS', changePct: -2, date: '2026-09-01' },
  { ticker: 'SISE', changePct: 1.5, date: '2026-09-01' },
  { ticker: 'SAHOL', changePct: 0, date: '2026-09-01' },
  { ticker: 'YKBNK', changePct: 0.8, date: '2026-09-01' },
];

describe('calibrateWeights', () => {
  it('eşik altı Δ → kalibrasyon yok', () => {
    // oldPredicted = Σ(W*R)/100 = (10*2 +10*1 +10*-1 +...)/100
    // Hesap: 2+1-1+0.5-0.5+3-2+1.5+0+0.8 =5.3 /10? Wait weight 10% each → sum =10*... /100 = (20+10-10+5-5+30-20+15+0+8)/100=53/100=0.53%
    const oldPred = 0.53;
    const actual = 0.55; // Δ=0.02% <0.1 eşik
    const res = calibrateWeights(oldWeights, actual, performances);
    expect(res.calibrated).toBe(false);
    expect(res.deltaPct).toBeCloseTo(0.02, 2);
  });

  it('pozitif Δ → en kötüden en iyiye kaydırma', () => {
    const actual = 1.5; // eski 0.53, Δ=0.97% → büyük
    const res = calibrateWeights(oldWeights, actual, performances, { maxSingleWeightPct: 20 });
    expect(res.calibrated).toBe(true);
    expect(res.deltaPct).toBeCloseTo(0.97, 1);
    // Yeni ağırlıklar toplam 100 olmalı
    const total = res.newWeights.reduce((s, w) => s + w.weightPct, 0);
    expect(total).toBeCloseTo(100, 2);
    // En iyi performanslı EREGL ağırlığı artmış olmalı, en kötü TUPRS azalmış veya çıkmış
    const eregl = res.newWeights.find((w) => w.ticker === 'EREGL');
    const tuprs = res.newWeights.find((w) => w.ticker === 'TUPRS');
    expect(eregl!.weightPct).toBeGreaterThan(10);
    if (tuprs) {
      expect(tuprs.weightPct).toBeLessThan(10);
    } else {
      // TUPRS tamamen satılmış (0%) → filtrelenmiş, bu da azalma sayılır
      expect(res.adjustments.some((a) => a.ticker.includes('TUPRS'))).toBe(true);
    }
  });

  it('negatif Δ → ters kaydırma', () => {
    const actual = -0.5; // Δ=-1.03%
    const res = calibrateWeights(oldWeights, actual, performances, { maxSingleWeightPct: 20 });
    expect(res.calibrated).toBe(true);
    expect(res.deltaPct).toBeLessThan(0);
  });

  it('SPK limiti %10 aşılmamalı', () => {
    const actual = 5; // çok büyük Δ
    const res = calibrateWeights(oldWeights, actual, performances, { maxSingleWeightPct: 10 });
    for (const w of res.newWeights) {
      expect(w.weightPct).toBeLessThanOrEqual(10.001);
    }
  });

  it('yeni hisse girişi adayları', () => {
    const perfsWithNew: StockPerformance[] = [
      ...performances,
      { ticker: 'DSTKF', changePct: 10, date: '2026-09-01' }, // yeni, çok iyi
    ];
    const actual = 2.0; // Δ büyük, mevcutlarla açıklanamazsa yeni hisse
    const res = calibrateWeights(oldWeights, actual, perfsWithNew);
    // DSTKF eklenmiş olabilir veya en azından denenmiş
    expect(res.newWeights.length).toBeGreaterThanOrEqual(10);
  });
});
