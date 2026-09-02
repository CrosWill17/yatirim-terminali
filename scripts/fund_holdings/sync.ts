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

  // KAP PDF tazelik eşikleri: fon yöneticisi günlük trade yapabildiği için
  // KAP PDF taze iken koru, bayatlayınca auto kaynakların overwrite etmesine izin ver
  // TLY haftalık rapor → 7 gün, THF aylık → 30 gün, diğerleri 45 gün
  const KAP_FRESH_DAYS: Record<string, number> = { TLY: 7, THF: 30 };
  const DEFAULT_FRESH = 45;

  for (const [fundCode, rows] of Array.from(loaded.entries())) {
    const tickers = rows.map((r) => r.ticker);

    const { data: existing } = await supabase.from('fund_holdings').select('ticker, source, as_of_date').eq('fund_code', fundCode);

    // En güncel kap-pdf tarihini bul ve yaşını hesapla
    const kapRows = (existing ?? []).filter((e) => e.source === 'kap-pdf' && e.as_of_date);
    let latestKapDate: Date | null = null;
    for (const e of kapRows) {
      const d = new Date(e.as_of_date);
      if (!Number.isNaN(d.getTime()) && (!latestKapDate || d > latestKapDate)) latestKapDate = d;
    }
    const now = new Date();
    const kapAgeDays = latestKapDate ? (now.getTime() - latestKapDate.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
    const freshThreshold = KAP_FRESH_DAYS[fundCode] ?? DEFAULT_FRESH;
    const isKapFresh = kapAgeDays <= freshThreshold;

    // Korunan ticker'lar: manual ve calibration ASLA ezilmez.
    // kap-pdf: sadece taze iken korunur (günlük trade için bayatlayınca auto overwrite izni)
    const protectedTickers = new Set<string>();
    for (const e of existing ?? []) {
      if (e.source === 'manual' || e.source === 'calibration') protectedTickers.add(e.ticker);
      else if (e.source === 'kap-pdf' && isKapFresh) protectedTickers.add(e.ticker);
    }
    const autoRows = rows.filter((r) => !protectedTickers.has(r.ticker));
    skippedManual += protectedTickers.size;

    if (kapRows.length > 0) {
      console.log(
        `INFO [${fundCode}]: KAP PDF son tarih ${latestKapDate?.toISOString().slice(0, 10) ?? 'yok'} (${kapAgeDays.toFixed(1)} gün önce), eşik ${freshThreshold} gün → ${isKapFresh ? 'TAZE (korunuyor)' : 'BAYAT (auto overwrite izni)'}`
      );
    } else {
      console.log(`INFO [${fundCode}]: KAP PDF yok, auto tam yetki`);
    }

    // 2) Upsert (fund_code + ticker anahtarı)
    if (autoRows.length > 0) {
      const { error } = await supabase
        .from('fund_holdings')
        .upsert(autoRows, { onConflict: 'fund_code,ticker' });
      if (error) throw new Error(`[${fundCode}] upsert hatası: ${error.message}`);
      inserted += autoRows.length;
    }

    // 3) Rapor ortadan kalkan satırları sil
    //    - manual ve calibration ASLA silinmez
    //    - kap-pdf: taze ise silinmez, bayat ise ve yeni raporda yoksa silinebilir (satılmış)
    const keepSet = new Set(tickers);
    const stale = (existing ?? []).filter((e) => {
      if (protectedTickers.has(e.ticker)) return false; // korunanlar silinmez
      return !keepSet.has(e.ticker);
    });
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

  console.log(`\nÖZET: ${inserted} satır yazıldı, ${deleted} eski satır silindi, ${skippedManual} manuel/KAP-PDF override korundu (KAP ana kaynak).`);
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
