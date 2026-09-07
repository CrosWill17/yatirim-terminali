import { describe, expect, it } from 'vitest';
import {
  BIST_CLOSE_MIN,
  BIST_OPEN_MIN,
  isBistOpen,
  isBistTradingDay,
  istanbulClock,
  msUntilNextSessionChange,
} from './marketHours';

/**
 * TÜM saatler UTC olarak yazıldı — modülün Europe/Istanbul'a kendisi çevirmesi
 * gerekiyor. İstanbul = UTC+3 (yaz saati yok, Türkiye 2016'dan beri sabit +3).
 * Yani 10:00 Istanbul = 07:00 UTC.
 *
 * 2026-09-07 PAZARTESİ · 2026-09-12 CUMARTESİ · 2026-09-13 PAZAR
 */
const utc = (iso: string) => new Date(iso);

describe('istanbulClock — saat dilimi çevirimi', () => {
  it('UTC 07:00 → Istanbul 10:00 (UTC+3)', () => {
    const { dayIndex, minuteOfDay } = istanbulClock(utc('2026-09-07T07:00:00Z'));
    expect(dayIndex).toBe(1); // Pazartesi
    expect(minuteOfDay).toBe(600); // 10:00
  });

  it('UTC 00:30 → Istanbul 03:30, gün kaymıyor', () => {
    const { dayIndex, minuteOfDay } = istanbulClock(utc('2026-09-07T00:30:00Z'));
    expect(dayIndex).toBe(1);
    expect(minuteOfDay).toBe(210); // 03:30
  });

  it('UTC 21:30 → Istanbul 00:30, gün BİR İLERİ kayar', () => {
    // Pazartesi 21:30 UTC = Salı 00:30 Istanbul. Gün kayması olmasa
    // Cuma gecesi istekleri "hafta içi açık" sanılırdı.
    const { dayIndex, minuteOfDay } = istanbulClock(utc('2026-09-07T21:30:00Z'));
    expect(dayIndex).toBe(2); // Salı
    expect(minuteOfDay).toBe(30); // 00:30
  });
});

describe('isBistOpen — seans penceresi', () => {
  it('Pazartesi 10:00 tam açılış → AÇIK', () => {
    expect(isBistOpen(utc('2026-09-07T07:00:00Z'))).toBe(true);
  });

  it('Pazartesi 09:59 → KAPALI (açılıştan 1 dk önce)', () => {
    expect(isBistOpen(utc('2026-09-07T06:59:00Z'))).toBe(false);
  });

  it('Pazartesi 13:00 → AÇIK', () => {
    expect(isBistOpen(utc('2026-09-07T10:00:00Z'))).toBe(true);
  });

  it('Pazartesi 17:59 → AÇIK (kapanıştan 1 dk önce)', () => {
    expect(isBistOpen(utc('2026-09-07T14:59:00Z'))).toBe(true);
  });

  it('Pazartesi 18:00 → KAPALI (kapanış dakikası dahil değil)', () => {
    expect(isBistOpen(utc('2026-09-07T15:00:00Z'))).toBe(false);
  });

  it('Pazartesi 23:00 → KAPALI', () => {
    expect(isBistOpen(utc('2026-09-07T20:00:00Z'))).toBe(false);
  });

  it('Cumartesi 13:00 → KAPALI (saat pencere içinde olsa bile)', () => {
    expect(isBistOpen(utc('2026-09-12T10:00:00Z'))).toBe(false);
  });

  it('Pazar 13:00 → KAPALI', () => {
    expect(isBistOpen(utc('2026-09-13T10:00:00Z'))).toBe(false);
  });

  it('Cuma 18:00 sonrası → KAPALI, hafta sonuna giriliyor', () => {
    // Cuma = 2026-09-11. 18:00 Istanbul = 15:00 UTC.
    expect(isBistOpen(utc('2026-09-11T15:00:00Z'))).toBe(false);
  });

  it('hafta içi her gün 12:00 → AÇIK', () => {
    for (const day of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']) {
      expect(isBistOpen(utc(`${day}T09:00:00Z`))).toBe(true);
    }
  });
});

describe('isBistTradingDay', () => {
  it('Pazartesi–Cuma true, Cumartesi/Pazar false', () => {
    expect(isBistTradingDay(utc('2026-09-07T09:00:00Z'))).toBe(true);
    expect(isBistTradingDay(utc('2026-09-11T09:00:00Z'))).toBe(true);
    expect(isBistTradingDay(utc('2026-09-12T09:00:00Z'))).toBe(false);
    expect(isBistTradingDay(utc('2026-09-13T09:00:00Z'))).toBe(false);
  });
});

describe('sınır sabitleri', () => {
  it('10:00 ve 18:00 = 8 saatlik seans', () => {
    expect(BIST_OPEN_MIN).toBe(600);
    expect(BIST_CLOSE_MIN).toBe(1080);
    expect(BIST_CLOSE_MIN - BIST_OPEN_MIN).toBe(480);
  });
});

describe('msUntilNextSessionChange', () => {
  it('seans içindeyken kapanışa kalan süreyi verir', () => {
    // 13:00 Istanbul → 18:00'a 5 saat = 300 dk
    const ms = msUntilNextSessionChange(utc('2026-09-07T10:00:00Z'));
    expect(ms).toBe(300 * 60_000);
  });

  it('hafta içi açılış öncesi → bugünkü açılışa kadar', () => {
    // 08:00 Istanbul → 10:00'a 2 saat
    const ms = msUntilNextSessionChange(utc('2026-09-07T05:00:00Z'));
    expect(ms).toBe(120 * 60_000);
  });

  it('hafta içi kapanış sonrası → ertesi gün 10:00', () => {
    // Pazartesi 20:00 Istanbul → Salı 10:00 = 4 + 10 = 14 saat
    const ms = msUntilNextSessionChange(utc('2026-09-07T17:00:00Z'));
    expect(ms).toBe(14 * 60 * 60_000);
  });

  it('Cuma akşamı → Pazartesi 10:00 (hafta sonunu atlar)', () => {
    // Cuma 2026-09-11, 18:30 Istanbul → Pazartesi 10:00.
    // Cuma 18:30 → 24:00 = 5.5 saat
    //   + Cumartesi 24 saat
    //   + Pazar     24 saat
    //   + Pazartesi 00:00-10:00 = 10 saat
    // toplam 63.5 saat = 3810 dk. (İlk yazımda hafta sonunu TEK gün sayıp
    // 39.5 saat beklemiştim — kod 63.5 döndürünce hata testteydi, kodda değil.)
    const ms = msUntilNextSessionChange(utc('2026-09-11T15:30:00Z'));
    expect(ms).toBe(3810 * 60_000);
  });

  it('Pazar günü → Pazartesi 10:00', () => {
    // Pazar 2026-09-13 12:00 Istanbul → Pazartesi 10:00 = 12 + 10 = 22 saat
    const ms = msUntilNextSessionChange(utc('2026-09-13T09:00:00Z'));
    expect(ms).toBe(22 * 60 * 60_000);
  });

  it('sonuç daima pozitif ve makul (< 8 gün)', () => {
    for (let h = 0; h < 24; h++) {
      const ms = msUntilNextSessionChange(utc(`2026-09-11T${String(h).padStart(2, '0')}:15:00Z`));
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThan(8 * 24 * 60 * 60_000);
    }
  });
});
