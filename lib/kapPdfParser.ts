/**
 * KAP Portföy Dağılım Raporu PDF parser — TLY ve diğer fonlar için
 *
 * KAP PDF'leri metin tabanlıdır (taranmış değil). Tablo yapısı:
 *   MENKUL KIYMET | DÖVİZ | İHRAÇÇI | ... | TOPLAM DEĞER | GRUP (%) | FPD | FTD
 *
 * Örnek satır (pipe'lı markdown'tan veya düz metinden):
 *   DSTKF TL DESTEK FAKTORING ... 6,797,248,065.00 38,36 36,91 37,28
 *   PEHOL TL Pera Yatırım ... 5,447,827,275.00 30,75 29,60 29,88
 *
 * Aynı ticker birden fazla lot halinde görünebilir → ağırlıklar toplanır.
 *
 * Kurallar (kullanıcı şartları):
 *  - %0.01 altı atılır (MIN_IMPACT_PCT)
 *  - Sayı çekilemeyen satır atılır, uydurma yok
 *  - Tarih: başlıkta "Nisan-2025" veya "Temmuz 2025" → ay sonu YYYY-MM-DD
 *  - Doğrulama: toplam ağırlık >100.01 veya <1 ise hata
 */

import { MIN_IMPACT_PCT, type ParsedFundContent, type FundHolding } from './fundHoldings';

const TR_MONTHS: Record<string, number> = {
  ocak: 1, subat: 2, şubat: 2, mart: 3, nisan: 4, mayis: 5, mayıs: 5,
  haziran: 6, temmuz: 7, agustos: 8, ağustos: 8, eylul: 9, eylül: 9,
  ekim: 10, kasim: 11, kasım: 11, aralik: 12, aralık: 12,
};

