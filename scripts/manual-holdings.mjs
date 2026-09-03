/**
 * MANUEL FON İÇERİĞİ → SQL ÜRETECİ
 *
 * Amaç: TLY / DFI / THF gibi fonların hisse içeriğini, otomatik sync
 * (fintables/rotaborsa) çalışmadığı için ELLE girmek. Bu script bir JSON
 * dosyasından Supabase SQL Editor'e yapıştırılabilir, İDMPOTENT bir SQL
 * dosyası üretir.
 *
 * Kullanım:
 *   node scripts/manual-holdings.mjs <veri.json> [çıktı.sql]
 *
 * JSON biçimi:
 * {
 *   "source": "manual",                 // manual | auto   (aşağıdaki nota bakın)
 *   "funds": [
 *     {
 *       "fund_code": "TLY",
 *       "as_of_date": "2026-07-31",     // resmî KAP rapor dönemi sonu
 *       "holdings": [
 *         { "ticker": "OZATD", "company_name": "Özata Denizcilik", "weight_pct": 34.27 },
 *         { "ticker": "ASELS", "weight_pct": 8.5 }              // company_name opsiyonel
 *       ]
 *     }
 *   ]
 * }
 *
 * source KARARI:
 *   manual → sync job'u bu satırları ASLA ezmez. Ayrıca as_of_date son 45 gün
 *             içindeyse o fonun otomatik sync'i TAMAMEN atlanır
 *             (scripts/fund_holdings/sync.ts → hasRecentKapPdf).
 *   auto   → sync job'u başarılı bir çekim yaptığında bu satırları ezer;
 *             yeni listede olmayanları SİLER. Yani gerçekten "geçici" veri.
 *
 * ŞEMA UYUMU: Üretilen SQL hem eski şemada (UNIQUE (fund_code,ticker), user_id
 * YOK) hem de supabase_rls_user_isolation.sql sonrasındaki şemada
 * (UNIQUE (user_id,fund_code,ticker)) çalışır — user_id sütununun var olup
 * olmadığına runtime'da bakar. Böylece "önce mi sonra mı çalıştırmalıyım"
 * diye düşünmeniz gerekmez.
 */

import { readFileSync, writeFileSync } from 'node:fs';

/**
 * lib/fundHoldings.ts → MIN_IMPACT_PCT ile BİREBİR aynı eşik.
 * "Fona etkisi %0.01'in altındaki hisse hesaplamaya girmez (kullanıcı şartı)."
 * Bu script de aynı kuralı uygular; aksi hâlde elle girilen veri, sync'in
 * ürettiği veriden farklı bir kural setiyle yazılmış olurdu.
 * Ayrıca weight_pct NUMERIC(8,4) olduğu için %0.00005 altı zaten 0'a yuvarlanır.
 */
const MIN_IMPACT_PCT = 0.01;

const TICKER_RE = /^[A-Z0-9]{2,10}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Z0-9]{2,10}$/;

function fail(msg) {
  console.error(`HATA: ${msg}`);
  process.exit(1);
}

/**
 * --schema=old|new|auto   (varsayılan: auto)
 *
 *   auto → DO bloğu runtime'da user_id sütununa bakar (hem eski hem yeni şema)
 *   old  → DÜZ INSERT, DO bloğu YOK. Yalnızca RLS migrasyonu ÖNCESİ şema.
 *   new  → DÜZ INSERT, user_id'li. Yalnızca RLS migrasyonu SONRASI şema.
 *
 * `old`/`new` modlarında dosyada HİÇ `DO`/`$$` bulunmaz. Bazı SQL istemcileri
 * dolar-alıntılı ($$) blokları yanlış böldüğü için bu modlar daha güvenlidir.
 */
const schemaArg = (process.argv.find((a) => a.startsWith('--schema=')) ?? '--schema=auto')
  .slice('--schema='.length);
if (!['old', 'new', 'auto'].includes(schemaArg)) {
  fail(`--schema '${schemaArg}' geçersiz — old | new | auto olmalı`);
}

