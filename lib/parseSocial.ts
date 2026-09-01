/**
 * YATIRIM TERMİNALİ — SOSYAL MEDYA AÇIŞTIRICI (SAF FON, BAĞIMLILIK YOK)
 *
 * TEK KAYNAK: hem /api/social-parse (UI) hem GitHub Actions twitter-sync
 * hattı bu modülü kullanır.
 *
 * Desteklenen formatlar (@sevketozhan):
 *   A) Tahmin:      "#TLY 0,53"       → yüzde YOK, virgül ondalık  → value 0.53
 *   B) Gerçekleşen: "#TLY +0.8218%"   → yüzde VAR, nokta ondalık  → value 0.8218
 *   Legacy (serbest metin): "TLY 0.45% bekliyorum", "TLY %1.2", "yüzde 0.45"
 *
 * KURAL 4 (uydurma YOK): Sayı çözülemezse value=null döner (VERİ EKSİK).
 * |value| > 30 → günlük getiri olarak mantıksız → yine value=null.
 */

export interface ParsedSocial {
  /** Fon/hisse kodu (BÜYÜK HARF). Finans sinyali yoksa null. */
  fundCode: string | null;
  /** Getiri değeri (ör. 0.53 = %0.53). Çözülemezse null (VERİ EKSİK). */
  value: number | null;
  /** true = yüzde işareti var → "gerçekleşen" formatı (B). */
  hasPercentSign: boolean;
  /** Metinden @handle (yoksa null). */
  predictorHandle: string | null;
  /** Kategori (varsayılan GUNLUK_GETIRI; metin ipuçlarıyla incelenebilir). */
  category: string;
  /** Aynen metin (Rule 3: "bence" dili eklenmez, ham veri). */
  rawText: string;
}

/** Bilinen kodlar (portföy + @sevketozhan tweetlerindeki yaygın TEFAS fonları). */
export const KNOWN_SYMBOLS: string[] = [
  'TLY', 'DFI', 'KGM', 'TP2', 'THF', 'GUM', 'YZG', 'MJG', 'DMG', 'GMC',
  'TMV', 'PUK', 'TTE', 'PHE', 'PBR', 'KHA', 'DOH', 'AFT', 'CPU', 'IJC',
  'YAY', 'YIT', 'TPKG', 'TPKGY', 'TPKGYF1', 'HRZ', 'SNY', 'KLH',
  'SDTTR', 'KARCL', 'KTLEV', 'BALSU', 'TATEN', 'OZATD', 'ASELS', 'TERA',
  'TEHOL', 'BARMA', 'LIDER', 'NETCD', 'AKBNK',
  'BURCE', 'MASFN', 'SARAE', 'EKIM',
];

/** Bir günlük getiri olarak makul sınır; aşan değer "veri eksik" sayılır. */
const MAX_ABS_PCT = 30;

/** İşaret + sayı (virgül VEYA nokta ondalık). */
const NUM = '([+-]?)(\\d{1,4}(?:[.,]\\d{1,4})?)';

function parseNum(sign: string, num: string): number | null {
  const v = parseFloat(num.replace(',', '.'));
  if (!Number.isFinite(v)) return null;
  return sign === '-' ? -v : v;
}

function extractHandle(text: string): string | null {
  const m = text.match(/@([A-Za-z0-9_]{2,30})/);
  return m && m[1] ? `@${m[1]}` : null;
}

function detectCategory(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('kap') || lower.includes('bildirim')) return 'KAP_DUYURUSU';
  if (lower.includes('içerik') || lower.includes('portföy dağılım')) return 'ICERIK_DEGISIKLIGI';
  if (lower.includes('sektör') || lower.includes('bist') || lower.includes('faiz')) return 'SEKTOR_YORUMU';
  return 'GUNLUK_GETIRI';
}

