/**
 * tefas.ts — TEFAS gerçek fon getirisini çek (Modül 1, adım 1)
 * 
 * Vercel serverless'te TEFAS API'si bazen yanıt vermez → retry + fallback şart.
 * 
 * Kaynaklar:
 * - fintables.com/fonlar/{CODE} (günlük getiri tablosu)
 * - tefas.gov.tr API (resmi, ama CORS/WAF)
 * - Fallback: Supabase'deki son kayıt
 */

import type { TefasDailyReturn } from './types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TIMEOUT_MS = 15_000;

interface FetchOptions {
  retries: number;
  baseDelayMs: number;
}

const DEFAULT_OPTS: FetchOptions = { retries: 3, baseDelayMs: 800 };

async function fetchWithRetry(url: string, opts: FetchOptions = DEFAULT_OPTS): Promise<string> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'text/html,application/json' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt === opts.retries) break;
      const delay = opts.baseDelayMs * Math.pow(2, attempt) + Math.random() * 300;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error('TEFAS fetch failed');
}

/**
 * Dünkü TEFAS getirisini çek
 * 
 * @param fundCode - örn. TLY, THF
 * @param yesterday - YYYY-MM-DD
 * @returns TefasDailyReturn
 * 
 * Hata yönetimi:
 * - 3 retry, exponential backoff
 * - Başarısız olursa fallback: null döner, caller Supabase son kayda düşer
 */
export async function fetchTefasDailyReturn(
  fundCode: string,
  yesterday: string
): Promise<TefasDailyReturn | null> {
  const code = fundCode.toUpperCase();

  // 1. Fintables üzerinden dene (daha stabil)
  //    Sayfada "Günlük Getiri" tablosu var
  try {
    const html = await fetchWithRetry(`https://fintables.com/fonlar/${code}`);
    // Basit regex: günlük getiri %X.XX
    // Gerçek parse daha karmaşık, burada örnek
    const m = html.match(/Günlük\s*Getiri[^%]*%([+-]?\d+[.,]\d+)/i);
    if (m) {
      const raw = m[1].replace(',', '.');
      const pct = parseFloat(raw);
      if (Number.isFinite(pct)) {
        return {
          fundCode: code,
          date: yesterday,
          returnPct: pct,
          source: 'fintables',
        };
      }
    }
  } catch (e) {
    console.warn(`[tefas] fintables fetch hatası ${code}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. TEFAS resmi API denemesi (opsiyonel, WAF engeli olabilir)
  //    https://www.tefas.gov.tr/api/DB/BindHistoryInfo? ...
  //    Burada placeholder, gerçek entegrasyon için TEFAS API dokümanı gerekir
  try {
    // Örnek endpoint (gerçekte POST + form data gerekebilir)
    const tefasUrl = `https://www.tefas.gov.tr/api/DB/BindHistoryInfo?fontip=YAT&fonkod=${code}&bastarih=${yesterday}&bittarih=${yesterday}`;
    const text = await fetchWithRetry(tefasUrl);
    const json = JSON.parse(text);
    // json.data[0].getiri gibi bir alan beklenir
    if (json?.data?.[0]?.getiri != null) {
      return {
        fundCode: code,
        date: yesterday,
        returnPct: Number(json.data[0].getiri),
        navPrice: json.data[0].fiyat ? Number(json.data[0].fiyat) : undefined,
        source: 'tefas',
      };
    }
  } catch (e) {
    console.warn(`[tefas] tefas.gov.tr fetch hatası ${code}: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3. Fallback: null → caller Supabase'den son snapshot'ı kullanır
  console.warn(`[tefas] ${code} için gerçek getiri alınamadı, fallback null`);
  return null;
}

/**
 * Dünün tarihini ver (TR saati, borsa takvimine göre)
 * Hafta sonu ise son iş gününe çek
 */
export function getYesterdayBistDate(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  // Hafta sonu atla: Cumartesi → Cuma, Pazar → Cuma
  const day = d.getDay(); // 0 Pazar, 6 Cumartesi
  if (day === 0) d.setDate(d.getDate() - 2);
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
