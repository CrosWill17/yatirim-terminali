/**
 * YATIRIM TERMİNALİ v3.1 — PİYASA VERİ MOTORU
 *
 * Katmanlı veri mimarisi (her enstrüman için en sağlam kaynağa düşer):
 *
 *   BIST 100 endeksi  → borsaningundemi.com piyasa ekranı (Yahoo'nun ^XU100
 *                       beslemesi 2019'dan beri donmuş olduğu için kullanılmaz)
 *   Gram altın        → borsaningundemi.com (BIST XGLD — perakende resmi fiyat)
 *                       → yoksa ons + USD/TRY ile türetilir
 *   USD/TRY, ons altın/gümüş, BIST hisseleri → Yahoo Finance chart API (range=1d,
 *                       tazelik kontrolü: regularMarketTime > 42 saat önceyse reddedilir)
 *   TEFAS fon NAV     → fonaly.com (birim pay fiyatı + günlük getiri)
 *   Seed              → hiçbir kaynağa ulaşılamayan ortamlar için gerçek
 *                       25.08.2026 KAPANIŞ snapshot'ı (resmi kapanış verileri)
 *
 * Yanıt her zaman `source: 'live' | 'seed'` bildirir; arayüz buna göre
 * "CANLI" veya "SON VERİ" rozetini gösterir.
 */

import { calculateGramGold, calculateGoldSilverRatio } from './calculations';

export interface MarketQuote {
  price: number;
  /** Günlük değişim (%). Bilinmiyorsa null. */
  changePct: number | null;
  /** Verinin ait olduğu iş günü / saat (ör. "25.08.2026"). */
  asOf?: string;
}

export interface MarketData {
  source: 'live' | 'seed';
  /** Bu snapshot'ın üretildiği an (ISO). */
  timestamp: string;
  /** Fiyatların ait olduğu iş günü (DD.MM.YYYY). */
  dataDate: string;
  indices: {
    xu100: MarketQuote;
    usdtry: MarketQuote;
    ounceGold: MarketQuote;
    gramGold: MarketQuote;
    ounceSilver: MarketQuote;
    goldSilverRatio: {
      value: number;
      status: 'GUMUS_PAHALI' | 'GUMUS_UCUZ' | 'DENGEDE';
      interpretation: string;
    };
    interestRate: { value: number; inflation: number };
  };
  /** Portföydeki her kod için son bilinen fiyat. */
  positions: Record<string, MarketQuote>;
}

/* ------------------------------------------------------------------ */
/* SEED — Gerçek 25.08.2026 KAPANIŞ snapshot'ı                         */
/* Kaynaklar: borsaningundemi.com piyasa ekranı (kapanış), Yahoo       */
/* Finance (hisse kapanışları), fonaly.com/TEFAS (fon NAV).            */
/* ------------------------------------------------------------------ */

const SEED_RATIO = calculateGoldSilverRatio(4720.5, 68.915);

export const SEED_MARKET: MarketData = {
  source: 'seed',
  timestamp: '2026-08-25T21:00:00+03:00',
  dataDate: '25.08.2026',
  indices: {
    xu100: { price: 14433.63, changePct: -0.47, asOf: '25.08.2026 kapanış' },
    usdtry: { price: 48.1139, changePct: 0.05, asOf: '25.08.2026 kapanış' },
    ounceGold: { price: 4720.5, changePct: 0.2, asOf: '25.08.2026 kapanış' },
    gramGold: { price: 7220.45, changePct: 0.24, asOf: '25.08.2026 kapanış (BIST XGLD)' },
    ounceSilver: { price: 68.915, changePct: null, asOf: '25.08.2026 kapanış' },
    goldSilverRatio: {
      value: SEED_RATIO.ratio,
      status: SEED_RATIO.status,
      interpretation: SEED_RATIO.interpretation,
    },
    interestRate: { value: 37.0, inflation: 31.75 },
  },
  positions: {
    BURCE: { price: 36.48, changePct: 1.5, asOf: '25.08.2026 kapanış' },
    MASFN: { price: 43.06, changePct: -1.64, asOf: '25.08.2026 kapanış' },
    SARAE: { price: 87.1, changePct: -1.14, asOf: '25.08.2026 kapanış' },
    EKIM: { price: 18.82, changePct: -3.34, asOf: '25.08.2026 kapanış' },
    TLY: { price: 8948.48, changePct: 0.46, asOf: '25.08.2026' },
    DFI: { price: 5.6392, changePct: 0.62, asOf: '24.08.2026' },
    KGM: { price: 3.1474, changePct: -0.07, asOf: '24.08.2026' },
    TP2: { price: 2.1818, changePct: 0.13, asOf: '24.08.2026' },
  },
};

