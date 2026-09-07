/**
 * BASİT HIZ SINIRLAYICI (sliding window, bellek içi)
 *
 * Neden var: /api/market/quotes ve /api/social-parse sunucudan Yahoo Finance
 * ve fonaly.com'a çıkar. Sınır olmazsa bu uçlar herkese açık bir scrape
 * proxy'sine dönüşür ve kaynak site SUNUCUMUZUN IP'sini banlayabilir — o zaman
 * canlı veri bizim için de ölür.
 *
 * DÜRÜST SINIR: Vercel serverless'ta her instance'ın belleği AYRIDIR. Yani bu
 * sayaç instance başınadır; N instance varsa etkin sınır N × limit olur.
 * Kesin sınır gerekiyorsa Upstash/Redis gibi paylaşımlı bir sayaç gerekir.
 * Bu sürüm "kaza eseri sonsuz döngü" ve "tek IP'den tarama" durumlarını keser,
 * kararlı bir saldırıyı kesmez.
 *
 * Fonksiyonlar saf: `now` enjekte edilebilir → test edilebilir.
 */

export interface RateLimitState {
  /** Anahtar → istek zaman damgaları (ms). */
  hits: Map<string, number[]>;
}

export interface RateLimitResult {
  ok: boolean;
  /** Bu pencerede kalan hak. */
  remaining: number;
  /** Limitin sıfırlanacağı an (ms). Ret durumunda Retry-After için kullanılır. */
  resetAt: number;
  limit: number;
}

export interface RateLimitOptions {
  /** Pencere uzunluğu (ms). */
  windowMs: number;
  /** Pencere başına izin verilen istek sayısı. */
  limit: number;
  /** Test için enjekte edilebilir saat. */
  now?: () => number;
}

/** Bellek şişmesin: bu sayıda anahtarı aşınca en eski yarısı atılır. */
const MAX_TRACKED_KEYS = 5_000;

export function createRateLimiter() {
  const state: RateLimitState = { hits: new Map() };

  function check(key: string, opts: RateLimitOptions): RateLimitResult {
    const now = (opts.now ?? Date.now)();
    const cutoff = now - opts.windowMs;

    const recent = (state.hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= opts.limit) {
      // Pencereyi geri kaydırmadan ret ver — istek SAYILMAZ.
      state.hits.set(key, recent);
      return { ok: false, remaining: 0, resetAt: recent[0]! + opts.windowMs, limit: opts.limit };
    }

    recent.push(now);
    state.hits.set(key, recent);

    if (state.hits.size > MAX_TRACKED_KEYS) {
      const keys = Array.from(state.hits.keys());
      for (const k of keys.slice(0, Math.floor(keys.length / 2))) state.hits.delete(k);
    }

    return {
      ok: true,
      remaining: opts.limit - recent.length,
      resetAt: recent[0]! + opts.windowMs,
      limit: opts.limit,
    };
  }

  /** Test ve sıcak yeniden yükleme için. */
  function reset(): void {
    state.hits.clear();
  }

  return { check, reset };
}

/**
 * İstemci kimliği. Vercel gerçek IP'yi `x-forwarded-for`'de verir (ilk giriş).
 * Oturumlu uçlarda anahtara user id de katılır → aynı IP'den iki kullanıcı
 * birbirini kilitlemez.
 */
export function clientKey(req: Request, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = req.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0]?.trim();
  return `ip:${ip || 'bilinmeyen'}`;
}

/** Ret yanıtı için saniye cinsinden Retry-After (en az 1). */
export function retryAfterSeconds(resetAt: number, now: number = Date.now()): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}