const args = process.argv.filter((a) => !a.startsWith('--'));
const [, , inputPath, outputPath] = args;
if (!inputPath) fail('kullanım: node scripts/manual-holdings.mjs <veri.json> [çıktı.sql] [--schema=old|new|auto]');

let data;
try {
  data = JSON.parse(readFileSync(inputPath, 'utf8'));
} catch (e) {
  fail(`${inputPath} okunamadı veya geçerli JSON değil → ${e.message}`);
}

const source = data.source ?? 'manual';
if (!['manual', 'auto', 'kap-pdf'].includes(source)) {
  fail(`source '${source}' geçersiz — manual | auto | kap-pdf olmalı`);
}

if (!Array.isArray(data.funds) || data.funds.length === 0) {
  fail('funds dizisi boş veya yok');
}

/* ------------------------------------------------------------------ */
/* Doğrulama — hatalı veri DB'ye gitmesin                              */
/* ------------------------------------------------------------------ */
const rows = [];
const errors = [];
const dropped = [];   // MIN_IMPACT_PCT altı — sessizce atılmaz, raporlanır

for (const fund of data.funds) {
  const code = String(fund.fund_code ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) {
    errors.push(`fund_code geçersiz: '${fund.fund_code}'`);
    continue;
  }
  if (!DATE_RE.test(String(fund.as_of_date ?? ''))) {
    errors.push(`${code}: as_of_date 'YYYY-AA-GG' biçiminde olmalı, gelen: '${fund.as_of_date}'`);
    continue;
  }
  if (!Array.isArray(fund.holdings) || fund.holdings.length === 0) {
    errors.push(`${code}: holdings boş`);
    continue;
  }

  let total = 0;
  const seen = new Set();
  for (const h of fund.holdings) {
    const ticker = String(h.ticker ?? '').trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) {
      errors.push(`${code}: ticker geçersiz '${h.ticker}'`);
      continue;
    }
    if (seen.has(ticker)) {
      errors.push(`${code}: ticker '${ticker}' tekrar ediyor`);
      continue;
    }
    seen.add(ticker);

    const w = Number(h.weight_pct);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      errors.push(`${code}/${ticker}: weight_pct 0–100 arasında olmalı, gelen: '${h.weight_pct}'`);
      continue;
    }
    if (w < MIN_IMPACT_PCT) {
      dropped.push(`${code}/${ticker} (%${w})`);
      continue;
    }
    total += w;

    const name = h.company_name == null || String(h.company_name).trim() === ''
      ? null
      : String(h.company_name).trim();
    if (name && name.length > 200) {
      errors.push(`${code}/${ticker}: company_name 200 karakterden uzun`);
      continue;
    }

    rows.push({ fund_code: code, ticker, company_name: name, weight_pct: w, as_of_date: fund.as_of_date });
  }

  // Uyarı (hata değil): KAP raporlarında hisse grubu toplamı %100 olmak zorunda
  // değil (fonun geri kalanı tahvil/mevduat olabilir). Ama %100'ü aşması
  // kesinlikle veri hatasıdır.
  if (total > 100.5) errors.push(`${code}: ağırlık toplamı %${total.toFixed(2)} > 100 — veri hatası`);
  console.log(`  ${code}: ${seen.size} hisse, ağırlık toplamı %${total.toFixed(2)}, dönem ${fund.as_of_date}`);
}

if (errors.length > 0) {
  console.error('\nDoğrulama başarısız — SQL ÜRETİLMEDİ:');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}
if (rows.length === 0) fail('geçerli satır yok');
if (dropped.length > 0) {
  console.log(`  ⚠️  %${MIN_IMPACT_PCT} altı olduğu için dışlanan ${dropped.length} satır (lib/fundHoldings.ts kuralı):`);
  dropped.forEach((d) => console.log(`       - ${d}`));
}

/* ------------------------------------------------------------------ */
/* SQL üret                                                            */
/* ------------------------------------------------------------------ */
const q = (s) => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