/* ------------------------------------------------------------------ */
/* CANLI — Sunucu tarafı veri çekiciler (hepsi best-effort)            */
/* ------------------------------------------------------------------ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 8000;
/** regularMarketTime bu süreden eskiyse feed "donmuş" sayılır (hafta sonu payı dahil). */
const STALE_MS = 42 * 3600 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
}

/**
 * Yahoo Finance chart API (range=1d → chartPreviousClose = DÜNÜN kapanışı,
 * yani değişim yüzdesi GERÇEK günlük değişimdir).
 * Tazelik kontrolü: regularMarketTime 42 saatten eskiyse veri reddedilir
 * (Yahoo'nun donmuş ^XU100 gibi bozuk feed'lerini yakalar).
 */
async function fetchYahooQuote(symbol: string): Promise<MarketQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!meta || !Number.isFinite(price) || price <= 0) return null;

    const rmt = Number(meta.regularMarketTime); // unix saniye
    if (Number.isFinite(rmt) && rmt > 0 && Date.now() - rmt * 1000 > STALE_MS) return null;

    const prev = Number(meta.chartPreviousClose);
    const changePct = Number.isFinite(prev) && prev > 0
      ? Number((((price - prev) / prev) * 100).toFixed(2))
      : null;
    return { price, changePct, asOf: new Date().toLocaleDateString('tr-TR') };
  } catch {
    return null;
  }
}

/**
 * borsaningundemi.com piyasa ekranı — BIST endeksleri ve gram altın (XGLD).
 * Ticker satırı yapısı:  XU100  14.434  -67,86  -0,47%
 * Akıllı aralık (sanity) kontrolü: mantıksız değerler reddedilir, seed'e düşülür.
 */
async function fetchBorsaningundemiTickers(): Promise<{ xu100: MarketQuote | null; gramGold: MarketQuote | null }> {
  try {
    const res = await fetchWithTimeout('https://www.borsaningundemi.com/piyasa-ekrani');
    if (!res.ok) return { xu100: null, gramGold: null };
    const html = await res.text();

    // KOD'un HTML'deki TÜM geçiş noktalarını dener; ilk geçerli fiyat okuyanı kazanır.
    // (Sayfada aynı kod hem görünen ticker widget'ında hem de sonda JSON veri
    // bloğunda geçer — görünen widget'ta sayıdan hemen sonra % işareti vardır,
    // JSON bloğunda yoktur → ayırt edici özellik.)
    const parseWindow = (window_: string): { price: number; pct: number } | null => {
      const nums = window_.match(/-?[\d.]{1,9}(?:,\d{1,4})?/g) ?? [];
      if (!nums[0]) return null;
      const price = parseFloat(nums[0].replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(price)) return null;
      // % değişim: sayıdan hemen sonra (isteğe bağlı kapanış etiketi + boşluk) %
      const pctM = window_.match(/(-?[\d.,]+)(?:<\/[a-zA-Z][^>]*>)?\s*%/);
      if (!pctM || !pctM[1]) return null;
      const pct = parseFloat(pctM[1].replace(',', '.'));
      if (!Number.isFinite(pct) || Math.abs(pct) > 30) return null;
      return { price, pct };
    };

    const pick = (code: string, sanity: (n: number) => boolean): MarketQuote | null => {
      const anchorRe = new RegExp(`>\\s*${code}\\s*</`, 'g');
      let m: RegExpExecArray | null;
      while ((m = anchorRe.exec(html)) !== null) {
        // PENCERE ANAHRIN SONUNDA BAŞLAR — yoksa kod içindeki rakamlar
        // (ör. XU100 → "100") ilk fiyat sanılır
        const end = m.index + m[0].length;
        const q = parseWindow(html.slice(end, end + 600));
        if (q && sanity(q.price)) {
          return { price: q.price, changePct: q.pct, asOf: new Date().toLocaleDateString('tr-TR') };
        }
      }
      return null;
    };

    return {
      // BIST 100 makul aralık: 3.000 – 300.000 puan
      xu100: pick('XU100', (n) => n > 3000 && n < 300000),
      // BIST gram altın makul aralık: 100 – 100.000 TL
      gramGold: pick('XGLD', (n) => n > 100 && n < 100000),
    };
  } catch {
    return { xu100: null, gramGold: null };
  }
}

