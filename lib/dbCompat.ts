/**
 * ŞEMA UYUMLULUK KATMANI (GitHub Actions job'ları için)
 *
 * SORUN (gerçek arıza):
 *   twitter-sync her 30 dakikada şu hatayla düşüyordu:
 *     "column social_predictions.user_id does not exist"
 *   Çünkü kod `supabase/supabase_rls_user_isolation.sql` UYGULANMIŞ varsayıyor,
 *   canlı veritabanında ise o migrasyon henüz çalıştırılmamış. Job, olmayan bir
 *   sütuna göre filtreleyip (`.eq('user_id', ...)`) PostgREST 42703 alıyor,
 *   3 deneme de aynı sebeple düşüyor.
 *
 * ÇÖZÜM:
 *   Job'lar şemayı VARSAYMAZ, bir kez YOKLAR. Sütun varsa (yeni şema) her şey
 *   eskisi gibi kullanıcı bazlı yalıtımla çalışır. Sütun yoksa (eski şema) job
 *   user_id'siz "legacy" modda çalışır ve NET bir uyarı basar — cron kırmızıya
 *   boyanmaz, veri akmaya devam eder, migrasyon uygulanınca kendiliğinden
 *   yalıtımlı moda geçer.
 *
 * GÜVENLİK NOTU: legacy mod yalıtımı ZAYIFLATMAZ. Sütun yoksa zaten kimseye
 * ait olmayan tek bir veri kümesi vardır; kod olmayan bir yalıtımı taklit
 * etmez, sadece yazmaya devam eder.
 *
 * Buradaki fonksiyonların tamamı saftır veya en küçük istemci arayüzüne
 * bağımlıdır — bu yüzden gerçek Supabase olmadan test edilebilirler.
 */

/** PostgREST'in "böyle bir sütun yok" hatası (PostgreSQL kodu 42703). */
export function isMissingColumnError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '42703') return true;
  const msg = e.message ?? String(err);
  return /column .* does not exist|could not find the '.*' column|does not exist in the schema cache/i.test(msg);
}

/** PostgREST'in tekil kısıt ihlali (idempotent tekrar çalıştırma). */
export function isDuplicateError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: string; message?: string };
  if (e.code === '23505') return true;
  return /duplicate key|unique constraint|already exists/i.test(e.message ?? String(err));
}

/**
 * Sütun varsa satıra user_id ekler, yoksa satırı olduğu gibi bırakır.
 * (Olmayan sütunu göndermek PostgREST'te PGRST204 ile insert'i kırardı.)
 */
export function withOwner<T extends Record<string, unknown>>(
  row: T,
  ownerId: string,
  hasUserId: boolean,
): T | (T & { user_id: string }) {
  return hasUserId ? { ...row, user_id: ownerId } : row;
}

/** Dizi hâli — insert/upsert payload'ları için. */
export function withOwnerAll<T extends Record<string, unknown>>(
  rows: T[],
  ownerId: string,
  hasUserId: boolean,
): Array<T | (T & { user_id: string })> {
  return rows.map((r) => withOwner(r, ownerId, hasUserId));
}

/**
 * onConflict hedefi: yeni şemada tekil kısıt user_id ile bileşiktir
 * (ör. "user_id,fund_code,ticker"), eski şemada değildir ("fund_code,ticker").
 */
export function conflictTarget(cols: string[], hasUserId: boolean): string {
  return (hasUserId ? ['user_id', ...cols] : cols).join(',');
}

/**
 * Sorguyu sahibe daraltır; sütun yoksa sorgu olduğu gibi döner.
 *
 * Dönüş tipi bilerek `any`: PostgREST builder'ları her `.eq()` çağrısında
 * kendini yeniden türeten özyinelemeli jenerikler üretir; bunları jenerik bir
 * sarmalayıcıdan geçirmek TS2589 ("type instantiation is excessively deep")
 * veriyor. Çağrı yerlerinde zincir normal şekilde tiplenmeye devam eder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeToOwner(query: any, ownerId: string, hasUserId: boolean): any {
  return hasUserId ? query.eq('user_id', ownerId) : query;
}

/** hasUserIdColumn için gereken en küçük istemci arayüzü (test edilebilirlik). */
export interface ColumnProbeClient {
  from(table: string): {
    select(cols: string): {
      limit(n: number): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
}

/**
 * Tabloda user_id sütunu var mı? Tek hafif sorgu (LIMIT 1) ile yoklar.
 *
 * - hata yok            → sütun VAR
 * - 42703 / bulunamadı  → sütun YOK (legacy şema)
 * - başka hata (ağ/izin) → GÜVENLİ TARAF: sütun VAR kabul edilir; asıl hata
 *   sonraki gerçek sorguda anlamlı mesajıyla yüzeye çıksın, yoksa geçici bir
 *   ağ hatası yüzünden yanlışlıkla legacy moda düşer ve yalıtımı bozardık.
 */
export async function hasUserIdColumn(sb: ColumnProbeClient, table: string): Promise<boolean> {
  const { error } = await sb.from(table).select('user_id').limit(1);
  if (!error) return true;
  return !isMissingColumnError(error);
}

/** Legacy moda düşüldüğünde tek tip, açıklayıcı uyarı. */
export function legacySchemaWarning(table: string): string {
  return (
    `UYARI: ${table}.user_id sütunu YOK — supabase/supabase_rls_user_isolation.sql ` +
    'henüz uygulanmamış. Job kullanıcı yalıtımı OLMADAN (legacy şema) devam ediyor. ' +
    'Migrasyonu Supabase → SQL Editor üzerinden çalıştırın; sonrasında bu job ' +
    'kendiliğinden yalıtımlı moda geçer.'
  );
}
