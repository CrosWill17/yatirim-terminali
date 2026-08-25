/**
 * YATIRIM TERMİNALİ v3.0 — PİYASA VERİ MOTORU
 *
 * Çift katmanlı veri mimarisi:
 *   1) LIVE  → Sunucu tarafında Yahoo Finance (BIST/Döviz/Emtia/Hisse) ve
 *              fonaly.com (TEFAS fon birim pay fiyatları) canlı çekilir.
 *   2) SEED  → Canlı kaynaklara ulaşılamazsa (ör. ağ kısıtlı ortamlar),
 *              gerçek 25.08.2026 piyasa kapanış/açılış verisiyle doldurulmuş
 *              snapshot kullanılır. Yanıt her zaman `source` alanıyla hangi
 *              katmandan geldiğini bildirir — arayüz buna göre "CANLI" veya
 *              "SON VERİ" rozetini gösterir.
 */

import { calculateGramGold, calculateGoldSilverRatio } from './calculations';

export interface MarketQuote {
  price: number;
  /** Günlük değişim (%). Bilinmiyorsa null. */
  changePct: number | null;
  /** Verinin ait olduğu iş günü / saat (ör. "25.08.2026 16:38"). */
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
/* 2) SEED — Gerçek 25.08.2026 piyasa snapshot'ı                       */
/* Kaynaklar: borsaningundemi.com piyasa ekranı (25.08.2026 16:38),     */
/* halktv.com.tr (25.08.2026 11:15), fonaly.com/TEFAS (24-25.08.2026).  */
/* ------------------------------------------------------------------ */

const SEED_RATIO = calculateGoldSilverRatio(4615.8, 67.84);

export const SEED_MARKET: MarketData = {
  source: 'seed',
  timestamp: '2026-08-25T16:38:00+03:00',
  dataDate: '25.08.2026',
  indices: {
    xu100: { price: 14448, changePct: -0.37, asOf: '25.08.2026 16:38' },
    usdtry: { price: 48.0987, changePct: 0.06, asOf: '25.08.2026 16:38' },
    ounceGold: { price: 4615.8, changePct: -0.77, asOf: '25.08.2026 16:38' },
    gramGold: { price: 7152.59, changePct: -0.53, asOf: '25.08.2026 16:38' },
    ounceSilver: { price: 67.84, changePct: -1.56, asOf: '25.08.2026 11:15' },
    goldSilverRatio: {
      value: SEED_RATIO.ratio,
      status: SEED_RATIO.status,
      interpretation: SEED_RATIO.interpretation,
    },
    interestRate: { value: 37.0, inflation: 31.75 },
  },
  positions: {
    BURCE: { price: 36.34, changePct: 1.11, asOf: '25.08.2026 16:38' },
    MASFN: { price: 43.18, changePct: -1.37, asOf: '25.08.2026 16:38' },
    SARAE: { price: 88.1, changePct: -3.56, asOf: '24.08.2026' },
    EKIM: { price: 19.31, changePct: null, asOf: '24.08.2026' },
    TLY: { price: 8948.48, changePct: 0.46, asOf: '25.08.2026' },
    DFI: { price: 5.6392, changePct: 0.62, asOf: '24.08.2026' },
    KGM: { price: 3.1474, changePct: -0.07, asOf: '24.08.2026' },
    TP2: { price: 2.1818, changePct: 0.13, asOf: '24.08.2026' },
  },
};

/* ------------------------------------------------------------------ */
/* 1) LIVE — Sunucu tarafı veri çekiciler (best-effort, hepsi opsiyonel) */
/* ------------------------------------------------------------------ */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const FETCH_TIMEOUT_MS = 7000;

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8', ...(init.headers || {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
}

