/**
 * GİZLİLİK MASKESİ (P2) — tek tık **
 *
 * Header'daki göz butonu açıkken ekrandaki HASSAS sayılar `**` olur.
 *  - HASSAS: TL tutarları ve adetler (adet, birim maliyet, güncel fiyat,
 *    pozisyon değeri, pozisyon K/Z, toplamlar, nakit, fon adet/TL değerleri,
 *    stop/hedef TL seviyeleri).
 *  - KAMU: kod, ad, % değişim, ağırlık %, endeks/fiyat değerleri, tahmin %.
 *
 * Durum localStorage'da kalıcıdır; varsayılan KAPALI.
 * Tüm fonksiyonlar saf (side-effect'siz) — test edilebilir.
 */

export const MASK = '**';
export const MASK_STORAGE_KEY = 'yt.mask.v1';

export function formatNumber(v: number, digits = 0): string {
  return v.toLocaleString('tr-TR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export interface SensitiveOptions {
  /** En çok kaç ondalık. */
  digits?: number;
  /** En az kaç ondalık (fiyatlar için 2). */
  minDigits?: number;
  /** Son ek (ör. ' TL'). Maske açıkken son ek de gizlenir. */
  suffix?: string;
  /** Pozitif değerlerde '+' öneki (K/Z için). */
  signed?: boolean;
  /** null/undefined/NaN yerine gösterilecek metin (varsayılan '—'). */
  fallback?: string;
}

/**
 * HASSAS değer biçimlendirici.
 * masked=true → içerik hiç hesaplanmaz, doğrudan `**` döner.
 */
export function formatSensitive(
  v: number | null | undefined,
  masked: boolean,
  opts: SensitiveOptions = {}
): string {
  if (masked) return MASK;
  if (v === null || v === undefined || !Number.isFinite(v)) return opts.fallback ?? '—';
  const { digits = 0, minDigits = 0, suffix = '', signed = false } = opts;
  const text = v.toLocaleString('tr-TR', {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
  });
  return `${signed && v >= 0 ? '+' : ''}${text}${suffix}`;
}

export interface PublicOptions {
  digits?: number;
  /** '+' öneki (günlük değişim için). */
  signed?: boolean;
  /** '%' öneki. */
  percentSign?: boolean;
  fallback?: string;
}

/**
 * KAMU verisi biçimlendirici — masked parametresi ALMAZ: yüzdelikler,
 * endeks değerleri ve ağırlıklar hiçbir koşulda maskelenmez.
 */
export function formatPublic(v: number | null | undefined, opts: PublicOptions = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return opts.fallback ?? '—';
  const { digits = 2, signed = false, percentSign = false } = opts;
  const text = v.toLocaleString('tr-TR', { maximumFractionDigits: digits });
  return `${percentSign ? '%' : ''}${signed && v >= 0 ? '+' : ''}${text}`;
}

/** Metin tabanlı hassas içerik (ör. grafik tooltip'i, açıklama cümlesi). */
export function maskText(text: string, masked: boolean): string {
  return masked ? MASK : text;
}

/* ---------------------- localStorage (SSR güvenli) ------------------ */

export function readMaskPreference(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MASK_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeMaskPreference(masked: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MASK_STORAGE_KEY, masked ? '1' : '0');
  } catch {
    /* gizli mod / kota dolu — tercih hatırlanmaz, uygulama çalışmaya devam eder */
  }
}