function parseNumTR(s: string): number | null {
  // "38,36" → 38.36, "22.358.551,50" → 22358551.5 (nokta binlik ayırıcı)
  let t = s.trim().replace(/\u00a0/g, '').replace(/%/g, '').trim();
  if (!t) return null;
  // Binlik noktaları temizle, virgülü noktaya çevir
  // Eğer hem . hem , varsa: son virgül ondalık
  if (t.includes(',') && t.includes('.')) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (t.includes(',')) {
    t = t.replace(',', '.');
  }
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function monthEndFromLabel(label: string): string | null {
  // "Nisan-2025" veya "Nisan 2025" veya "Temmuz 2025"
  const m = label.toLowerCase().match(/(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)[\s\-]+(\d{4})/);
  if (!m) return null;
  const month = TR_MONTHS[m[1]] ?? null;
  const year = parseInt(m[2], 10);
  if (!month || year < 2000 || year > 2100) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function extractReportDate(text: string): { asOfDate: string | null; label: string | null } {
  // Öncelik: "Nisan-2025" başlıkta
  const patterns = [
    /(Ocak|Şubat|Subat|Mart|Nisan|Mayıs|Mayis|Haziran|Temmuz|Ağustos|Agustos|Eylül|Eylul|Ekim|Kasım|Kasim|Aralık|Aralik)[\s\-]+20\d{2}/gi,
    /20\d{2}\s*[-–]\s*(Ocak|Şubat|Subat|Mart|Nisan|Mayıs|Mayis|Haziran|Temmuz|Ağustos|Agustos|Eylül|Eylul|Ekim|Kasım|Kasim|Aralık|Aralik)/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const label = m[0].trim();
      const asOf = monthEndFromLabel(label);
      if (asOf) return { asOfDate: asOf, label };
    }
  }
  // Fallback: "30/04/25" gibi tarihlerden en güncel olanı al, ay sonuna çevir
  const dateRe = /(\d{2})\/(\d{2})\/(\d{2,4})/g;
  let latest: Date | null = null;
  let mm: RegExpExecArray | null;
  while ((mm = dateRe.exec(text)) !== null) {
    const d = parseInt(mm[1], 10);
    const mo = parseInt(mm[2], 10);
    let y = parseInt(mm[3], 10);
    if (y < 100) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (!latest || dt > latest) latest = dt;
  }
  if (latest) {
    const y = latest.getUTCFullYear();
    const mo = latest.getUTCMonth() + 1;
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const asOf = `${y}-${String(mo).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { asOfDate: asOf, label: `${y}-${mo} raporu (tarihten türetildi)` };
  }
  return { asOfDate: null, label: null };
}

/**
 * Ham PDF metninden (pdf-parse çıktısı) fon içeriğini çıkarır.
 * Pipe'lı markdown (fetch_page) veya düz metin ikisini de destekler.
 */
export function parseKapPdfHoldings(rawText: string, fundCode: string): ParsedFundContent {
  const holdingsMap = new Map<string, { name: string | null; weight: number; count: number }>();
  let excludedCount = 0;

  const lines = rawText.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Başlık satırlarını atla
    if (/MENKUL\s+KIYMET|GRUP\s*\(%\)|HİSSE\s+SENETLERİ|GRUP\s+TOPLAMI|FON\s+PORTFÖY|B-\)HAZIR|C-\)ALACAK/i.test(trimmed)) continue;
    if (trimmed.length < 10) continue;

    let ticker: string | null = null;
    let weight: number | null = null;
    let companyName: string | null = null;

    // Pipe'lı format (fetch_page markdown)
    if (trimmed.includes('|')) {
      const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
      if (cells.length < 3) continue;
      const first = cells[0].toUpperCase();
      // Ticker 2-5 harf, sadece A-Z0-9
      if (!/^[A-Z0-9]{2,5}$/.test(first)) continue;
      ticker = first;
      // Şirket adı genellikle 2. veya 3. hücrede değil, ama 2. hücrede olabilir
      // Biz 2. hücreyi şirket adı olarak al (eğer TL değilse)
      // Ağırlık: sondan 3. hücre GRUP (%)
      // Örnek: [..., TOPLAM DEGER, GRUP, FPD, FTD]
      // Son 4 hücre: değer, grup, fpd, ftd — grup = sondan 3.
      if (cells.length >= 4) {
        const grupStr = cells[cells.length - 3];
        weight = parseNumTR(grupStr);
      }
      // Şirket adı: 2. hücre TL ise 3. hücre, değilse 1. hücre sonrası
      if (cells.length >= 2) {
        const second = cells[1];
        if (second !== 'TL' && second.length > 3) companyName = second;
        else if (cells.length >= 3) companyName = cells[2];
      }
    } else {
      // Düz metin formatı: "DSTKF TL DESTEK FAKTORING ... 38,36 36,91 37,28"
      // Ticker en başta
      const firstTokenMatch = trimmed.match(/^([A-Z0-9]{2,5})\s+/);
      if (!firstTokenMatch) continue;
      const candidate = firstTokenMatch[1];
      if (!/^[A-Z]{2,5}$/.test(candidate)) continue; // sadece harf olanlar hisse, AC2 gibi fonlar da olabilir ama atlamayalım
      // Sayı içermeyen ve TL'den sonra gelen kısım şirket adı olabilir
      ticker = candidate;

      // Satır sonunda 3 adet yüzde var mı? Örn: "0,13 0,12 0,12" veya "38,36 36,91 37,28"
      // Regex: son 3 sayı (virgüllü) satır sonunda
      const tailMatch = trimmed.match(/(\d{1,3},\d{1,2})\s+(\d{1,3},\d{1,2})\s+(\d{1,3},\d{1,2})\s*$/);
      if (tailMatch) {
        weight = parseNumTR(tailMatch[1]); // GRUP ilk
      } else {
        // Bazen sadece 1 yüzde var: "0,13"
        const singleTail = trimmed.match(/(\d{1,3},\d{1,2})\s*$/);
        if (singleTail) weight = parseNumTR(singleTail[1]);
      }

      // Şirket adı: ticker ile ilk sayı bloğu arası
      if (weight !== null) {
        const withoutTicker = trimmed.slice(candidate.length).trim();
        // İlk sayı bloğuna kadar olan kısım
        const numStart = withoutTicker.search(/\d/);
        if (numStart > 3) {
          let namePart = withoutTicker.slice(0, numStart).trim();
          // TL ve benzeri at
          namePart = namePart.replace(/^\s*TL\s+/i, '').trim();
          if (namePart.length >= 3 && namePart.length <= 80) companyName = namePart;
        }
      }
    }

    if (!ticker || weight === null) continue;
    if (!Number.isFinite(weight)) continue;
    if (weight < 0 || weight > 100) continue;
    if (weight < MIN_IMPACT_PCT) { excludedCount++; continue; }

    // Aynı ticker birden fazla lot → topla
    const existing = holdingsMap.get(ticker);
    if (existing) {
      existing.weight += weight;
      existing.count += 1;
    } else {
      holdingsMap.set(ticker, { name: companyName, weight, count: 1 });
    }
  }

  const holdings: FundHolding[] = [];
  holdingsMap.forEach((v, ticker) => {
    holdings.push({
      ticker,
      name: v.name,
      weightPct: Number(v.weight.toFixed(4)),
      prevWeightPct: null,
    });
  });

  holdings.sort((a, b) => b.weightPct - a.weightPct);

  const { asOfDate, label } = extractReportDate(rawText);

  return {
    fundCode,
    asOfDate,
    reportLabel: label ?? (asOfDate ? `KAP PDF raporu (dönem sonu ${asOfDate})` : 'KAP PDF raporu'),
    holdings,
    excludedCount,
    source: 'kap-pdf',
  };
}

export function validateKapParsed(p: ParsedFundContent): { ok: boolean; reason: string | null } {
  if (p.holdings.length === 0) return { ok: false, reason: 'hiç hisse bulunamadı (PDF metni okunamadı veya tablo formatı değişmiş)' };
  const total = p.holdings.reduce((s, h) => s + h.weightPct, 0);
  // KAP PDF'inde hisse senetleri grubu 100 değil, tüm fon 100. Hisse oranı %96 gibi olabilir.
  // Bu yüzden 100 üstü hata, 1 altı hata, ama 50-100 arası OK (serbest fon)
  if (total > 100.5) return { ok: false, reason: `ağırlık toplamı %${total.toFixed(2)} > 100 (parse hatası)` };
  if (total < 1) return { ok: false, reason: `ağırlık toplamı %${total.toFixed(2)} < 1 (parse hatası)` };
  return { ok: true, reason: null };
}
