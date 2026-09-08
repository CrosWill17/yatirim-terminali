/**
 * fund_holdings/day-end.ts — 18:20 GÜN SONU TAHMİNİ snapshot job'u.
 *
 * NE YAPAR: Her fon için o anki tahmini hesaplar, geçmişten öğrenilen
 * kalibrasyon katsayısıyla düzeltir ve fund_nav_daily'ye sabitler. Ertesi gün
 * TEFAS gerçek getiriyi açıkladığında aradaki fark katsayıyı besler.
 *
 * NEDEN AYRI JOB (uygulama sunucusu değil): Sürekli çalışan sunucu yok.
 * GitHub Actions cron'u 18:20 İstanbul'da bunu tetikler.
 *
 * KURALLAR:
 *  - Tek yazı hedefi: fund_nav_daily.
 *  - Aynı gün tekrar koşmak YAZMAZ (idempotent — lib/dayEnd.ts zaten_kayitli).
 *  - Kapsama %30 altındaysa YAZMAZ: bozuk tahmin kalibrasyonu yanlış eğitir.
 *  - Hafta sonu yazmaz.
 *  - Log'da secret YOK.
 *
 * Çalıştırma:
 *   Actions : fund-day-end.yml (cron 15:20 UTC = 18:20 İstanbul)
 *   Yerel   : DRY_RUN=1 npx tsx scripts/fund_holdings/day-end.ts
 *
 * DRY_RUN=1 gerçek veriyi OKUR ama HİÇBİR ŞEY YAZMAZ. Bu yüzden Supabase
 * bilgileri DRY_RUN'da da gereklidir — sync.ts'ten farklı, çünkü orada
 * fixture'dan üretilen veri yazılır, burada yazılacak değer verinin kendisi.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchRawMixedQuotes } from '../../lib/marketData';
import { buildDayEndPlan, type DayEndFundInput } from '../../lib/dayEndSnapshot';
import type { FundNavDailyRow } from '../../lib/types';

const DRY_RUN = process.env.DRY_RUN === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
/**
 * Satırların sahibi. service_role RLS'i ATLAR ve auth.uid() bu bağlamda NULL'dır;
 * fund_nav_daily.user_id ise NOT NULL. Job kime yazdığını bilmek zorunda.
 * Tüm okumalar da .eq('user_id', OWNER_ID) ile daraltılır.
 */
