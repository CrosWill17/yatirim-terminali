import { describe, expect, it } from 'vitest';
import { buildDayEndPlan } from './dayEndSnapshot';
import type { HoldingPrice } from './fundHoldings';
import type { FundNavDailyRow } from './types';

const MON_18_20 = new Date('2026-09-07T15:20:00Z'); // Pazartesi 18:20 İstanbul
const MON_18_19 = new Date('2026-09-07T15:19:00Z');
const SAT_18_20 = new Date('2026-09-12T15:20:00Z');

const px = (changePct: number): HoldingPrice => ({ price: 10, changePct });

/** Tek kalem, %100 ağırlık → coveredPct tam 100, gross-up devreye girmez. */
const FULL_FUND = [{ ticker: 'TEST', name: null, weightPct: 100, prevWeightPct: null }];

const nav = (over: Partial<FundNavDailyRow>): FundNavDailyRow => ({
  id: 'x', fund_code: 'DFI', nav_date: '2026-09-01',
  estimated_pct: null, covered_pct: null, actual_pct: null, actual_nav: null,
  actual_at: null, calib_factor: 1, status: 'both', source: 'app', notes: null,
  ...over,
});

describe('buildDayEndPlan — temel akış', () => {
  it('18:20 + tam kapsam → draft üretir, tarih İstanbul takviminden', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      [],
      MON_18_20,
    );
    expect(plan.navDate).toBe('2026-09-07');
    expect(plan.toWrite).toHaveLength(1);
    const d = plan.toWrite[0].draft!;
    expect(d.fund_code).toBe('DFI');
    expect(d.nav_date).toBe('2026-09-07');
    expect(d.estimated_pct).toBe(0.89);
    expect(d.covered_pct).toBe(100);
    expect(d.calib_factor).toBe(1);
  });

  it('18:19 → hiçbir şey yazılmaz', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }], { TEST: px(0.89) }, [], MON_18_19,
    );
    expect(plan.toWrite).toHaveLength(0);
    expect(plan.skipped[0].decision.reason).toBe('saat_gelmedi');
  });

  it('Cumartesi → hiçbir şey yazılmaz', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }], { TEST: px(0.89) }, [], SAT_18_20,
    );
    expect(plan.toWrite).toHaveLength(0);
    expect(plan.skipped[0].decision.reason).toBe('islem_gunu_degil');
  });

  it('bugünün kaydı zaten varsa tekrar yazmaz', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      [nav({ nav_date: '2026-09-07', estimated_pct: 0.5 })],
      MON_18_20,
    );
    expect(plan.toWrite).toHaveLength(0);
    expect(plan.skipped[0].decision.reason).toBe('zaten_kayitli');
  });

  it('DÜNÜN kaydı bugün için engel DEĞİL', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      [nav({ nav_date: '2026-09-04', estimated_pct: 0.5 })],
      MON_18_20,
    );
    expect(plan.toWrite).toHaveLength(1);
  });

  it('SOĞUK CACHE koruması: fiyat yoksa kapsam 0 → yazılmaz', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }], {}, [], MON_18_20,
    );
    expect(plan.toWrite).toHaveLength(0);
    expect(plan.skipped[0].decision.reason).toBe('kapsama_yetersiz');
    expect(plan.skipped[0].raw.coveredPct).toBe(0);
  });

  it('kısmi kapsam %53,15 → yazılır ve gross-up uygulanır', () => {
    const holdings = [
      { ticker: 'IEYHO', name: null, weightPct: 50.25, prevWeightPct: null },
      { ticker: 'ISKPL', name: null, weightPct: 2.9, prevWeightPct: null },
    ];
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings }],
      { IEYHO: px(1), ISKPL: px(-2) },
      [],
      MON_18_20,
    );
    const item = plan.toWrite[0];
    // ham: (50.25*1 - 2.90*2)/100 = 0.4445
    expect(item.raw.predictedPct).toBeCloseTo(0.4445, 6);
    expect(item.raw.coveredPct).toBeCloseTo(53.15, 6);
    // gross-up: 0.4445 * 100/53.15 = 0.8363
    expect(item.raw.calibratedPct).toBeCloseTo(0.8363, 3);
    expect(item.draft!.estimated_pct).toBeCloseTo(0.8363, 3);
  });

  it('negatif tahmin de kaydedilir (zarar günü)', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }], { TEST: px(-1.2) }, [], MON_18_20,
    );
    expect(plan.toWrite[0].draft!.estimated_pct).toBeCloseTo(-1.2, 6);
  });

  it('çoklu fon → her fon ayrı karar alır', () => {
    const plan = buildDayEndPlan(
      [
        { fundCode: 'DFI', holdings: FULL_FUND },
        { fundCode: 'TLY', holdings: FULL_FUND },
      ],
      { TEST: px(0.5) },
      [],
      MON_18_20,
    );
    expect(plan.toWrite).toHaveLength(2);
    expect(plan.toWrite.map((i) => i.fundCode).sort()).toEqual(['DFI', 'TLY']);
  });

  it('draft 4 ondalığa yuvarlanır (NUMERIC(9,4) ile uyumlu)', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }], { TEST: px(1 / 3) }, [], MON_18_20,
    );
    const v = plan.toWrite[0].draft!.estimated_pct;
    expect(v).toBe(0.3333);
    expect(String(v).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

describe('buildDayEndPlan — kalibrasyon kullanıcının örneğini yakalar', () => {
  /**
   * Kullanıcının senaryosu: tahmin 0.89, açıklanan 0.95.
   * 5 günlük bu geçmişten katsayı 0.95/0.89 = 1.06742 öğrenilir ve
   * yeni 0.89 tahmini TAM 0.95'e oturur.
   */
  const tarihce = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      nav({ nav_date: `2026-09-0${i + 1}`, estimated_pct: 0.89, actual_pct: 0.95, covered_pct: 100 }),
    );

  it('5 örnek → katsayı öğrenilir, tahmin 0.95e çekilir', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      tarihce(5),
      MON_18_20,
    );
    const item = plan.toWrite[0];
    expect(item.raw.historySamples).toBe(5);
    expect(item.raw.factor).toBeCloseTo(0.95 / 0.89, 5);
    expect(item.draft!.estimated_pct).toBeCloseTo(0.95, 4);
    expect(item.draft!.calib_factor).toBeCloseTo(0.95 / 0.89, 4);
  });

  it('4 örnek → EŞİK ALTINDA, katsayı 1.00 kalır (aşırı uydurma yok)', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      tarihce(4),
      MON_18_20,
    );
    expect(plan.toWrite[0].raw.factor).toBe(1);
    expect(plan.toWrite[0].draft!.estimated_pct).toBeCloseTo(0.89, 6);
  });

  it('gerçekleşeni OLMAYAN günler katsayıya katılmaz', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'DFI', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      [
        ...tarihce(4),
        // 5. satır var ama actual_pct yok → örnek sayılmaz
        nav({ nav_date: '2026-09-05', estimated_pct: 0.89, actual_pct: null, covered_pct: 100 }),
      ],
      MON_18_20,
    );
    expect(plan.toWrite[0].raw.historySamples).toBe(4);
    expect(plan.toWrite[0].raw.factor).toBe(1);
  });

  it('geçmiş başka fonun katsayısını ETKİLEMEZ', () => {
    const plan = buildDayEndPlan(
      [{ fundCode: 'TLY', holdings: FULL_FUND }],
      { TEST: px(0.89) },
      tarihce(5), // hepsi fund_code: 'DFI'
      MON_18_20,
    );
    expect(plan.toWrite[0].raw.factor).toBe(1);
    expect(plan.toWrite[0].draft!.estimated_pct).toBeCloseTo(0.89, 6);
  });
});
