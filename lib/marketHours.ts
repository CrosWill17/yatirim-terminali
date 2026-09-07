/**
 * BİST SEANS SAATLERİ — dış veri kaynağına istek atma penceresi
 *
 * NEDEN: app/page.tsx her 60 saniyede bir /api/market çağırıyordu ve sunucu
 * tarafında her hisse için Yahoo'ya AYRI istek atılıyor (lib/marketData.ts:121,
 * /v8/finance/chart/{symbol} — batch endpoint kullanılmıyor). 105 kod ile bu,
 * dakikada ~105, günde ~150.000 istek demek. Seans dışında bunun tamamı çöp.
 *
 * KURAL (kullanıcı talebi): hafta içi 10:00'da başla, 18:00'de dur.
 * BIST sürekli müzayede saatleri de 10:00–18:00 olduğu için birebir örtüşüyor.
 *
 * SAAT DİLİMİ: Uygulama Vercel gibi UTC çalışan bir ortamda barındırılabilir,
 * bu yüzden Date.getHours() KULLANILMAZ — Intl ile Europe/Istanbul'a çevrilir.
 * Sandbox da kullanıcı da Europe/Istanbul'da ama bu tesadüfe güvenilmez.
 *
 * KAPSAM DIŞI: resmî tatiller. BIST tatil takvimi her yıl değişiyor ve sabit
 * liste bakım yükü; tatil gününde birkaç gereksiz istek atılır, o kadar.
 * Hafta sonu zaten kapalı.
 */

export const MARKET_TZ = 'Europe/Istanbul';

/** Seans başlangıcı: 10:00 (dakika cinsinden, gün başından itibaren). */
export const BIST_OPEN_MIN = 10 * 60;
/** Seans bitişi: 18:00. Bu dakika DAHİL DEĞİL — 18:00'da kapanmış sayılır. */
export const BIST_CLOSE_MIN = 18 * 60;

/** Intl 'en-GB' + weekday:'short' çıktısı. Sıra önemli: 0=Pazar. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface IstanbulClock {
  /** 0=Pazar … 6=Cumartesi */
  dayIndex: number;
  /** Gün başından itibaren dakika (0–1439) */
  minuteOfDay: number;
}

/**
 * Verilen anı Europe/Istanbul'a çevirip gün içi dakika + hafta günü döndürür.
 * `Intl.DateTimeFormat` örneği modül seviyesinde tutuluyor: formatToParts
 * her çağrıda yeni format nesnesi yaratmak 60 sn'lik poll'da gereksiz maliyet.
 */
const istanbulFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: MARKET_TZ,
  hour12: false,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function istanbulClock(now: Date = new Date()): IstanbulClock {
  const parts = istanbulFormatter.formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';

  const wd = get('weekday');
  const dayIndex = WEEKDAYS.indexOf(wd);

  // hour12:false bazı motorlarda gece yarısı için '24' döndürebiliyor → %24.
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));

  return {
    // Format tanınmayan bir değer döndürürse (locale değişimi) -1 gelir.
    // -1 % 2 !== 0 olduğu için "kapalı" tarafına düşer: bilinmiyorsa istek atma.
    dayIndex: dayIndex >= 0 ? dayIndex : -1,
    minuteOfDay: Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : -1,
  };
}

/** Cumartesi/Pazar veya bilinmeyen gün → false. */
export function isBistTradingDay(now: Date = new Date()): boolean {
  const { dayIndex } = istanbulClock(now);
  return dayIndex >= 1 && dayIndex <= 5;
}

/** Hafta içi VE 10:00 ≤ saat < 18:00. */
export function isBistOpen(now: Date = new Date()): boolean {
  if (!isBistTradingDay(now)) return false;
  const { minuteOfDay } = istanbulClock(now);
  if (minuteOfDay < 0) return false;
  return minuteOfDay >= BIST_OPEN_MIN && minuteOfDay < BIST_CLOSE_MIN;
}

/**
 * Bir sonraki durum değişimine (açılış/kapanış) kalan süre.
 * UI'da "seans X'te açılıyor" göstermek ve poll'u doğru zamana kurmak için.
 */
export function msUntilNextSessionChange(now: Date = new Date()): number {
  const open = isBistOpen(now);
  const { dayIndex, minuteOfDay } = istanbulClock(now);
  if (minuteOfDay < 0) return 60_000; // bilinmiyorsa 1 dk sonra tekrar bak

  // Kaç gün ilerideki hedef güne ulaşmamız gerekiyor?
  let daysAhead = 0;
  if (open) {
    // Kapanışa kadar aynı gün.
    return (BIST_CLOSE_MIN - minuteOfDay) * 60_000;
  }
  if (isBistTradingDay(now) && minuteOfDay < BIST_OPEN_MIN) {
    // Hafta içi, henüz açılmadı → bugün 10:00.
    return (BIST_OPEN_MIN - minuteOfDay) * 60_000;
  }
  // Hafta içi ama kapanmış, ya da hafta sonu → sıradaki iş gününün 10:00'ı.
  daysAhead = 1;
  while (daysAhead < 8) {
    const idx = (dayIndex + daysAhead) % 7;
    if (idx >= 1 && idx <= 5) break;
    daysAhead++;
  }
  const minutesLeftToday = 1440 - minuteOfDay;
  const minutesOnTargetDay = BIST_OPEN_MIN;
  const extraDays = daysAhead - 1;
  return (minutesLeftToday + extraDays * 1440 + minutesOnTargetDay) * 60_000;
}

/** Log/teşhis için: "2026-09-03 14:22 Istanbul — seans ACIK". */
export function marketStatusLabel(now: Date = new Date()): string {
  const { dayIndex, minuteOfDay } = istanbulClock(now);
  const hh = String(Math.floor(Math.max(minuteOfDay, 0) / 60)).padStart(2, '0');
  const mm = String(Math.max(minuteOfDay, 0) % 60).padStart(2, '0');
  return `${hh}:${mm} Istanbul (gun ${dayIndex}) — seans ${isBistOpen(now) ? 'ACIK' : 'KAPALI'}`;
}
