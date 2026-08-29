/**
 * HALKA AÇIK İZLEME LİSTESİ (P1 — Misafir Modu)
 *
 * Site Vercel'de herkese açık. Giriş yapmamış ziyaretçiye YALNIZCA kamuya açık
 * piyasa verisi gösterilir: endeksler, bu listedeki standart hisseler ve
 * altın/gümüş enstrümanları. Portföye ait HİÇBİR kod/ad/tutar bu dosyada yok.
 *
 * Listeyi değiştirmek için tek yer: bu dosya.
 *
 * `verified` alanı: ticker fiyat kaynağıyla (Yahoo chart / fonaly) doğrulandı mı?
 * Doğrulanmamış ya da fiyatı çözülemeyen satır arayüzde "VERİ EKSİK" olarak
 * gösterilir — değer UYDURULMAZ.
 */

export type PublicKind = 'HISSE' | 'ALTIN' | 'GUMUS' | 'ETF';

export interface PublicInstrument {
  /** Ekranda gösterilen kod. */
  symbol: string;
  /** Fiyat kaynağındaki (Yahoo) sembol. */
  yahoo: string;
  /** Resmî/kamuya açık ad. */
  name: string;
  kind: PublicKind;
  /** Fiyat kaynağıyla doğrulandı mı? false → fiyat yoksa "VERİ EKSİK". */
  verified: boolean;
  /** Grup başlığı (tabloda gruplama için). */
  group: string;
}

/** BIST 100 içinden standart izleme listesi (kamuya açık, likit hisseler). */
export const PUBLIC_WATCHLIST: PublicInstrument[] = [
  { symbol: 'THYAO', yahoo: 'THYAO.IS', name: 'Türk Hava Yolları A.O.', kind: 'HISSE', verified: true, group: 'BIST 100 — HAVACILIK' },
  { symbol: 'GARAN', yahoo: 'GARAN.IS', name: 'Türkiye Garanti Bankası A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — BANKA' },
  { symbol: 'AKBNK', yahoo: 'AKBNK.IS', name: 'Akbank T.A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — BANKA' },
  { symbol: 'YKBNK', yahoo: 'YKBNK.IS', name: 'Yapı ve Kredi Bankası A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — BANKA' },
  { symbol: 'ISCTR', yahoo: 'ISCTR.IS', name: 'Türkiye İş Bankası A.Ş. (C)', kind: 'HISSE', verified: true, group: 'BIST 100 — BANKA' },
  { symbol: 'ASELS', yahoo: 'ASELS.IS', name: 'Aselsan Elektronik Sanayi ve Ticaret A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — SAVUNMA' },
  { symbol: 'TUPRS', yahoo: 'TUPRS.IS', name: 'Türkiye Petrol Rafinerileri A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — ENERJİ' },
  { symbol: 'SASA', yahoo: 'SASA.IS', name: 'Sasa Polyester Sanayi A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — KİMYA' },
  { symbol: 'KCHOL', yahoo: 'KCHOL.IS', name: 'Koç Holding A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — HOLDİNG' },
  { symbol: 'PETKM', yahoo: 'PETKM.IS', name: 'Petkim Petrokimya Holding A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — KİMYA' },
  { symbol: 'EREGL', yahoo: 'EREGL.IS', name: 'Ereğli Demir ve Çelik Fabrikaları T.A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — DEMİR ÇELİK' },
  { symbol: 'BIMAS', yahoo: 'BIMAS.IS', name: 'BİM Birleşik Mağazalar A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — PERAKENDE' },
  { symbol: 'TCELL', yahoo: 'TCELL.IS', name: 'Turkcell İletişim Hizmetleri A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — İLETİŞİM' },
  { symbol: 'ARCLK', yahoo: 'ARCLK.IS', name: 'Arçelik A.Ş.', kind: 'HISSE', verified: true, group: 'BIST 100 — BEYAZ EŞYA' },
];

/**
 * Altın / gümüş enstrümanları.
 *
 * Spot satırları (XAU_GRAM, XAU_ONS, XAG_ONS) mevcut piyasa modülünde zaten
 * canlı çekiliyor → verified: true.
 *
 * BYF/ETF satırları ADAY listedir: bu sandbox'tan fiyat kaynağına
 * ulaşılamadığı için ticker'lar henüz DOĞRULANMADI (verified: false).
 * Fiyatı çözülemeyen satır arayüzde "VERİ EKSİK" görünür; yanlış ticker
 * kullanıcıya asla uydurma fiyat göstermez. Doğrulama: Yahoo'da
 * `<yahoo>` sembolünü açıp fiyat göründüğünden emin olun, sonra
 * verified: true yapın.
 */
export const PUBLIC_PRECIOUS: PublicInstrument[] = [
  { symbol: 'XAU_GRAM', yahoo: 'GRAM_ALTIN', name: 'Gram Altın (TL) — BIST XGLD / türetilmiş', kind: 'ALTIN', verified: true, group: 'KIYMETLİ MADEN SPOT' },
  { symbol: 'XAU_ONS', yahoo: 'GC=F', name: 'Ons Altın (USD)', kind: 'ALTIN', verified: true, group: 'KIYMETLİ MADEN SPOT' },
  { symbol: 'XAG_ONS', yahoo: 'SI=F', name: 'Ons Gümüş (USD)', kind: 'GUMUS', verified: true, group: 'KIYMETLİ MADEN SPOT' },
  { symbol: 'ZGOLD', yahoo: 'ZGOLD.IS', name: 'Ziraat Portföy Altın BYF (BIST) — ticker doğrulanmadı', kind: 'ALTIN', verified: false, group: 'ALTIN FON / BYF' },
  { symbol: 'GCMGG', yahoo: 'GCMGG', name: 'Gümüş fonu (TEFAS) — kod doğrulanmadı', kind: 'GUMUS', verified: false, group: 'GÜMÜŞ FON / BYF' },
];

/** Misafir ekranında fiyatı çekilecek tüm Yahoo sembolleri (tekilleştirilmiş). */
export const PUBLIC_YAHOO_SYMBOLS: string[] = Array.from(
  new Set([...PUBLIC_WATCHLIST, ...PUBLIC_PRECIOUS].map((i) => i.yahoo))
);

/** Portföy kodları misafire ASLA gösterilmez — bu listeyle kesişim boş olmalı. */
export const FORBIDDEN_FOR_GUEST = ['BURCE', 'MASFN', 'SARAE', 'EKIM', 'TLY', 'DFI', 'KGM', 'TP2'];

export function publicInstruments(): PublicInstrument[] {
  return [...PUBLIC_WATCHLIST, ...PUBLIC_PRECIOUS];
}
