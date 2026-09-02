/**
 * KAP PDF upsert — data/kap_pdfs/ klasöründeki PDF'leri parse edip
 * fund_holdings tablosuna source='kap-pdf' olarak yazar.
 *
 * Akış:
 *   1. kap_pdf_fetch.py ile PDF'ler indirilir (veya manuel upload)
 *   2. Bu script PDF'leri pdf-parse ile metne çevirir
 *   3. lib/kapPdfParser.ts ile holdings çıkarılır
 *   4. Supabase'e upsert (kap-pdf, ham veri, onay yok)
 *
 * Çalıştırma:
 *   DRY_RUN=1 npx tsx scripts/fund_holdings/kap_pdf_upsert.ts
 *   SUPABASE_URL + SERVICE_ROLE_KEY ile gerçek yazı
 *
 * KAP PDF ana kaynak: fon yöneticisi günlük trade yapabilir ama KAP PDF
 * en doğru resmi veri. Bu yüzden:
 *   - KAP PDF taze ise (TLY 7 gün, THF 30 gün) auto kaynaklar overwrite edemez
 *   - Bayatlayınca auto kaynaklar overwrite edebilir (günlük trade takibi)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { parseKapPdfHoldings, validateKapParsed } from '../../lib/kapPdfParser';
import { toHoldingRows } from '../../lib/fundHoldings';

const DRY_RUN = process.env.DRY_RUN === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const PDF_DIR = process.env.PDF_DIR ?? 'data/kap_pdfs';

if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error('HATA: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli (ya da DRY_RUN=1)');
  process.exit(1);
}

async function parsePdfFile(filePath: string): Promise<{ text: string; fundCode: string }> {
  // Dosya adından fon kodunu çıkar: TLY_2026_08_05_...pdf veya THF_...
  const base = filePath.split('/').pop() ?? filePath;
  const m = base.match(/^(TLY|THF|[A-Z0-9]{2,5})[_-]/i);
  const fundCode = m ? m[1].toUpperCase() : 'TLY';

  const buffer = readFileSync(filePath);
  // @ts-ignore
  const pdfParse = (await import('pdf-parse')).default as any;
  const data = await pdfParse(buffer);
  const text: string = data.text || '';
  if (!text || text.trim().length < 100) {
    throw new Error(`PDF metni okunamadı (taranmış olabilir): ${filePath}`);
  }
  return { text, fundCode };
}

async function main() {
  console.log(`=== KAP PDF Upsert — ${new Date().toISOString()} ===`);
  console.log(`PDF_DIR=${PDF_DIR}, DRY_RUN=${DRY_RUN}`);

  if (!existsSync(PDF_DIR)) {
    console.error(`HATA: ${PDF_DIR} klasörü yok. Önce kap_pdf_fetch.py çalıştır veya manuel PDF koy.`);
    process.exit(1);
  }

  const files = readdirSync(PDF_DIR)
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => join(PDF_DIR, f));

  if (files.length === 0) {
    console.log('PDF yok, yapılacak iş yok (KAP bu hafta rapor yayınlamamış olabilir)');
    return;
  }

  console.log(`${files.length} PDF bulundu`);

  const allRows: ReturnType<typeof toHoldingRows>[] = [];
  const meta: { fundCode: string; asOfDate: string | null; label: string | null; count: number; file: string }[] = [];

  for (const file of files) {
    try {
      const { text, fundCode } = await parsePdfFile(file);
      const parsed = parseKapPdfHoldings(text, fundCode);
      const v = validateKapParsed(parsed);
      if (!v.ok) {
        console.error(`HATA [${file}]: ${v.reason} — atlanıyor`);
        continue;
      }
      const rows = toHoldingRows(parsed).map((r) => ({
        ...r,
        source: 'kap-pdf' as const,
        notes: `${parsed.reportLabel ?? 'KAP PDF'} | ${file.split('/').pop()} (auto KAP fetch, ana kaynak)`,
      }));
      const total = rows.reduce((s, r) => s + r.weight_pct, 0);
      console.log(`OK [${fundCode}] ${file}: ${rows.length} hisse, toplam %${total.toFixed(2)}, dönem=${parsed.asOfDate}`);
      allRows.push(rows);
      meta.push({ fundCode, asOfDate: parsed.asOfDate, label: parsed.reportLabel, count: rows.length, file });
    } catch (e) {
      console.error(`HATA [${file}]: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (allRows.length === 0) {
    console.error('ÖZET: hiçbir PDF parse edilemedi');
    process.exit(1);
  }

  // DRY_RUN ise sadece logla
  if (DRY_RUN) {
    console.log('\n=== DRY_RUN — yazı yapılmadı ===');
    for (const rows of allRows) {
      const code = rows[0]?.fund_code ?? '?';
      console.log(`\n[${code}] ${rows.length} satır:`);
      for (const r of rows.slice(0, 10)) {
        console.log(`  ${r.ticker.padEnd(6)} %${r.weight_pct.toFixed(2).padStart(7)} ${r.company_name ?? ''}`);
      }
      if (rows.length > 10) console.log(`  ... ve ${rows.length - 10} daha`);
    }
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let upserted = 0;
  for (const rows of allRows) {
    if (rows.length === 0) continue;
    const fundCode = rows[0].fund_code;
    // Upsert
    const { error } = await supabase.from('fund_holdings').upsert(rows, { onConflict: 'fund_code,ticker' });
    if (error) throw new Error(`[${fundCode}] upsert hatası: ${error.message}`);
    upserted += rows.length;

    // Stale auto temizliği: bu fon için raporda olmayan AUTO satırları sil (kap-pdf korunur)
    const tickers = rows.map((r) => r.ticker);
    const { data: existing } = await supabase.from('fund_holdings').select('ticker, source').eq('fund_code', fundCode);
    const keepSet = new Set(tickers);
    const stale = (existing ?? []).filter((e) => !['manual', 'kap-pdf', 'calibration'].includes(e.source) && !keepSet.has(e.ticker));
    if (stale.length > 0) {
      const { error: delErr } = await supabase
        .from('fund_holdings')
        .delete()
        .eq('fund_code', fundCode)
        .in('ticker', stale.map((s) => s.ticker));
      if (delErr) console.error(`[${fundCode}] stale silme hatası: ${delErr.message}`);
      else console.log(`[${fundCode}] ${stale.length} eski AUTO satır silindi`);
    }
  }

  console.log(`\nÖZET: ${upserted} satır KAP PDF olarak yazıldı (source=kap-pdf, ham veri, ana kaynak)`);
  for (const m of meta) {
    console.log(`  ${m.fundCode} ${m.asOfDate} ${m.count} hisse ← ${m.file}`);
  }
}

main().catch((e) => {
  console.error(`FATAL: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  process.exit(1);
});