/** fonaly.com fon sayfası: "güncel fon fiyatı X ₺, günlük getiri +Y%" meta betiği. */
async function fetchFonalyQuote(code: string): Promise<MarketQuote | null> {
  try {
    const res = await fetchWithTimeout(`https://www.fonaly.com/funds/${code}`);
    if (!res.ok) return null;
    const html = await res.text();

    let price: number | null = null;
    let changePct: number | null = null;

    // Öncelik: meta description ("güncel fon fiyatı 7.730,551937 ₺, günlük getiri +1.56%")
    const priceMatch = html.match(/güncel\s+fon\s+fiyatı\s*([\d.]+(?:,\d+)?)/i);
    const changeMatch = html.match(/günlük\s+getiri\s*([+-]?[\d.,]+)\s*%/i);
    if (priceMatch) price = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'));
    if (changeMatch) changePct = parseFloat(changeMatch[1].replace(',', '.'));

    // Yedek: sayfa gövdesindeki "Birim Pay Fiyatı" bloğu
    if (price === null) {
      const bodyMatch = html.match(/Birim\s+Pay\s+Fiyatı[\s\S]{0,300}?([\d.]{2,}(?:[.,]\d+)?)/i);
      if (bodyMatch) price = parseFloat(bodyMatch[1].replace(/\./g, '').replace(',', '.'));
    }

    // changePct yedek kalıpları (sırayla dene).
    // Not: \s NBSP'yi de kapsar; SIGN Unicode eksi (U+2212)'i de tanır.
    const SIGN = '[+\u2212-]';
    //  a) "günlük getiri [+0,46%]" — meta varyantları (sonek, iki nokta, =)
    if (changePct === null) {
      const m1 = html.match(new RegExp(`günlük\\s+getiri[sıı]*\\s*[:=]?\\s*(${SIGN}?[\\d.,]+)\\s*%`, 'i'));
      if (m1 && m1[1]) {
        const n = parseFloat(m1[1].replace(',', '.'));
        if (Number.isFinite(n) && Math.abs(n) < 30) changePct = n;
      }
    }
    //  b) "Birim Pay Fiyatı ... [+0,46%]" — gövde bloğu (ok aranmaz: SVG olabilir)
    //  c) "±% ▲/▼" — eski layout
    if (changePct === null) {
      const m2 =
        html.match(new RegExp(`Birim\\s+Pay\\s+Fiyatı[\\s\\S]{0,200}?(${SIGN})\\s*([\\d.,]+)\\s*%`, 'i')) ??
        html.match(new RegExp(`(${SIGN})\\s*([\\d.,]+)\\s*%\\s*[▲▼]`));
      if (m2 && m2[1] && m2[2]) {
        const n = parseFloat(m2[2].replace(',', '.'));
        if (Number.isFinite(n) && Math.abs(n) < 30) {
          changePct = (m2[1] === '+' ? 1 : -1) * n;
        }
      }
    }
    //  d) Son çare: fiyat rakamlarının hemen ardındaki ilk ±% (metinden bağımsız)
    if (changePct === null && price !== null) {
      const prefix = String(price).slice(0, 5).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m3 = html.match(new RegExp(`${prefix}[\\d.,]*[\\s\\S]{0,80}?(${SIGN})\\s*([\\d.,]+)\\s*%`));
      if (m3 && m3[1] && m3[2]) {
        const n = parseFloat(m3[2].replace(',', '.'));
        if (Number.isFinite(n) && Math.abs(n) < 30) {
          changePct = (m3[1] === '+' ? 1 : -1) * n;
        }
      }
    }

    if (!Number.isFinite(price as number) || (price as number) <= 0) return null;
    return { price: price as number, changePct, asOf: new Date().toLocaleDateString('tr-TR') };
  } catch {
    return null;
  }
}

interface LiveQuotes {
  indices: Partial<Record<'xu100' | 'usdtry' | 'ounceGold' | 'gramGold' | 'ounceSilver', MarketQuote>>;
  positions: Record<string, MarketQuote>;
  okCount: number;
}

