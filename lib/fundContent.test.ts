/**
 * P3 — FAZ 2 UI MANTIĞI TESTLERİ
 * Fon içeriği özeti (as_of_date / source / dışlanan satır), günlük tahmin
 * (ağırlıklı getiri + kaplama) ve "uydurma yok" kuralı.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeHoldingRows, excludedFromNotes, displayablePrediction,
  computeFundPrediction, toHoldingRows, parseRotaborsaHoldings, EXCLUDED_TAG,
  MIN_IMPACT_PCT,
} from './fundHoldings';
import type { SummaryRow } from './fundHoldings';

const rows: SummaryRow[] = [
  { fund_code: 'TLY', ticker: 'OZATD', company_name: 'Özata Denizcilik', weight_pct: 34.27, as_of_date: '2026-07-31', source: 'auto', notes: 'KAP raporu | dışlanan: 3' },
  { fund_code: 'TLY', ticker: 'TUPRS', company_name: 'Tüpraş', weight_pct: 12.5, as_of_date: '2026-07-31', source: 'auto', notes: 'KAP raporu | dışlanan: 3' },
  { fund_code: 'DFI', ticker: 'ASELS', company_name: 'Aselsan', weight_pct: 9.0, as_of_date: '2026-06-30', source: 'manual', notes: 'manuel override (UI)' },
  { fund_code: 'DFI', ticker: 'THYAO', company_name: 'THY', weight_pct: 7.5, as_of_date: '2026-07-31', source: 'manual', notes: null },
];

describe('summarizeHoldingRows', () => {
  const summary = summarizeHoldingRows(rows);

  it('fon bazında gruplar ve kod sırasına dizer', () => {
    expect(summary.map((s) => s.fundCode)).toEqual(['DFI', 'TLY']);
  });

  it('satır sayıları doğru', () => {
    expect(summary.find((s) => s.fundCode === 'TLY')!.rowCount).toBe(2);
    expect(summary.find((s) => s.fundCode === 'DFI')!.rowCount).toBe(2);
  });

  it('as_of_date = en güncel rapor dönemi', () => {
    expect(summary.find((s) => s.fundCode === 'TLY')!.asOfDate).toBe('2026-07-31');
    expect(summary.find((s) => s.fundCode === 'DFI')!.asOfDate).toBe('2026-07-31');
  });

  it('kaynaklar listelenir, manuel sayısı ayrı sayılır', () => {
    const dfi = summary.find((s) => s.fundCode === 'DFI')!;
    expect(dfi.sources).toEqual(['manual']);
    expect(dfi.manualCount).toBe(2);
    const tly = summary.find((s) => s.fundCode === 'TLY')!;
    expect(tly.sources).toEqual(['auto']);
    expect(tly.manualCount).toBe(0);
  });

  it('ağırlık toplamı hesaplanır', () => {
    expect(summary.find((s) => s.fundCode === 'TLY')!.totalWeightPct).toBeCloseTo(46.77, 4);
  });

  it('dışlanan satır sayısı notes\'tan okunur; yoksa null (VERİ EKSİK)', () => {
    expect(summary.find((s) => s.fundCode === 'TLY')!.excludedCount).toBe(3);
    expect(summary.find((s) => s.fundCode === 'DFI')!.excludedCount).toBeNull();
  });

  it('boş liste → boş özet', () => {
    expect(summarizeHoldingRows([])).toEqual([]);
  });
});

describe('excludedFromNotes', () => {
  it('etiketli nottan sayıyı çözer', () => {
    expect(excludedFromNotes(`KAP aylık raporu | ${EXCLUDED_TAG}: 12`)).toBe(12);
    expect(excludedFromNotes(`${EXCLUDED_TAG}:0`)).toBe(0);
  });

  it('etiket yoksa null döner (uydurmaz)', () => {
    expect(excludedFromNotes('manuel override (UI)')).toBeNull();
    expect(excludedFromNotes(null)).toBeNull();
    expect(excludedFromNotes(undefined)).toBeNull();
  });
});

describe('toHoldingRows — dışlanan sayısı notes\'a yazılır', () => {
  const HTML = `
    <p>26 Ağustos 2026, 11:47 güncellendi</p>
    <table>
      <tr><td>Özata Denizcilik (OZATD)</td><td>%34,27</td><td>%30,00</td></tr>
      <tr><td>Küçük Etki A.Ş. (KUCUK)</td><td>%0,005</td><td>%0,004</td></tr>
    </table>`;

  it('dışlanan satır varsa notes\'a eklenir', () => {
    const parsed = parseRotaborsaHoldings(HTML, 'TLY');
    expect(parsed.excludedCount).toBe(1);
    const out = toHoldingRows(parsed);
    expect(out).toHaveLength(1);
    expect(out[0].notes).toContain(`${EXCLUDED_TAG}: 1`);
    expect(excludedFromNotes(out[0].notes)).toBe(1);
  });

  it('dışlanan satır yoksa notes sade kalır', () => {
    const parsed = parseRotaborsaHoldings(
      `<p>26 Ağustos 2026 güncellendi</p><table><tr><td>Tüpraş (TUPRS)</td><td>%12,50</td></tr></table>`,
      'TLY'
    );
    expect(parsed.excludedCount).toBe(0);
    expect(toHoldingRows(parsed)[0].notes).not.toContain(EXCLUDED_TAG);
  });

  it('MIN_IMPACT_PCT filtresi %0,01', () => {
    expect(MIN_IMPACT_PCT).toBe(0.01);
  });
});

describe('displayablePrediction — v1 kuralı: uydurma yok', () => {
  it('fon içeriği olmayan fon (KGM/TP2) → null → UI "—"', () => {
    const empty = computeFundPrediction('KGM', [], {});
    expect(empty.contributions).toHaveLength(0);
    expect(displayablePrediction(empty)).toBeNull();
    expect(displayablePrediction(undefined)).toBeNull();
    expect(displayablePrediction(null)).toBeNull();
  });

  it('hiçbir hissenin fiyatı yoksa da null (katkı hesaplanamadı)', () => {
    const p = computeFundPrediction('TLY', [{ ticker: 'OZATD', name: 'x', weightPct: 34.27, prevWeightPct: null }], {});
    expect(p.missingTickers).toEqual(['OZATD']);
    expect(displayablePrediction(p)).toBeNull();
  });

  it('en az bir katkı varsa tahmin gösterilir', () => {
    const p = computeFundPrediction(
      'TLY',
      [
        { ticker: 'OZATD', name: 'x', weightPct: 34.27, prevWeightPct: null },
        { ticker: 'TUPRS', name: 'y', weightPct: 12.5, prevWeightPct: null },
      ],
      {
        OZATD: { price: 500, changePct: 2 },
        TUPRS: { price: 150, changePct: -1 },
      }
    );
    const shown = displayablePrediction(p);
    expect(shown).not.toBeNull();
    // (34.27 × 2 / 100) + (12.5 × -1 / 100) = 0.6854 - 0.125 = 0.5604
    expect(shown!.predictedPct).toBeCloseTo(0.5604, 4);
    expect(shown!.coveredPct).toBeCloseTo(46.77, 4);
  });

  it('fiyatı eksik hisse katkı 0 + missingTickers', () => {
    const p = computeFundPrediction(
      'TLY',
      [
        { ticker: 'OZATD', name: 'x', weightPct: 34.27, prevWeightPct: null },
        { ticker: 'FIYATYOK', name: 'z', weightPct: 5, prevWeightPct: null },
      ],
      { OZATD: { price: 500, changePct: 1 }, FIYATYOK: null }
    );
    expect(p.missingTickers).toEqual(['FIYATYOK']);
    expect(p.coveredPct).toBeCloseTo(34.27, 4);
    expect(p.predictedPct).toBeCloseTo(0.3427, 4);
  });
});
