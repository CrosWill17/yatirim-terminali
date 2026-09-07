/**
 * Gün sonu (18:20) tahmin snapshot'ının NE ZAMAN ve HANGİ KOŞULLARDA
 * alınacağına karar veren saf mantık.
 *
 * NEDEN AYRI DOSYA: Karar "saat + işlem günü + kayıt var mı + veri yeterli mi"
 * gibi saf koşullardan oluşuyor. UI'dan ve cron endpoint'inden AYNI fonksiyon
 * çağrılır; böylece iki tetikleyici farklı davranamaz.
 *
 * TETİKLEYİCİ MİMARİSİ (sürekli çalışan sunucu YOK):
 *   1. Uygulama açıkken 60 sn'de bir bu karar sorgulanır → 18:20'de yazılır.
 *   2. Uygulama 18:20'den SONRA açılırsa (ör. 18:45) "yakalama" çalışır:
 *      gün henüz aynı gün olduğu için snapshot yine doğru saatle yazılır.
 *   3. /api/cron/day-end endpoint'i aynı kararı sunucuda verir — GitHub
 *      Actions izni açıldığında veya Vercel Cron'a geçildiğinde tek satırla
 *      gerçek zamanlanmış işe bağlanır.
 *
 * Her üçü de idempotent: UNIQUE(user_id, fund_code, nav_date) + buradaki
 * `zaten_kayitli` kontrolü aynı gün iki kez yazılmasını engeller.
 */
import { isBistTradingDay, istanbulClock, MARKET_TZ } from './marketHours';

/**
 * 18:20 İstanbul — BIST kapanışından (18:00) 20 dakika sonra.
 * Neden 18:20: kapanış fiyatları oturmuş olur ama gün hâlâ "bugün"dür.
 * Kullanıcının istediği saat tam olarak bu.
 */
export const DAY_END_MINUTE = 18 * 60 + 20;

/**
 * Bu kapsamanın ALTINDA snapshot YAZILMAZ.
 *
 * Neden atlamak, neden işaretleyip yazmak değil: düşük kapsama gross-up'ı
 * güvenilmez kılar (lib/fundCalibration.ts MIN_COVERAGE_FOR_GROSSUP = 15).
 * Çöp bir tahmin, yanına GERÇEK getiri yazıldığında kalibrasyona YANLIŞ bir
 * katsayı öğretir — yani sistemi iyileştirecek mekanizmayı bozar. Veri
 * kaybetmek, sistemi yanlış eğitmekten daha az zararlı.
 */
export const MIN_COVERAGE_FOR_SNAPSHOT = 30;

export type DayEndReason =
  | 'alindi'
  | 'islem_gunu_degil'
  | 'saat_bilinmiyor'
  | 'zaten_kayitli'
  | 'saat_gelmedi'
  | 'tahmin_yok'
  | 'kapsama_yetersiz';

export interface DayEndDecision {
  run: boolean;
  reason: DayEndReason;
  /** Kullanıcıya gösterilebilir açıklama (log + tooltip). */
  detail: string;
}

export interface DayEndInput {
  now?: Date;
  /** Bugün için fund_nav_daily'de zaten satır var mı? (idempotency) */
  hasSnapshotToday?: boolean;
  estimatedPct?: number | null;
  coveredPct?: number | null;
}

/** Europe/Istanbul takvim tarihi, YYYY-AA-GG. */
const istanbulDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: MARKET_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * İstanbul'a göre BUGÜNÜN tarihi.
 *
 * `new Date().toISOString().slice(0,10)` KULLANILMAZ: o UTC tarihidir.
 * 00:30 İstanbul'da UTC hâlâ önceki gündür, snapshot yanlış güne yazılırdı.
 * 18:20'de ikisi çakışsa da fonksiyon doğru olanı yapar.
 */
export function istanbulDateStr(now: Date = new Date()): string {
  return istanbulDateFormatter.format(now);
}

const two = (n: number) => String(n).padStart(2, '0');

/** 18:20'ye kalan süre (ms). 18:20 geçtiyse 0, saat okunamıyorsa -1. */
export function msUntilDayEnd(now: Date = new Date()): number {
  const { minuteOfDay } = istanbulClock(now);
  if (minuteOfDay < 0) return -1;
  const delta = (DAY_END_MINUTE - minuteOfDay) * 60_000;
  return delta > 0 ? delta : 0;
}

/**
 * Snapshot alınmalı mı? Kontrol SIRASI önemlidir:
 * en ucuz ve en kesin koşullar önce, veri kalitesi en sonda.
 */
export function shouldTakeDayEndSnapshot(input: DayEndInput = {}): DayEndDecision {
  const now = input.now ?? new Date();

  if (!isBistTradingDay(now)) {
    return {
      run: false,
      reason: 'islem_gunu_degil',
      detail: 'Hafta sonu — BIST işlem günü değil, gün sonu tahmini alınmaz.',
    };
  }

  const { minuteOfDay } = istanbulClock(now);
  if (minuteOfDay < 0) {
    // Intl beklenmedik çıktı verdi (locale/motor değişikliği). Bilinmiyorsa
    // YAZMA: yanlış güne yazılan snapshot geri alınamaz.
    return {
      run: false,
      reason: 'saat_bilinmiyor',
      detail: 'İstanbul saati okunamadı — yanlış güne yazmamak için atlandı.',
    };
  }

  if (input.hasSnapshotToday) {
    return {
      run: false,
      reason: 'zaten_kayitli',
      detail: 'Bugünün gün sonu tahmini zaten kayıtlı.',
    };
  }

  if (minuteOfDay < DAY_END_MINUTE) {
    return {
      run: false,
      reason: 'saat_gelmedi',
      detail: `18:20 bekleniyor (İstanbul ${two(Math.floor(minuteOfDay / 60))}:${two(minuteOfDay % 60)}).`,
    };
  }

  const est = input.estimatedPct;
  if (est == null || !Number.isFinite(est)) {
    return {
      run: false,
      reason: 'tahmin_yok',
      detail: 'Hesaplanmış tahmin yok — fiyatlar yüklenmemiş olabilir.',
    };
  }

  const cov = input.coveredPct;
  if (cov == null || !Number.isFinite(cov) || cov < MIN_COVERAGE_FOR_SNAPSHOT) {
    return {
      run: false,
      reason: 'kapsama_yetersiz',
      detail:
        `Kapsama %${cov == null || !Number.isFinite(cov) ? '—' : cov.toFixed(2)} < %${MIN_COVERAGE_FOR_SNAPSHOT}. ` +
        'Snapshot yazılmadı: bozuk tahmin kalibrasyonu yanlış eğitir.',
    };
  }

  return {
    run: true,
    reason: 'alindi',
    detail: `Gün sonu tahmini alınıyor (kapsama %${cov.toFixed(2)}).`,
  };
}