/** Yahoo Finance chart API: son fiyat + önceki kapanışa göre günlük değişim. */
async function fetchYahooQuote(symbol: string): Promise<MarketQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    if (!meta || !Number.isFinite(price) || price <= 0) return null;
    const prev = Number(meta.chartPreviousClose ?? meta.previousClose);
    const changePct = Number.isFinite(prev) && prev > 0
      ? Number((((price - prev) / prev) * 100).toFixed(2))
      : null;
    return { price, changePct, asOf: new Date().toLocaleDateString('tr-TR') };
  } catch {
    return null;
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
    const priceMatch = html.match(/güncel fon fiyatı\s*([\d.]+(?:,\d+)?)/i);
    const changeMatch = html.match(/günlük getiri\s*([+-]?[\d.,]+)/i);
    if (priceMatch) price = parseFloat(priceMatch[1].replace(/\./g, '').replace(',', '.'));
    if (changeMatch) changePct = parseFloat(changeMatch[1].replace(',', '.'));

    // Yedek: sayfa gövdesindeki "Birim Pay Fiyatı" bloğu
    if (price === null) {
      const bodyMatch = html.match(/Birim Pay Fiyatı[\s\S]{0,300}?([\d.]{2,}(?:[.,]\d+)?)/i);
      if (bodyMatch) price = parseFloat(bodyMatch[1].replace(/\./g, '').replace(',', '.'));
    }
    if (changePct === null) {
      const pctMatch = html.match(/([+-])\s*([\d.,]+)\s*%\s*[▲▼]/);
      if (pctMatch) changePct = (pctMatch[1] === '-' ? -1 : 1) * parseFloat(pctMatch[2].replace(',', '.'));
    }

    if (!Number.isFinite(price as number) || (price as number) <= 0) return null;
    return { price: price as number, changePct, asOf: new Date().toLocaleDateString('tr-TR') };
  } catch {
    return null;
  }
}

interface LiveQuotes {
  indices: Partial<Record<'xu100' | 'usdtry' | 'ounceGold' | 'ounceSilver', MarketQuote>>;
  positions: Record<string, MarketQuote>;
  okCount: number;
}

/** Tüm canlı kaynakları paralel dener; hangisi tutarsa onu toplar. */
async function fetchLiveQuotes(): Promise<LiveQuotes> {
  const [
    xu100, usdtry, ounceGold, ounceSilver,
    burce, masfn, sarae, ekim,
    tly, dfi, kgm, tp2,
  ] = await Promise.all([
    fetchYahooQuote('^XU100'),
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
  if (xu100) indices.xu100 = xu100;
  if (usdtry) indices.usdtry = usdtry;
  if (ounceGold) indices.ounceGold = ounceGold;
  if (ounceSilver) indices.ounceSilver = ounceSilver;

  const positions: Record<string, MarketQuote> = {};
  const map: [string, MarketQuote | null][] = [
    ['BURCE', burce], ['MASFN', masfn], ['SARAE', sarae], ['EKIM', ekim],
    ['TLY', tly], ['DFI', dfi], ['KGM', kgm], ['TP2', tp2],
  ];
  for (const [code, q] of map) if (q) positions[code] = q;

  const okCount =
    Object.keys(indices).length + Object.keys(positions).length;

  return { indices, positions, okCount };
}

/* ------------------------------------------------------------------ */
/* Orkestrasyon: live dene → başarısızsa seed / son bilinen veriye dön  */
/* ------------------------------------------------------------------ */

const CACHE_TTL_MS = 60_000; // 60 sn — hem BIST hem TEFAS için uygun ritim
let cache: { data: MarketData; at: number } | null = null;
let inFlight: Promise<MarketData> | null = null;

function assembleIndices(base: MarketData, live: LiveQuotes): MarketData['indices'] {
  const xu100 = live.indices.xu100 ?? base.indices.xu100;
  const usdtry = live.indices.usdtry ?? base.indices.usdtry;
  const ounceGold = live.indices.ounceGold ?? base.indices.ounceGold;
  const ounceSilver = live.indices.ounceSilver ?? base.indices.ounceSilver;

  // Gram altın: canlı ons+USD varsa kendi formülümüzle türet, yoksa seed BIST gram.
  const gramGold =
    live.indices.ounceGold && live.indices.usdtry
      ? {
          price: Number(calculateGramGold(live.indices.ounceGold.price, live.indices.usdtry.price).toFixed(2)),
          changePct: null,
          asOf: live.indices.ounceGold.asOf,
        }
      : base.indices.gramGold;

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

    // En az 1 canlı veri geldi → canlı tabanına birleştir; hiçbiri gelmedi → seed/son veri.
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
    const data: MarketData = {
      ...base,
      source: 'seed',
      timestamp: new Date().toISOString(),
    };
    cache = { data, at: Date.now() };
    return data;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}