/** Tüm canlı kaynakları paralel dener; hangisi tutarsa onu toplar. */
async function fetchLiveQuotes(): Promise<LiveQuotes> {
  const [
    bng,
    usdtry, ounceGold, ounceSilver,
    burce, masfn, sarae, ekim,
    tly, dfi, kgm, tp2,
  ] = await Promise.all([
    fetchBorsaningundemiTickers(),
    fetchYahooQuote('USDTRY=X'),
    fetchYahooQuote('GC=F'),
    fetchYahooQuote('SI=F'),
    fetchYahooQuote('BURCE.IS'),
    fetchYahooQuote('MASFN.IS'),
    fetchYahooQuote('SARAE.IS'),
    fetchYahooQuote('EKIM.IS'),
    fetchFonalyQuote('TLY'),
    fetchFonalyQuote('DFI'),
    fetchFonalyQuote('KGM'),
    fetchFonalyQuote('TP2'),
  ]);

  const indices: LiveQuotes['indices'] = {};
  if (bng.xu100) indices.xu100 = bng.xu100;
  if (usdtry) indices.usdtry = usdtry;
  if (ounceGold) indices.ounceGold = ounceGold;
  if (ounceSilver) indices.ounceSilver = ounceSilver;
  // Gram altın: BIST XGLD öncelikli (perakende resmi fiyat); yoksa ons+USD'den türetilir.
  if (bng.gramGold) indices.gramGold = bng.gramGold;
  else if (indices.ounceGold && usdtry) {
    indices.gramGold = {
      price: Number(calculateGramGold(indices.ounceGold.price, usdtry.price).toFixed(2)),
      changePct: null,
      asOf: usdtry.asOf,
    };
  }

  const positions: Record<string, MarketQuote> = {};
  const map: [string, MarketQuote | null][] = [
    ['BURCE', burce], ['MASFN', masfn], ['SARAE', sarae], ['EKIM', ekim],
    ['TLY', tly], ['DFI', dfi], ['KGM', kgm], ['TP2', tp2],
  ];
  for (const [code, q] of map) if (q) positions[code] = q;

  const okCount = Object.keys(indices).length + Object.keys(positions).length;
  return { indices, positions, okCount };
}

/* ------------------------------------------------------------------ */
/* Orkestrasyon: live dene → başarısızsa seed'e düş                    */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60_000; // 60 sn — hem BIST hem TEFAS için uygun ritim
let cache: { data: MarketData; at: number } | null = null;
let inFlight: Promise<MarketData> | null = null;

function assembleIndices(base: MarketData, live: LiveQuotes): MarketData['indices'] {
  const xu100 = live.indices.xu100 ?? base.indices.xu100;
  const usdtry = live.indices.usdtry ?? base.indices.usdtry;
  const ounceGold = live.indices.ounceGold ?? base.indices.ounceGold;
  const ounceSilver = live.indices.ounceSilver ?? base.indices.ounceSilver;
  const gramGold = live.indices.gramGold ?? base.indices.gramGold;
  const ratio = calculateGoldSilverRatio(ounceGold.price, ounceSilver.price);

  return {
    xu100, usdtry, ounceGold, gramGold, ounceSilver,
    goldSilverRatio: { value: ratio.ratio, status: ratio.status, interpretation: ratio.interpretation },
    interestRate: base.indices.interestRate,
  };
}

export async function getMarketData(): Promise<MarketData> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const base: MarketData = cache?.data ?? SEED_MARKET;
    const live = await fetchLiveQuotes();

    if (live.okCount > 0) {
      const positions: Record<string, MarketQuote> = { ...base.positions };
      for (const [code, q] of Object.entries(live.positions)) positions[code] = q;

      const data: MarketData = {
        source: 'live',
        timestamp: new Date().toISOString(),
        dataDate: new Date().toLocaleDateString('tr-TR'),
        indices: assembleIndices(base, live),
        positions,
      };
      cache = { data, at: Date.now() };
      return data;
    }

    // Canlı kaynağa ulaşılamadı: son bilinen veriyi (seed) tarih bilgisiyle döndür.
    const data: MarketData = { ...base, source: 'seed', timestamp: new Date().toISOString() };
    cache = { data, at: Date.now() };
    return data;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
