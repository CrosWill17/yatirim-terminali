/**
 * TEK KAYNAK — Fon kodları ve vergi/PPF ayrımı
 *
 * Bu dosya portföy bileşimini ELE VERMEZ — yalnızca TEFAS'ta var olan
 * fon kodlarının listesi ve tür sınıflandırması. Kanonik adlar hâlâ
 * serverSeed.ts / /api/asset-meta üzerinden gelir.
 */

export const TEFAS_FON_CODES = [
  'TLY', 'DFI', 'THF', 'GUM', 'YZG', 'MJG', 'DMG', 'GMC', 'AK2',
  'TMV', 'PUK', 'TTE', 'PHE', 'PBR', 'KHA', 'DOH', 'AFT',
] as const;

export const PPF_CODES = ['TP2'] as const;

export const GOLD_PROXY_CODES = ['KGM'] as const;

/** Portföyde görülebilecek tüm fon kodları (BIST hissesi değil). */
export const ALL_FUND_CODES = [
  ...TEFAS_FON_CODES,
  ...PPF_CODES,
  ...GOLD_PROXY_CODES,
] as const;

/** Hisse senedi yoğun fonlar — stopaj %0 (THF vb.). */
export const EQUITY_INTENSIVE_FUNDS = ['THF'] as const;

export type FundCode = typeof ALL_FUND_CODES[number];

/** Kod fon mu? (TEFAS + PPF + gold proxy) */
export function isFundCode(code: string): boolean {
  const c = code.trim().toUpperCase();
  return (ALL_FUND_CODES as readonly string[]).includes(c);
}

/** Kod TEFAS fonu mu (PPF hariç)? */
export function isTefasFund(code: string): boolean {
  const c = code.trim().toUpperCase();
  return (TEFAS_FON_CODES as readonly string[]).includes(c);
}

export function isPpfCode(code: string): boolean {
  const c = code.trim().toUpperCase();
  return (PPF_CODES as readonly string[]).includes(c);
}

export function isGoldProxyCode(code: string): boolean {
  const c = code.trim().toUpperCase();
  return (GOLD_PROXY_CODES as readonly string[]).includes(c);
}

export function isEquityIntensiveFund(code: string): boolean {
  const c = code.trim().toUpperCase();
  return (EQUITY_INTENSIVE_FUNDS as readonly string[]).includes(c);
}

export function shouldAutoResearchFund(code: string): boolean {
  const c = code.trim().toUpperCase();
  // PPF ve gold-proxy fonların hisse içeriği yok
  return isTefasFund(c);
}
