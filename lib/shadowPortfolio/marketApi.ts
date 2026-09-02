/**
 * marketApi.ts — BIST canlı veri çekme (Modül 2: On-Demand Live Engine)
 * 
 * Vercel serverless limitleri için:
 * - 10sn timeout, 3 retry, exponential backoff
 * - Cache: 60sn (Vercel Edge Cache)
 * - Fallback: son seed verisi
 */

import type { StockPerformance } from './types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TIMEOUT_MS = 10_000;

interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY: RetryOptions = { retries: 3, baseDelayMs: 500 };

async function fetchWithRetry(
  url: string,
  opts: RequestInit = {},
  retry: RetryOptions = DEFAULT_RETRY
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retry.retries; attempt++) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        ...opts,
        headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers ?? {}) },
        signal: controller.signal,
      });
      clearTimeout(id);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt === retry.retries) break;
      const delay = retry.baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError ?? new Error('fetch failed');
}

/**
 * BIST hisselerinin canlı değişimlerini çek
 * Gerçekte app/api/market/quotes kullanır, burada soyutlandı
 */
export async function fetchLivePerformances(
  tickers: string[],
  date: string = new Date().toISOString().slice(0, 10)
): Promise<StockPerformance[]> {
  if (tickers.length === 0) return [];

  // Örnek: kendi market API'mizi çağır (Vercel'de cache'li)
  // /api/market/quotes?symbols=THYAO,ASELS
  const url = `/api/market/quotes?symbols=${tickers.map(encodeURIComponent).join(',')}`;

  try {
    const res = await fetchWithRetry(url);
    const json = await res.json();
    // Beklenen format: { quotes: { THYAO: { changePct, price } } }
    const quotes = json.quotes ?? json ?? {};
    const out: StockPerformance[] = [];
    for (const ticker of tickers) {
      const q = quotes[ticker.toUpperCase()];
      if (q && Number.isFinite(q.changePct)) {
        out.push({
          ticker: ticker.toUpperCase(),
          changePct: Number(q.changePct),
          closePrice: q.price != null ? Number(q.price) : undefined,
          date,
        });
      }
    }
    return out;
  } catch (e) {
    console.warn(`[marketApi] canlı veri alınamadı, fallback: ${e instanceof Error ? e.message : String(e)}`);
    // Fallback: boş dön, Modül 2'de missingTickers olarak raporlanır
    return [];
  }
}

/**
 * Dünkü performansları çek (kalibrasyon için)
 * TEFAS gerçek getiri ile karşılaştırma için dünkü BIST kapanış değişimleri lazım
 */
export async function fetchYesterdayPerformances(
  tickers: string[],
  yesterday: string
): Promise<StockPerformance[]> {
  // Aynı endpoint ama date param ile (eğer API destekliyorsa)
  // Desteklemiyorsa marketSeedPublic fallback
  try {
    // Örnek: /api/market/quotes?symbols=...&date=YYYY-MM-DD
    const url = `/api/market/quotes?symbols=${tickers.join(',')}&date=${yesterday}`;
    const res = await fetchWithRetry(url);
    const json = await res.json();
    const quotes = json.quotes ?? {};
    return tickers
      .map((t) => {
        const q = quotes[t.toUpperCase()];
        if (!q) return null;
        return {
          ticker: t.toUpperCase(),
          changePct: Number(q.changePct),
          closePrice: q.price ? Number(q.price) : undefined,
          date: yesterday,
        } as StockPerformance;
      })
      .filter(Boolean) as StockPerformance[];
  } catch {
    return [];
  }
}