const OWNER_ID = process.env.SUPABASE_OWNER_USER_ID ?? '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli.');
  process.exit(1);
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(OWNER_ID)) {
  console.error(
    'HATA: SUPABASE_OWNER_USER_ID eksik veya UUID değil.\n' +
      '  Değer: Supabase → Authentication → Users → kendi hesabınızın UUID\'si.',
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const n2 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(2));

async function main() {
  console.log(`GÜN SONU TAHMİNİ — ${DRY_RUN ? 'DRY_RUN (yazma yok)' : 'CANLI'}`);

  // 1) Fon içerikleri
  const { data: rows, error: rowsErr } = await db
    .from('fund_holdings')
    .select('fund_code, ticker, company_name, weight_pct')
    .eq('user_id', OWNER_ID);
  if (rowsErr) {
    const m = rowsErr.message || '';
    if (/does not exist|schema cache/i.test(m)) {
      console.log('UYARI: fund_holdings yok — migration henüz uygulanmamış, yazılacak iş yok.');
      return;
    }
    console.error('HATA fund_holdings okunamadı:', rowsErr.message);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log('fund_holdings boş — yapılacak iş yok.');
    return;
  }

  const funds = new Map<string, DayEndFundInput>();
  const tickers = new Set<string>();
  for (const r of rows as any[]) {
    const code = String(r.fund_code).toUpperCase();
    const entry = funds.get(code) ?? { fundCode: code, holdings: [] };
    entry.holdings.push({
      ticker: String(r.ticker).toUpperCase(),
      name: r.company_name ?? null,
      weightPct: Number(r.weight_pct),
      prevWeightPct: null,
    });
    funds.set(code, entry);
    tickers.add(String(r.ticker).toUpperCase());
  }
  console.log(`fon: ${funds.size}, kod: ${tickers.size}`);

  // 2) Kalibrasyon geçmişi + bugünün kaydı var mı
  const { data: navRows, error: navErr } = await db
    .from('fund_nav_daily')
    .select('*')
    .eq('user_id', OWNER_ID)
    .gte('nav_date', new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10));
  if (navErr) {
    console.error('HATA fund_nav_daily okunamadı:', navErr.message);
    console.error('  → supabase/supabase_fund_nav_daily_migration.sql koşuldu mu?');
    process.exit(1);
  }
  const history: FundNavDailyRow[] = (navRows ?? []).map((r: any) => ({
    id: r.id,
    fund_code: r.fund_code,
    nav_date: String(r.nav_date ?? '').slice(0, 10),
    estimated_pct: r.estimated_pct != null ? Number(r.estimated_pct) : null,
    covered_pct: r.covered_pct != null ? Number(r.covered_pct) : null,
    actual_pct: r.actual_pct != null ? Number(r.actual_pct) : null,
    actual_nav: r.actual_nav != null ? Number(r.actual_nav) : null,
    actual_at: r.actual_at ?? null,
    calib_factor: r.calib_factor != null ? Number(r.calib_factor) : 1,
    status: r.status ?? 'estimated',
    source: r.source ?? 'cron',
    notes: r.notes ?? null,
  }));
  console.log(`geçmiş satır: ${history.length}`);

  // 3) Kapanış fiyatları — seans kapalı olduğu için cache'li yol kullanılamaz.
  let quotes: Awaited<ReturnType<typeof fetchRawMixedQuotes>> = {};
  try {
    quotes = await fetchRawMixedQuotes(Array.from(tickers));
  } catch (e) {
    console.error('UYARI: fiyat çekimi başarısız, boş set ile devam:', e instanceof Error ? e.message : e);
  }
  const prices: Record<string, { price: number; changePct: number } | null> = {};
  let fiyatli = 0;
  for (const [code, q] of Object.entries(quotes)) {
    prices[code] =
      q && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.changePct)
        ? { price: Number(q.price), changePct: Number(q.changePct) }
        : null;
    if (prices[code]) fiyatli++;
  }
  console.log(`fiyat alındı: ${fiyatli}/${tickers.size}`);

  // 4) Karar
  const plan = buildDayEndPlan(Array.from(funds.values()), prices, history);
  console.log(`\ntarih: ${plan.navDate}`);
  console.log(`yazılacak: ${plan.toWrite.length}, atlanan: ${plan.skipped.length}`);

  for (const it of plan.toWrite) {
    const d = it.draft!;
    console.log(
      `  YAZ  ${it.fundCode.padEnd(6)} ham %${n2(it.raw.predictedPct)} → kalibre %${d.estimated_pct}` +
        ` (kapsam %${n2(it.raw.coveredPct)}, katsayı ${it.raw.factor.toFixed(3)}, örnek ${it.raw.historySamples})`,
    );
  }
  for (const it of plan.skipped) {
    console.log(
      `  ATLA ${it.fundCode.padEnd(6)} ${it.decision.reason} — ${it.decision.detail}`,
    );
  }

  if (DRY_RUN) {
    console.log('\nDRY_RUN: hiçbir satır yazılmadı.');
    return;
  }

  // 5) Yaz
  let ok = 0;
  for (const it of plan.toWrite) {
    const d = it.draft!;
    const { error } = await db.from('fund_nav_daily').upsert(
      {
        user_id: OWNER_ID,
        fund_code: d.fund_code,
        nav_date: d.nav_date,
        estimated_pct: d.estimated_pct,
        covered_pct: d.covered_pct,
        calib_factor: d.calib_factor,
        status: 'estimated',
        source: 'cron',
        notes: '18:20 gun sonu tahmini (Actions)',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,fund_code,nav_date' },
    );
    if (error) console.error(`  HATA ${d.fund_code}: ${error.message}`);
    else ok++;
  }
  console.log(`\nSONUÇ: ${ok}/${plan.toWrite.length} satır yazıldı.`);
}

main().catch((e) => {
  console.error('BEKLENMEDİK HATA:', e?.message ?? e);
  process.exit(1);
});