export function parseSocialTweet(text: string): ParsedSocial {
  const rawText = text;
  const handle = extractHandle(text);
  const category = detectCategory(text);

  // 1) FORMAT A/B: #KOD + sayı (kodla sayı KOMŞU olmalı)
  //    "#TLY 0,53" | "#TLY +0.8218%" | "#DFI -0.24%" | "#TLY: 0.53"
  const tag = text.match(new RegExp(`#([A-Za-z]{2,5})\\s*[:=]?\\s*${NUM}\\s*(%?)`));
  if (tag && tag[1] && tag[2] !== undefined) {
    const fundCode = tag[1].toUpperCase();
    const value = parseNum(tag[2], tag[3]);
    const sane = value !== null && Math.abs(value) <= MAX_ABS_PCT;
    return {
      fundCode,
      value: sane ? value : null,
      hasPercentSign: tag[4] === '%',
      predictorHandle: handle,
      category,
      rawText,
    };
  }

  // 2) KOD tespiti: bilinen kod → yoksa 3-5 harfli büyük sembol
  const knownMatch = text.match(new RegExp(`\\b(${KNOWN_SYMBOLS.join('|')})\\b`, 'i'));
  let fundCode: string | null = knownMatch && knownMatch[1] ? knownMatch[1].toUpperCase() : null;
  if (!fundCode) {
    const generic = text.match(/\b([A-Z]{3,5})\b/);
    fundCode = generic && generic[1] ? generic[1] : null;
  }

  // 3) Legacy sayı formatları: 0.45% / %0.45 / yüzde 0.45
  let value: number | null = null;
  let hasPercentSign = false;
  const l1 = text.match(new RegExp(`([+-]?)${NUM}\\s*%`));
  const l2 = text.match(/%\s*([+-]?)(\d{1,4}(?:[.,]\d{1,4})?)/);
  const l3 = text.match(/yüzde\s*([+-]?)(\d{1,4}(?:[.,]\d{1,4})?)/i);
  if (l1) {
    // NUM iki grup ekler → l1: [1]=ek işaret, [2]=işaret, [3]=rakam
    value = parseNum(l1[2], l1[3]);
    hasPercentSign = true;
  } else if (l2) {
    value = parseNum(l2[1], l2[2]);
    hasPercentSign = true;
  } else if (l3) {
    value = parseNum(l3[1], l3[2]);
    hasPercentSign = false;
  }
  if (value !== null && Math.abs(value) > MAX_ABS_PCT) value = null;

  return { fundCode, value, hasPercentSign, predictorHandle: handle, category, rawText };
}

export interface ParsedSocialAll {
  fundCode: string;
  value: number | null;
  hasPercentSign: boolean;
}

/**
 * Bir tweet içinde birden fazla #KOD + sayı olabilir (örn: "#TLY 0,04 #DFI 0,23 #THF -0,34").
 * Bu fonksiyon tüm eşleşmeleri döner; sayı yoksa value=null (VERİ EKSİK) değil, atlanır
 * — çünkü "Açıklanmadı" gibi ifadeler veri eksik değil, o fon için tahmin yok demektir.
 * Tek fon + sayı yoksa çağıran taraf VERİ_EKSİK kararı verebilir.
 */
export function parseAllSocialTweets(text: string): ParsedSocialAll[] {
  const out: ParsedSocialAll[] = [];
  const seen = new Set<string>(); // fundCode|value dedupe
  // Global regex: #CODE [: =] NUM [%] — tüm 2-5 harfli kodlar (fon + hisse)
  const re = /#([A-Za-z]{2,5})\s*[:=]?\s*([+-]?\d{1,4}(?:[.,]\d{1,4})?)\s*(%?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const fundCode = m[1].toUpperCase();
    const numStr = m[2];
    const percent = m[3];
    // BIST100 gibi 6+ karakter zaten eşleşmez; bilinen portföy dışı BIST hisseleri de dahil olabilir ama sorun değil
    const sign = numStr[0] === '-' ? '-' : '';
    const numPart = numStr.replace(/^[+-]/, '');
    const v = parseFloat(numPart.replace(',', '.'));
    if (!Number.isFinite(v)) continue;
    const value = sign === '-' ? -v : v;
    if (Math.abs(value) > MAX_ABS_PCT) continue;
    const key = `${fundCode}|${value}|${percent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ fundCode, value, hasPercentSign: percent === '%' });
  }
  return out;
}

