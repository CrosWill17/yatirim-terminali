/**
 * fund_holdings/sync.ts — GitHub Actions job'u: fon hisse içeriklerini çeker,
 * parse eder ve YALNIZCA fund_holdings tablosuna yazar.
 *
 * KURALLAR:
 *  - Tek yazı hedefi: fund_holdings (history'yi trigger doldurur; calibration_log dokunulmaz).
 *  - source='manual' satırlar ASLA ezilmez (kullanıcı override'ı üstündür).
 *  - KAYBOLAN hisseler (raporda olmayan, source='auto') silinir.
 *  - Log'da hiçbir secret/cookie YOK — yalnızca özet.
 *
 * Çalıştırma:
 *   - Actions: otomatik (fund-holdings-sync.yml) veya workflow_dispatch
 *   - Yerel test: DRY_RUN=1 npx tsx scripts/fund_holdings/sync.ts
 *     (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY DRY_RUN'da GEREKLİ DEĞİL)
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  FUND_SOURCES,
  parseFintablesHoldings,
  parseRotaborsaHoldings,
  toHoldingRows,
  validateParsed,
  type FundSourceConfig,
} from '../../lib/fundHoldings';

const DRY_RUN = process.env.DRY_RUN === '1';
const FIXTURE_DIR = process.env.FIXTURE_DIR ?? ''; // ör. ./test/fixtures → {CODE}.html oku
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (ya da DRY_RUN=1 ile çalıştır).');
  process.exit(1);
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchHtml(url: string, fundCode: string): Promise<string> {
  if (FIXTURE_DIR) {
    const p = `${FIXTURE_DIR}/${fundCode}.html`;
    return readFileSync(p, 'utf-8');
  }
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

async function loadFund(cfg: FundSourceConfig): Promise<{ rows: ReturnType<typeof toHoldingRows> } | null> {
  if (!cfg.url) return null; // KGM/TP2: hisse içeriği bu job'da takip edilmez
  const html = await fetchHtml(cfg.url, cfg.code);
  const parsed = cfg.kind === 'rotaborsa'
    ? parseRotaborsaHoldings(html, cfg.code)
    : parseFintablesHoldings(html, cfg.code);

  const v = validateParsed(parsed);
  if (!v.ok) {
    console.error(`HATA [${cfg.code}]: parse doğrulaması geçmedi → ${v.reason}. Bu fon bu turda GÜNCELLENMEDİ (eski değerler korunur).`);
    return null;
  }
  return { rows: toHoldingRows(parsed) };
}

async function main(): Promise<void> {
  const funds = FUND_SOURCES.filter((f) => f.url !== null);
  const loaded = new Map<string, ReturnType<typeof toHoldingRows>>();

  for (const cfg of funds) {
    try {
      const r = await loadFund(cfg);
      if (r) {
        loaded.set(cfg.code, r.rows);
        const total = r.rows.reduce((s, x) => s + x.weight_pct, 0);
        console.log(`OK [${cfg.code}]: ${r.rows.length} hisse, ağırlık toplamı %${total.toFixed(2)}, dönem=${r.rows[0]?.as_of_date}`);
      }
    } catch (e) {
      console.error(`HATA [${cfg.code}]: ${e instanceof Error ? e.message : String(e)}. Bu fon bu turda GÜNCELLENMEDİ.`);
    }
  }

  if (loaded.size === 0) {
    console.error('ÖZET: hiçbir fon güncellenemedi (kaynaklara ulaşılamadı veya parse hatası).');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n=== DRY_RUN (yazı YAPILMADI) — INSERT/UPDATE edecek satırlar: ===');
    loaded.forEach((rows, code) => {
      console.log(`\n[${code}]`);
      rows.forEach((r) => {
        console.log(`  ${r.ticker.padEnd(6)} %${r.weight_pct.toFixed(2).padStart(7)}  ${r.company_name ?? ''}`);
      });
    });
    console.log('\nÖZET: DRY_RUN tamam. Gerçek yazı için SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ortamında çalıştır.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let inserted = 0;
  let deleted = 0;
  let skippedManual = 0;

  for (const [fundCode, rows] of Array.from(loaded.entries())) {
    const tickers = rows.map((r) => r.ticker);

    // 1) Manuel override'ları koru: source='manual' olan satırları bu turda DEĞİŞTİRME.
    const { data: existing } = await supabase.from('fund_holdings').select('ticker, source').eq('fund_code', fundCode);
    const manualTickers = new Set((existing ?? []).filter((e) => e.source === 'manual').map((e) => e.ticker));
    const autoRows = rows.filter((r) => !manualTickers.has(r.ticker));
    skippedManual += manualTickers.size;

    // 2) Upsert (fund_code + ticker anahtarı)
    if (autoRows.length > 0) {
      const { error } = await supabase
        .from('fund_holdings')
        .upsert(autoRows, { onConflict: 'fund_code,ticker' });
      if (error) throw new Error(`[${fundCode}] upsert hatası: ${error.message}`);
      inserted += autoRows.length;
    }

    // 3) Rapor ortadan kalkan otomatik satırları sil (manuel dokunulmaz)
    const keepSet = new Set(tickers);
    const stale = (existing ?? []).filter((e) => e.source !== 'manual' && !keepSet.has(e.ticker));
    if (stale.length > 0) {
      const { error } = await supabase
        .from('fund_holdings')
        .delete()
        .eq('fund_code', fundCode)
        .in('ticker', stale.map((s) => s.ticker));
      if (error) throw new Error(`[${fundCode}] stale silme hatası: ${error.message}`);
      deleted += stale.length;
    }
  }

  console.log(`\nÖZET: ${inserted} satır yazıldı, ${deleted} eski satır silindi, ${skippedManual} manuel override korundu.`);
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
