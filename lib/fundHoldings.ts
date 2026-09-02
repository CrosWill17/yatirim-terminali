/**
 * fundHoldings.ts — Fon içeriği: saf (side-effect'siz) parse + tahmin matematiği.
 *
 * KAYNAKLAR (araştırma sonucu, 26.08.2026):
 *  - KAP (kap.org.tr)          → RESMİ kaynak. Aylık "Portföy Dağılım Raporu" PDF'leri.
 *                                JS-rendered liste + PDF → v1'de otomasyon KESİN KAYNAK olarak
 *                                değil, REFERANS/link olarak kullanılır (Faz 4: PDF parser).
 *  - rotaborsa.com (TLY)       → tam hisse listesi, günlük güncellenen tablo (v1 birincil).
 *  - fintables.com/fonlar/CODE → "En Büyük Pozisyonlar" + ağırlık değişimleri (v1: DFI).
 *  - Manuel override           → UI formu; source='manual' satırları otomatik job asla ezmez.
 *
 * KURALLAR:
 *  - Fona etkisi %0.01'in ALTINDA olan hisse dışlanır (filtre, kullanıcı şartı).
 *  - Sayı çekilemeyen satır atılır; değer UYDURMAZ.
 *  - Çıktılar hep saf veri (isim + ağırlık + tarih). Yorum yok.
 */

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface FundHolding {
  ticker: string;
  name: string | null;
  weightPct: number;        // fon içindeki ağırlık (%)
  prevWeightPct: number | null;
}

export interface ParsedFundContent {
  fundCode: string;
  asOfDate: string | null;  // rapor dönemi sonu (YYYY-MM-DD) — çözülemezse null
  reportLabel: string | null; // ör. "Temmuz 2026 portföy dağılım raporu"
  holdings: FundHolding[];
  excludedCount: number;    // %0.01 filtresiyle dışlanan satır sayısı
  source: string;           // 'rotaborsa' | 'fintables' | 'manual'
}

export interface HoldingPrice {
  price: number;
  changePct: number;        // günlük değişim (%) — önceki kapanışa göre
}