/**
 * VALUES satırları — `indent` kadar girintili, virgüllü liste.
 * 7 sütun: fund_code, ticker, company_name, weight_pct, as_of_date, source, notes
 * (source ve notes her satırda aynı; INSERT'in hedef sütun sayısıyla birebir
 *  eşleşmesi şart, yoksa "INSERT has more target columns than expressions".)
 */
const NOTES = `manuel giriş (geçici) — scripts/manual-holdings.mjs${
  dropped.length > 0 ? ` | dışlanan: ${dropped.length}` : ''
}`;
function valuesBlock(indent) {
  const pad = ' '.repeat(indent);
  return rows
    .map((r) => `${pad}(${q(r.fund_code)}, ${q(r.ticker)}, ${q(r.company_name)}, ${r.weight_pct}, ${q(r.as_of_date)}, ${q(source)}, ${q(NOTES)})`)
    .join(',\n');
}

const fundCodes = Array.from(new Set(rows.map((r) => r.fund_code)));

const IN_LIST = fundCodes.map((c) => `'${c}'`).join(', ');
const EXPECTED = fundCodes.map((c) => `${c} = ${rows.filter((r) => r.fund_code === c).length} hisse`).join(', ');

const UPDATE_SET = `  company_name = EXCLUDED.company_name,
  weight_pct   = EXCLUDED.weight_pct,
  as_of_date   = EXCLUDED.as_of_date,
  source       = EXCLUDED.source,
  notes        = EXCLUDED.notes,
  updated_at   = now()`;

/** ESKİ şema: user_id sütunu YOK. Düz INSERT, DO bloğu yok. */
const insertOld = `INSERT INTO public.fund_holdings
  (fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
VALUES
${valuesBlock(2)}
ON CONFLICT (fund_code, ticker) DO UPDATE SET
${UPDATE_SET};`;

/**
 * YENİ şema: user_id NOT NULL. SQL Editor'de postgres rolüyle koştuğunuz için
 * auth.uid() NULL'dır; sahibi auth.users'tan ilk kullanıcıyla çözüyoruz.
 * Birden fazla hesabınız varsa SELECT satırını kendi UUID'nizle değiştirin.
 */
const insertNew = `-- ⚠️ Birden fazla hesabınız varsa alttaki SELECT'i kendi UUID'nizle değiştirin:
--   SELECT id, email FROM auth.users ORDER BY created_at;
INSERT INTO public.fund_holdings
  (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
SELECT (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
       v.fund_code, v.ticker, v.company_name,
       v.weight_pct::numeric, v.as_of_date::date, v.source, v.notes
FROM (
  VALUES
${valuesBlock(4)}
  ) AS v(fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
ON CONFLICT (user_id, fund_code, ticker) DO UPDATE SET
${UPDATE_SET};`;

/** AUTO: runtime'da şemayı tespit eder. DO/$$ bloğu içerir. */
const insertAuto = `DO $body$
DECLARE
  has_user_id BOOLEAN;
  owner UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'fund_holdings'
       AND column_name  = 'user_id'
  ) INTO has_user_id;

  IF has_user_id THEN
    SELECT id INTO owner FROM auth.users ORDER BY created_at LIMIT 1;
    IF owner IS NULL THEN
      RAISE EXCEPTION 'auth.users boş — satırların sahibi belirlenemiyor.';
    END IF;

    INSERT INTO public.fund_holdings
      (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
    SELECT owner, v.fund_code, v.ticker, v.company_name,
           v.weight_pct::numeric, v.as_of_date::date, v.source, v.notes
    FROM (
      VALUES
${valuesBlock(8)}
    ) AS v(fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
    ON CONFLICT (user_id, fund_code, ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      weight_pct   = EXCLUDED.weight_pct,
      as_of_date   = EXCLUDED.as_of_date,
      source       = EXCLUDED.source,
      notes        = EXCLUDED.notes,
      updated_at   = now();

    RAISE NOTICE '% satır yazıldı (yeni şema, sahip %)', ${rows.length}, owner;
  ELSE
    INSERT INTO public.fund_holdings
      (fund_code, ticker, company_name, weight_pct, as_of_date, source, notes)
    VALUES
${valuesBlock(6)}
    ON CONFLICT (fund_code, ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      weight_pct   = EXCLUDED.weight_pct,
      as_of_date   = EXCLUDED.as_of_date,
      source       = EXCLUDED.source,
      notes        = EXCLUDED.notes,
      updated_at   = now();

    RAISE NOTICE '% satır yazıldı (eski şema)', ${rows.length};
  END IF;
END
$body$;`;

