import { describe, expect, it } from 'vitest';
import {
  DAY_END_MINUTE,
  MIN_COVERAGE_FOR_SNAPSHOT,
  istanbulDateStr,
  msUntilDayEnd,
  shouldTakeDayEndSnapshot,
} from './dayEnd';

/**
 * Tüm anlar Europe/Istanbul'a göre doğrulandı (UTC+3, yaz saati yok).
 * İstanbul saati = UTC + 3 → 18:20 İstanbul = 15:20Z.
 */
const MON_18_20 = new Date('2026-09-07T15:20:00Z'); // Pazartesi 18:20
const MON_18_19 = new Date('2026-09-07T15:19:00Z'); // Pazartesi 18:19
const MON_18_21 = new Date('2026-09-07T15:21:00Z'); // Pazartesi 18:21
const MON_23_00 = new Date('2026-09-07T20:00:00Z'); // Pazartesi 23:00
const SAT_18_20 = new Date('2026-09-12T15:20:00Z'); // Cumartesi 18:20
const SUN_18_20 = new Date('2026-09-13T15:20:00Z'); // Pazar 18:20
const TUE_00_30 = new Date('2026-09-07T21:30:00Z'); // Salı 08/09 00:30

/** DFI'nin gerçek kapsamı — %53,23. */
const IYI = { estimatedPct: 0.89, coveredPct: 53.23 };

describe('dayEnd — sabitler', () => {
  it('18:20 = 1100 dakika (kullanıcının istediği saat)', () => {
    expect(DAY_END_MINUTE).toBe(18 * 60 + 20);
    expect(DAY_END_MINUTE).toBe(1100);
  });

  it('eşik, kalibrasyon gross-up sınırının (15) üzerinde — çöp veri yazılmasın', () => {
    expect(MIN_COVERAGE_FOR_SNAPSHOT).toBeGreaterThan(15);
  });
});

describe('dayEnd — saat penceresi', () => {
  it('18:20 tam sınırda ALINIR', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_20, ...IYI });
    expect(d.run).toBe(true);
    expect(d.reason).toBe('alindi');
  });

  it('18:19 bir dakika erken ALINMAZ', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_19, ...IYI });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('saat_gelmedi');
    expect(d.detail).toContain('18:20');
  });

  it('18:21 ALINIR (sınır dahil, sonrası da geçerli)', () => {
    expect(shouldTakeDayEndSnapshot({ now: MON_18_21, ...IYI }).run).toBe(true);
  });

  it('23:00 YAKALAMA — uygulama akşam açıldıysa gün sonu yine yazılır', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_23_00, ...IYI });
    expect(d.run).toBe(true);
    expect(d.reason).toBe('alindi');
  });
});

describe('dayEnd — işlem günü filtresi', () => {
  it('Cumartesi 18:20 ALINMAZ', () => {
    const d = shouldTakeDayEndSnapshot({ now: SAT_18_20, ...IYI });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('islem_gunu_degil');
  });

  it('Pazar 18:20 ALINMAZ', () => {
    expect(shouldTakeDayEndSnapshot({ now: SUN_18_20, ...IYI }).reason).toBe('islem_gunu_degil');
  });

  it('işlem günü kontrolü SAAT kontrolünden ÖNCE gelir (Cmt 18:19 da işlem günü değil)', () => {
    const cmt_1819 = new Date('2026-09-12T15:19:00Z');
    expect(shouldTakeDayEndSnapshot({ now: cmt_1819, ...IYI }).reason).toBe('islem_gunu_degil');
  });
});

describe('dayEnd — idempotency', () => {
  it('bugünün kaydı varsa TEKRAR YAZMAZ', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_20, hasSnapshotToday: true, ...IYI });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('zaten_kayitli');
  });

  it('kayıt kontrolü, kapsam kontrolünden ÖNCE — kötü veriyle bile tekrar denenmez', () => {
    const d = shouldTakeDayEndSnapshot({
      now: MON_18_20, hasSnapshotToday: true, estimatedPct: 0.5, coveredPct: 3,
    });
    expect(d.reason).toBe('zaten_kayitli');
  });
});

describe('dayEnd — veri kalitesi koruması', () => {
  it('kapsama %29,99 → YAZMAZ (çöp tahmin kalibrasyonu bozar)', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: 0.89, coveredPct: 29.99 });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('kapsama_yetersiz');
    expect(d.detail).toContain('%30');
  });

  it('kapsama tam %30 → YAZAR (sınır dahil)', () => {
    expect(shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: 0.89, coveredPct: 30 }).run).toBe(true);
  });

  it('kapsama null → YAZMAZ', () => {
    expect(shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: 0.89, coveredPct: null }).reason)
      .toBe('kapsama_yetersiz');
  });

  it('tahmin null (fiyatlar yüklenmemiş) → YAZMAZ', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: null, coveredPct: 53 });
    expect(d.run).toBe(false);
    expect(d.reason).toBe('tahmin_yok');
  });

  it('tahmin NaN → YAZMAZ', () => {
    expect(shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: NaN, coveredPct: 53 }).reason)
      .toBe('tahmin_yok');
  });

  it('NEGATİF tahmin de geçerli — zarar günü de kaydedilmeli', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: -1.2, coveredPct: 53.23 });
    expect(d.run).toBe(true);
  });

  it('sıfır tahmin geçerli (yatay gün)', () => {
    expect(shouldTakeDayEndSnapshot({ now: MON_18_20, estimatedPct: 0, coveredPct: 53.23 }).run).toBe(true);
  });
});

describe('dayEnd — kontrol sırası', () => {
  it('saat gelmediyse kapsamdan ŞİKAYET ETMEZ (gün boyu sessiz kalmalı)', () => {
    const d = shouldTakeDayEndSnapshot({ now: MON_18_19, estimatedPct: 0.5, coveredPct: 2 });
    expect(d.reason).toBe('saat_gelmedi');
  });
});

describe('istanbulDateStr — UTC tarihi DEĞİL, İstanbul tarihi', () => {
  it('00:30 İstanbul → İSTANBUL tarihi (UTC hâlâ önceki gün)', () => {
    // 2026-09-07T21:30:00Z = İstanbul Salı 08/09 00:30
    expect(istanbulDateStr(TUE_00_30)).toBe('2026-09-08');
    // Aynı anın UTC tarihi farklı — toISOString kullanılsaydı bu yanlış olurdu:
    expect(TUE_00_30.toISOString().slice(0, 10)).toBe('2026-09-07');
  });

  it('18:20 İstanbul → aynı gün', () => {
    expect(istanbulDateStr(MON_18_20)).toBe('2026-09-07');
  });

  it('YYYY-AA-GG biçimi (fund_nav_daily.nav_date ile uyumlu)', () => {
    expect(istanbulDateStr(MON_18_20)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('msUntilDayEnd — geri sayım', () => {
  it('18:19 → 1 dakika kaldı', () => {
    expect(msUntilDayEnd(MON_18_19)).toBe(60_000);
  });

  it('18:20 → 0', () => {
    expect(msUntilDayEnd(MON_18_20)).toBe(0);
  });

  it('18:21 (geçti) → 0, negatif DEĞİL', () => {
    expect(msUntilDayEnd(MON_18_21)).toBe(0);
  });

  it('23:00 (çoktan geçti) → 0', () => {
    expect(msUntilDayEnd(MON_23_00)).toBe(0);
  });
});