export interface FundPrediction {
  fundCode: string;
  predictedPct: number | null; // tahmini günlük getiri (%)
  coveredPct: number;          // hesaplanan hisselerin fon ağırlığı toplamı (%)
  contributions: { ticker: string; weightPct: number; changePct: number; impactPct: number }[];
  missingTickers: string[];    // fiyatı alınamayan hisseler
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

/** Fona etkisi %0.01'in altındaki hisse hesaplamaya girmez (kullanıcı şartı). */
export const MIN_IMPACT_PCT = 0.01;

/** Ticker değil: para birimi / meta etiketleri ("Son Fiyat (TL)" sahtesini eleyin). */
const NON_TICKER_TOKENS = new Set(['TL', 'TRY', 'USD', 'EUR', 'GBP', 'CHF', 'XAU', 'XAG', 'BIST', 'KAP']);

export interface FundSourceConfig {
  code: string;
  name: string;
  kind: 'rotaborsa' | 'fintables' | 'gold-proxy' | 'none';
  url: string | null;
}

/** Portföydeki fonlar ve veri kaynakları — TEK KAYNAK fundCodes.ts ile senkron */
export const FUND_SOURCES: FundSourceConfig[] = [
  { code: 'TLY', name: 'TERA PORTFÖY BİRİNCİ SERBEST FON', kind: 'rotaborsa',
    url: 'https://rotaborsa.com/tera-portfoy-birinci-serbest-fon-tly-guncel-hisse-dagilimi/' },
  { code: 'DFI', name: 'ATLAS PORTFÖY SERBEST FON', kind: 'fintables', url: 'https://fintables.com/fonlar/DFI' },
  { code: 'THF', name: 'TERA PORTFÖY HİSSE SENEDİ (TL) FONU (HİSSE SENEDİ YOĞUN FON)', kind: 'fintables', url: 'https://fintables.com/fonlar/THF' },
  // Genişletme: portföyde görülen diğer TEFAS fonları (fintables üzerinden)
  { code: 'GUM', name: 'GUM - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/GUM' },
  { code: 'YZG', name: 'YZG - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/YZG' },
  { code: 'MJG', name: 'MJG - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/MJG' },
  { code: 'DMG', name: 'DMG - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/DMG' },
  { code: 'GMC', name: 'GMC - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/GMC' },
  { code: 'AK2', name: 'AK2 - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/AK2' },
  { code: 'TMV', name: 'TMV - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/TMV' },
  { code: 'PUK', name: 'PUK - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/PUK' },
  { code: 'TTE', name: 'TTE - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/TTE' },
  { code: 'PHE', name: 'PHE - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/PHE' },
  { code: 'PBR', name: 'PBR - TEFAS FON', kind: 'fintables', url: 'https://fintables.com/fonlar/PBR' },
  // KGM = gümüş katılım fonu (hisse yok → v2: gümüş proxy'si); TP2 = para piyasası (hisse yok)
  { code: 'KGM', name: 'KUVEYT TÜRK PORTFÖY GÜMÜŞ KATILIM FON SEPETİ FONU', kind: 'gold-proxy', url: null },
  { code: 'TP2', name: 'TERA PORTFÖY PARA PİYASASI (TL) FONU', kind: 'none', url: null },
];

const TR_MONTHS: Record<string, number> = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5, haziran: 6,
  temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9, ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12,
};

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function norm(s: string): string {
  return s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripTags(html: string): string {
  return norm(html.replace(/<[^>]*>/g, ' '));
}

function parseNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/%/g, '').replace(/\s/g, '').replace(',', '.');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "Temmuz 2026" → "2026-07-31" (dönem sonu). Çözülemezse null. */
export function monthEndOfLabel(label: string): string | null {
  const m = label.toLowerCase().match(/(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralık|aralik)\s+(\d{4})/);
  if (!m) return null;
  const month = TR_MONTHS[m[1].replace(/ı/g, 'i')] ?? null;
  const year = parseInt(m[2], 10);
  if (!month || year < 2000 || year > 2100) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * "26 Ağustos 2026" (sayfa GÜNCELLEME tarihi) → bir önceki ayın sonu "2026-07-31".
 * Gerekçe: KAP aylık portföy raporu, rapor ayından SONRAKİ ayın 1-10'u arası yayınlanır;
 * yani güncelleme tarihi M ayıysa, sayfada duran ağırlıklar M-1 ayına aittir.
 */
export function prevMonthEndOfDate(day: string, monthLabel: string, year: string): string | null {
  const monthNum = TR_MONTHS[monthLabel.toLowerCase().replace(/ı/g, 'i')] ?? null; // 1 tabanlı
  const y = parseInt(year, 10);
  const d = parseInt(day, 10);
  if (!monthNum || y < 2000 || y > 2100 || d < 1 || d > 31) return null;
  // Önceki ayın (monthNum-1) son günü: Date.UTC(y, 0-tabanlı indeks, 0) = bir önceki ayın sonu
  const prevEnd = new Date(Date.UTC(y, monthNum - 1, 0));
  return `${prevEnd.getUTCFullYear()}-${String(prevEnd.getUTCMonth() + 1).padStart(2, '0')}-${String(prevEnd.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// rotaborsa.com parser (TLY)
// ---------------------------------------------------------------------------

/**
 * rotaborsa.com fon sayfasının "fonu hisseleri" tablosunu çözer.
 * Markup'a bağımlı olmadan çalışır: <tr> satırlarını tarar; ilk hücrede
 * (TICKER) deseni + hücrelerde %ağırlık taşıyan satırları kabul eder.
 */
export function parseRotaborsaHoldings(html: string, fundCode: string): ParsedFundContent {
  const holdings: FundHolding[] = [];
  let excludedCount = 0;
  const seen = new Set<string>();

  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  for (const row of rows) {
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => stripTags(m[1]));
    if (cells.length < 2) continue;

    // Ticker: "Şirket adı (TICKER)" deseni — BIST: 2-5 büyük harf.
    const tickerMatch = cells[0].match(/\(([A-Z]{2,5})\)/);
    if (!tickerMatch) continue;
    const ticker = tickerMatch[1];
    if (NON_TICKER_TOKENS.has(ticker)) continue; // "Son Fiyat (TL)" gibi sahte eşleşmeler
    const name = norm(cells[0].replace(/\([A-Z]{2,5}\)/, '')) || null;
    if (!name || name.length < 3) continue; // "ad" olmayan hücreler (ör. yalnızca "(TL)")

    // Ağırlık hücresi mutlaka % formatında olmalı (fiyat/aded tablolarından ayrım)
    const weightCell = norm(cells[1]);
    if (!/^%[\d.,]+$/.test(weightCell)) continue;
    const weight = parseNum(weightCell);
    if (weight === null) continue;
    const prev = cells.length > 2 ? parseNum(norm(cells[2])) : null;

    if (weight < MIN_IMPACT_PCT) { excludedCount++; continue; }
    if (seen.has(ticker)) continue;
    seen.add(ticker);
    holdings.push({ ticker, name, weightPct: weight, prevWeightPct: prev });
  }

  holdings.sort((a, b) => b.weightPct - a.weightPct);

  // Güncelleme tarihi: "26 Ağustos 2026, 11:47 güncellendi" → rapor dönemi = önceki ay sonu
  const asOfMatch = html.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]{3,12})\s+(\d{4})[^\n]{0,60}güncell/i);
  const asOfDate = asOfMatch ? prevMonthEndOfDate(asOfMatch[1], asOfMatch[2], asOfMatch[3]) : null;

  return {
    fundCode, asOfDate,
    reportLabel: asOfDate ? `KAP aylık raporu (dönem sonu ${asOfDate})` : null,
    holdings, excludedCount, source: 'rotaborsa',
  };
}

// ---------------------------------------------------------------------------
// fintables.com parser
// ---------------------------------------------------------------------------

/**
 * fintables.com/fonlar/{CODE} sayfasındaki pozisyon kartlarını çözer.
 * Kart yapısı: <a href=".../sirketler/{TICKER}"> <img alt="{Şirket} Şirket Logosu"> %ağırlık %değişim </a>
 * (href ÖNCE, ad/alt SONRA gelir — sırayı karıştırmayın.)
 * Kart sayfada birden fazla kez görünür (En Büyük / Artırılan / Azaltılan) → ticker'a göre tekilleştir.
 */
export function parseFintablesHoldings(html: string, fundCode: string): ParsedFundContent {
  const holdings: FundHolding[] = [];
  let excludedCount = 0;
  const seen = new Map<string, FundHolding>();

  const cardRe = /sirketler\/([A-Za-z0-9]{2,12})"[\s\S]{0,400}?(?:alt="([^"]*?)(?: Şirket Logosu)?"[\s\S]{0,200}?)?%([\d.,]+)[\s\S]{0,200}?%(-?[\d.,]+)?/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const name = m[2] ? norm(m[2]) || null : null;
    const ticker = m[1].toUpperCase();
    const weight = parseNum(m[3]);
    // "değişim" sütunu = aylık ağırlık farkı → önceki ağırlık = güncel − değişim
    const change = m[4] ? parseNum(m[4]) : null;
    if (weight === null) continue;
    if (seen.has(ticker)) continue;
    if (weight < MIN_IMPACT_PCT) { excludedCount++; continue; }
    seen.set(ticker, { ticker, name, weightPct: weight, prevWeightPct: change !== null ? weight - change : null });
  }

  seen.forEach((h) => holdings.push(h));
  holdings.sort((a, b) => b.weightPct - a.weightPct);

  // Rapor dönemi: "... 10 Ağustos tarihinde açıklanan Temmuz 2026 portföy dağılım raporu ..."
  // (etiket <strong> içine gömülü olabilir → tag'leri silip ara)
  const plain = stripTags(html);
  let asOfDate: string | null = null;
  let reportLabel: string | null = null;
  const pm = plain.match(/açıklanan\s+([\wçğıöşü ]+?\s+\d{4})\s+portföy dağılım raporu/i);
  if (pm) {
    reportLabel = `${pm[1].trim()} portföy dağılım raporu`;
    asOfDate = monthEndOfLabel(pm[1]);
  }

  return { fundCode, asOfDate, reportLabel, holdings, excludedCount, source: 'fintables' };
}

// ---------------------------------------------------------------------------
// Tahmin matematiği
// ---------------------------------------------------------------------------

/**
 * Fonun tahmini günlük getirisi: Σ (ağırlık_i × hisse_değişim_i) / 100
 * coveredPct = hesaplanan hisselerin fon ağırlığı toplamı (fonun hisse oranı).
 * Fiyatı eksik olan hisse: katkı 0 sayılır, missingTickers'a yazılır (uydurma yok).
 */
export function computeFundPrediction(
  fundCode: string,
  holdings: FundHolding[],
  prices: Record<string, HoldingPrice | null>,
): FundPrediction {
  let predicted = 0;
  let covered = 0;
  const contributions: FundPrediction['contributions'] = [];
  const missingTickers: string[] = [];

  for (const h of holdings) {
    const p = prices[h.ticker] ?? null;
    if (!p || !Number.isFinite(p.price) || !Number.isFinite(p.changePct)) {
      missingTickers.push(h.ticker);
      continue;
    }
    const impact = (h.weightPct * p.changePct) / 100; // pp
    predicted += impact;
    covered += h.weightPct;
    contributions.push({
      ticker: h.ticker,
      weightPct: h.weightPct,
      changePct: p.changePct,
      impactPct: impact,
    });
  }

  contributions.sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
  return {
    fundCode,
    predictedPct: predicted,
    coveredPct: covered,
    contributions,
    missingTickers,
  };
}

// ---------------------------------------------------------------------------
// Supabase satırları (Actions job'u kullanır)
// ---------------------------------------------------------------------------

export interface HoldingRow {
  fund_code: string;
  ticker: string;
  company_name: string | null;
  weight_pct: number;
  as_of_date: string;
  source: 'auto' | 'manual' | 'kap-pdf' | 'calibration' | 'fintables' | 'rotaborsa';
  notes: string | null;
}

/** Dışlanan satır sayısı notes alanına bu etiketle yazılır (şema değişikliği yok). */
export const EXCLUDED_TAG = 'dışlanan';

export function toHoldingRows(parsed: ParsedFundContent): HoldingRow[] {
  const base = parsed.reportLabel ?? parsed.source;
  // Düşük etkili (< MIN_IMPACT_PCT) satır sayısı yalnızca parse anında bilinebilir;
  // UI'da gösterebilmek için notes'a eklenir (uydurma yok: yoksa hiç yazılmaz).
  const notes = parsed.excludedCount > 0 ? `${base} | ${EXCLUDED_TAG}: ${parsed.excludedCount}` : base;
  return parsed.holdings.map((h) => ({
    fund_code: parsed.fundCode,
    ticker: h.ticker,
    company_name: h.name,
    weight_pct: h.weightPct,
    as_of_date: parsed.asOfDate ?? new Date().toISOString().slice(0, 10),
    source: 'auto' as const,
    notes,
  }));
}

/** notes içine gömülü dışlanan satır sayısını geri okur; yoksa null. */
export function excludedFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = notes.match(new RegExp(`${EXCLUDED_TAG}\\s*:\\s*(\\d+)`));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* ---------------------------------------------------------------------------
 * Fon içeriği özeti (UI — "Fon İçeriği" sekmesi başlık satırı)
 * --------------------------------------------------------------------------- */

export interface SummaryRow {
  fund_code: string;
  ticker: string;
  company_name: string | null;
  weight_pct: number;
  as_of_date: string;
  source: string;
  notes: string | null;
}

export interface FundSummary {
  fundCode: string;
  /** En güncel rapor dönemi (satırların max'ı). */
  asOfDate: string | null;
  /** Satırların kaynakları (auto / manual karışabilir). */
  sources: string[];
  rowCount: number;
  manualCount: number;
  /** Ağırlık toplamı (%) — 100'ü aşarsa parse/veri hatası işaretidir. */
  totalWeightPct: number;
  /** Düşük etkili satır sayısı (biliniyorsa); null = kayıtta yok. */
  excludedCount: number | null;
}

/** fund_holdings satırlarını fon bazında özetler (saf fonksiyon). */
export function summarizeHoldingRows(rows: SummaryRow[]): FundSummary[] {
  const byFund = new Map<string, SummaryRow[]>();
  rows.forEach((r: SummaryRow) => {
    const list = byFund.get(r.fund_code) ?? [];
    list.push(r);
    byFund.set(r.fund_code, list);
  });

  const fundCodes = Array.from(byFund.keys()).sort((a, b) => a.localeCompare(b));
  const out: FundSummary[] = [];
  for (const fundCode of fundCodes) {
    const list: SummaryRow[] = byFund.get(fundCode) ?? [];
    const dates = list.map((r: SummaryRow) => r.as_of_date).filter(Boolean).sort();
    let excluded: number | null = null;
    for (const r of list) {
      const e = excludedFromNotes(r.notes);
      if (e !== null) { excluded = e; break; }
    }
    const sources: string[] = [];
    for (const r of list) if (sources.indexOf(r.source) === -1) sources.push(r.source);
    out.push({
      fundCode,
      asOfDate: dates.length > 0 ? dates[dates.length - 1] : null,
      sources: sources.sort(),
      rowCount: list.length,
      manualCount: list.filter((r: SummaryRow) => r.source === 'manual').length,
      totalWeightPct: Number(
        list.reduce((s: number, r: SummaryRow) => s + (Number.isFinite(r.weight_pct) ? r.weight_pct : 0), 0).toFixed(4)
      ),
      excludedCount: excluded,
    });
  }
  return out;
}

/** Parse sonuçlarını doğrulama (Actions job'u: yoruma girmeden durdurur). */
export function validateParsed(p: ParsedFundContent): { ok: boolean; reason: string | null } {
  if (p.holdings.length === 0) return { ok: false, reason: 'hiç hisse bulunamadı (sayfa yapısı değişmiş olabilir)' };
  const total = p.holdings.reduce((s, h) => s + h.weightPct, 0);
  if (total > 100.0001) return { ok: false, reason: `ağırlık toplamı %${total.toFixed(2)} > 100 (parse hatası)` };
  if (total < 1) return { ok: false, reason: `ağırlık toplamı %${total.toFixed(2)} < 1 (parse hatası)` };
  return { ok: true, reason: null };
}

/**
 * GÖSTERİLEBİLİR TAHMİN (v1 kuralı: uydurma yok)
 *
 * Fon içeriği kaydı olmayan fonlar (KGM = gümüş katılım, TP2 = para piyasası)
 * için ağırlıklı tahmin HESAPLANAMAZ → arayüz "—" gösterir.
 * Fiyatı çözülemeyen hisseler yüzünden hiçbir katkı hesaplanamadıysa da null döner.
 */
export function displayablePrediction(p: FundPrediction | null | undefined): FundPrediction | null {
  if (!p || p.contributions.length === 0) return null;
  return p;
}