const body = schemaArg === 'old' ? insertOld : schemaArg === 'new' ? insertNew : insertAuto;

const SCHEMA_NOTE = {
  old: '-- ŞEMA: ESKİ (user_id YOK) — supabase_rls_user_isolation.sql ÖNCESİ.\n-- DO/$$ bloğu İÇERMEZ; her SQL istemcisinde sorunsuz koşar.',
  new: '-- ŞEMA: YENİ (user_id VAR) — supabase_rls_user_isolation.sql SONRASI.\n-- DO/$$ bloğu İÇERMEZ; her SQL istemcisinde sorunsuz koşar.',
  auto: "-- ŞEMA: OTOMATİK — DO bloğu runtime'da user_id sütununa bakar.\n-- (Bazı SQL istemcileri $$ bloklarını yanlış böler; sorun çıkarsa\n--  --schema=old veya --schema=new ile yeniden üretin.)",
}[schemaArg];

const sql = `-- =============================================================================
-- MANUEL FON İÇERİĞİ — ${fundCodes.join(', ')}
-- Üreten: scripts/manual-holdings.mjs --schema=${schemaArg}  (elle düzenlemeyin)
-- source = '${source}' · ${rows.length} satır
--
-- İDEMPOTENT: tekrar çalıştırmak güvenlidir (ON CONFLICT DO UPDATE).
--
${SCHEMA_NOTE}
--
-- ⚠️ source='${source}' NE DEMEK:
${source === 'manual'
    ? `--   Sync job'u bu satırları ASLA ezmez. Ayrıca as_of_date son 45 gün içindeyse
--   bu fonların otomatik sync'i TAMAMEN atlanır. Gerçek veri geldiğinde
--   aşağıdaki "TEMİZLİK" bloğunu çalıştırın.`
    : `--   Sync job'u başarılı bir çekim yaptığında bu satırları EZER, yeni listede
--   olmayanları SİLER. Yani bunlar gerçekten geçici placeholder.`}
-- =============================================================================

${body}

-- -----------------------------------------------------------------------------
-- DOĞRULAMA — çalıştırdıktan sonra bu sorguyu koşun
-- Beklenen: ${EXPECTED}
-- -----------------------------------------------------------------------------
SELECT fund_code, count(*) AS hisse_sayisi,
       round(sum(weight_pct)::numeric, 2) AS toplam_agirlik,
       max(as_of_date) AS donem, source
  FROM fund_holdings
 WHERE fund_code IN (${IN_LIST})
 GROUP BY fund_code, source
 ORDER BY fund_code;

-- -----------------------------------------------------------------------------
-- TEMİZLİK (yalnızca gerektiğinde, yorumu kaldırıp çalıştırın)
-- -----------------------------------------------------------------------------
-- DELETE FROM fund_holdings
--  WHERE fund_code IN (${IN_LIST})
--    AND source = '${source}'
--    AND notes LIKE 'manuel giriş (geçici)%';
`;

// VALUES bloğunu iki şema için ayrı ayrı doğru biçimde yerleştir
const out = outputPath ?? inputPath.replace(/\.json$/, '.sql');
writeFileSync(out, sql, 'utf8');
console.log(`\n✓ ${rows.length} satır, ${fundCodes.length} fon → ${out}`);
console.log(`  source = '${source}'`);
