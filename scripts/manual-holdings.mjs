/**
 * MANUEL FON İÇERİĞİ → SQL ÜRETECİ
 *
 * Amaç: TLY / DFI / THF gibi fonların hisse içeriğini, otomatik sync
 * (fintables/rotaborsa) çalışmadığı için ELLE girmek. JSON'dan Supabase SQL
 * Editor'e yapıştırılabilir, İDMPOTENT bir SQL dosyası üretir.
 *
 * Kullanım:
 *   node scripts/manual-holdings.mjs <veri.json> [çıktı.sql] [seçenekler]
 *
 * Seçenekler:
 *   --schema=old|new|auto   (varsayılan: auto)
 *       old  → DÜZ INSERT, user_id'siz şema (RLS migrasyonu ÖNCESİ)
 *       new  → DÜZ INSERT, user_id'li şema (RLS migrasyonu SONRASI)
 *       auto → DO bloğu runtime'da user_id sütununa bakar
 *   --rows-per-line=N       (varsayılan: 3)  VALUES satırlarını gruplar
 *   --notes=<metin>         notes sütununa yazılacak kısa etiket
 *
 * ÇIKTI SAF ASCII'DİR. Sebep: Supabase SQL Editor'e kopyalarken em-dash (—),
 * emoji (⚠) ve U+FE0F gibi karakterler kaybolup "unterminated quoted string"
 * hatasına yol açıyor. Uzun, her satırda tekrarlanan notes metni de dosyayı
 * şişiriyor (106 satırda ~7 KB). Bu yüzden:
 *   - tüm metin ASCII'ye çevrilir
 *   - notes kısa tutulur
 *   - VALUES satırları gruplanır
 *
 * JSON biçimi:
 * {
 *   "source": "manual",                 // manual | auto | kap-pdf
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

/** lib/types.ts FundAssetType ile hizalı. */
const ASSET_TYPES = new Set(['HISSE', 'TEFAS_FON']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[A-Z0-9]{2,10}$/;

/** Türkçe + tipografik karakterleri ASCII'ye indirger. */
const ASCII_MAP = {
  ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', i̇: 'i',
  ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U',
  â: 'a', Â: 'A', î: 'i', Î: 'I', û: 'u', Û: 'U',
  '—': '-', '–': '-', '…': '...', '·': '-', '’': "'", '‘': "'",
  '“': '"', '”': '"', '⚠': '!', '\uFE0F': '', '\u200B': '',
};
function toAscii(s) {
  return String(s)
    .replace(/[^\x00-\x7F]/g, (c) => (c in ASCII_MAP ? ASCII_MAP[c] : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function fail(msg) {
  console.error(`HATA: ${msg}`);
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Argümanlar                                                          */
/* ------------------------------------------------------------------ */
const opt = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

const schemaArg = opt('schema', 'auto');
if (!['old', 'new', 'auto'].includes(schemaArg)) {
  fail(`--schema '${schemaArg}' geçersiz — old | new | auto olmalı`);
}

const rowsPerLine = Math.max(1, Number(opt('rows-per-line', '3')) || 3);

const args = process.argv.filter((a) => !a.startsWith('--'));
const [, , inputPath, outputPath] = args;
if (!inputPath) {
  fail('kullanım: node scripts/manual-holdings.mjs <veri.json> [çıktı.sql] [--schema=old|new|auto]');
}

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
if (!Array.isArray(data.funds) || data.funds.length === 0) fail('funds dizisi boş veya yok');

/* ------------------------------------------------------------------ */
/* Doğrulama — hatalı veri DB'ye gitmesin                              */
/* ------------------------------------------------------------------ */
const rows = [];
const errors = [];
const dropped = [];   // MIN_IMPACT_PCT altı — sessizce atılmaz, raporlanır
const dates = new Set();

for (const fund of data.funds) {
  const code = String(fund.fund_code ?? '').trim().toUpperCase();
  if (!CODE_RE.test(code)) { errors.push(`fund_code geçersiz: '${fund.fund_code}'`); continue; }
  if (!DATE_RE.test(String(fund.as_of_date ?? ''))) {
    errors.push(`${code}: as_of_date 'YYYY-AA-GG' olmalı, gelen: '${fund.as_of_date}'`); continue;
  }
  if (!Array.isArray(fund.holdings) || fund.holdings.length === 0) {
    errors.push(`${code}: holdings boş`); continue;
  }
  dates.add(fund.as_of_date);

  let total = 0;
  const seen = new Set();
  for (const h of fund.holdings) {
    const ticker = String(h.ticker ?? '').trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) { errors.push(`${code}: ticker geçersiz '${h.ticker}'`); continue; }
    if (seen.has(ticker)) { errors.push(`${code}: ticker '${ticker}' tekrar ediyor`); continue; }
    seen.add(ticker);

    const w = Number(h.weight_pct);
    if (!Number.isFinite(w) || w < 0 || w > 100) {
      errors.push(`${code}/${ticker}: weight_pct 0–100 arası olmalı, gelen: '${h.weight_pct}'`); continue;
    }
    if (w < MIN_IMPACT_PCT) { dropped.push(`${code}/${ticker} (%${w})`); continue; }
    total += w;

    let name = h.company_name == null || String(h.company_name).trim() === ''
      ? null : toAscii(h.company_name);
    if (name && name.length > 200) { errors.push(`${code}/${ticker}: company_name 200 karakterden uzun`); continue; }
    if (name && /'/.test(name)) name = name.replace(/'/g, '');

    // Varlık sınıfı: fiyat kaynağını belirler (HISSE -> Yahoo, TEFAS_FON -> fonaly).
    // Verilmezse 'HISSE' — eski JSON dosyaları değişmeden çalışmaya devam eder.
    const at = String(h.asset_type ?? 'HISSE').trim().toUpperCase();
    if (!ASSET_TYPES.has(at)) {
      errors.push(`${code}/${ticker}: asset_type '${h.asset_type}' gecersiz — ${[...ASSET_TYPES].join(' | ')}`); continue;
    }
    if (at === 'TEFAS_FON' && ticker.length > 9) {
      errors.push(`${code}/${ticker}: TEFAS fon kodu 9 karakterden uzun olamaz`); continue;
    }

    rows.push({ fund_code: code, ticker, company_name: name, weight_pct: w, as_of_date: fund.as_of_date, asset_type: at });
  }

  // Uyarı (hata değil): KAP raporlarında hisse grubu toplamı %100 olmak zorunda
  // değil (fonun geri kalanı tahvil/mevduat olabilir). Ama %100'ü aşması
  // kesinlikle veri hatasıdır.
  if (total > 100.5) errors.push(`${code}: ağırlık toplamı %${total.toFixed(2)} > 100 — veri hatası`);
  // Alt fonlar eklendiğinden beri "N hisse" demek yanlış olurdu → tip kırılımı.
  const fundRows = rows.filter((r) => r.fund_code === code);
  const byType = fundRows.reduce((m, r) => {
    const e = (m[r.asset_type] ??= { n: 0, w: 0 });
    e.n++; e.w += r.weight_pct;
    return m;
  }, {});
  const breakdown = Object.entries(byType)
    .map(([t, e]) => `${t} ${e.n} adet %${e.w.toFixed(2)}`).join(' · ');
  console.log(`  ${code}: ${fundRows.length} satır (${breakdown}), toplam %${total.toFixed(2)}, dönem ${fund.as_of_date}`);
}

if (errors.length > 0) {
  console.error('\nDoğrulama başarısız — SQL ÜRETİLMEDİ:');
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}
if (rows.length === 0) fail('geçerli satır yok');
if (dropped.length > 0) {
  console.log(`  ! %${MIN_IMPACT_PCT} altı olduğu için dışlanan ${dropped.length} satır (lib/fundHoldings.ts kuralı):`);
  dropped.forEach((d) => console.log(`      - ${d}`));
}

/* ------------------------------------------------------------------ */
/* SQL üret                                                            */
/* ------------------------------------------------------------------ */
const IN_LIST = Array.from(new Set(rows.map((r) => r.fund_code))).map((c) => `'${c}'`).join(', ');
const EXPECTED = Array.from(new Set(rows.map((r) => r.fund_code)))
  .map((c) => `${c} = ${rows.filter((r) => r.fund_code === c).length} hisse`).join(', ');

/**
 * notes KISA ve ASCII tutulur. Sebep: bu metin her satırda tekrarlanıyor;
 * 106 satırda 70 karakterlik bir metin ~7 KB saf fazlalık demek ve kopyalama
 * sırasında en çok bu uzun string'ler kopuyor.
 */
const NOTES = toAscii(opt('notes', `manuel ${Array.from(dates).join(' ')}`));

const q = (s) => (s === null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

/** VALUES satırları — `rowsPerLine` kadarı aynı satırda, ASCII. */
function valuesBlock(indent) {
  const pad = ' '.repeat(indent);
  const tuples = rows.map((r) =>
    `(${q(r.fund_code)},${q(r.ticker)},${q(r.company_name)},${r.weight_pct},${q(r.as_of_date)},${q(source)},${q(NOTES)},${q(r.asset_type)})`);
  const lines = [];
  for (let i = 0; i < tuples.length; i += rowsPerLine) {
    lines.push(pad + tuples.slice(i, i + rowsPerLine).join(','));
  }
  return lines.join(',\n');
}

const UPDATE_SET = `  company_name = EXCLUDED.company_name,
  weight_pct   = EXCLUDED.weight_pct,
  as_of_date   = EXCLUDED.as_of_date,
  source       = EXCLUDED.source,
  notes        = EXCLUDED.notes,
  asset_type   = EXCLUDED.asset_type,
  updated_at   = now()`;

/** ESKİ şema: user_id sütunu YOK. Düz INSERT, DO bloğu yok. */
const insertOld = `INSERT INTO public.fund_holdings
  (fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
VALUES
${valuesBlock(2)}
ON CONFLICT (fund_code, ticker) DO UPDATE SET
${UPDATE_SET};`;

/**
 * YENİ şema: user_id NOT NULL. SQL Editor'de postgres rolüyle koştuğunuz için
 * auth.uid() NULL'dır; sahibi auth.users'tan ilk kullanıcıyla çözüyoruz.
 * Birden fazla hesabınız varsa SELECT satırını kendi UUID'nizle değiştirin.
 */
const insertNew = `-- Birden fazla hesabiniz varsa alttaki SELECT'i kendi UUID'nizle degistirin:
--   SELECT id, email FROM auth.users ORDER BY created_at;
INSERT INTO public.fund_holdings
  (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
SELECT (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
       v.fund_code, v.ticker, v.company_name,
       v.weight_pct::numeric, v.as_of_date::date, v.source, v.notes, v.asset_type
FROM (
  VALUES
${valuesBlock(4)}
  ) AS v(fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
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
      RAISE EXCEPTION 'auth.users bos - satirlarin sahibi belirlenemiyor.';
    END IF;

    INSERT INTO public.fund_holdings
      (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
    SELECT owner, v.fund_code, v.ticker, v.company_name,
           v.weight_pct::numeric, v.as_of_date::date, v.source, v.notes, v.asset_type
    FROM (
      VALUES
${valuesBlock(8)}
    ) AS v(fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
    ON CONFLICT (user_id, fund_code, ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      weight_pct   = EXCLUDED.weight_pct,
      as_of_date   = EXCLUDED.as_of_date,
      source       = EXCLUDED.source,
      notes        = EXCLUDED.notes,
      updated_at   = now();

    RAISE NOTICE '% satir yazildi (yeni sema, sahip %)', ${rows.length}, owner;
  ELSE
    INSERT INTO public.fund_holdings
      (fund_code, ticker, company_name, weight_pct, as_of_date, source, notes, asset_type)
    VALUES
${valuesBlock(6)}
    ON CONFLICT (fund_code, ticker) DO UPDATE SET
      company_name = EXCLUDED.company_name,
      weight_pct   = EXCLUDED.weight_pct,
      as_of_date   = EXCLUDED.as_of_date,
      source       = EXCLUDED.source,
      notes        = EXCLUDED.notes,
      updated_at   = now();

    RAISE NOTICE '% satir yazildi (eski sema)', ${rows.length};
  END IF;
END
$body$;`;

const body = schemaArg === 'old' ? insertOld : schemaArg === 'new' ? insertNew : insertAuto;

const SCHEMA_NOTE = {
  old: '-- SEMA: ESKI (user_id YOK) - supabase_rls_user_isolation.sql ONCESI.\n-- DO/$$ blogu ICERMEZ; her SQL istemcisinde sorunsuz kosar.',
  new: '-- SEMA: YENI (user_id VAR) - supabase_rls_user_isolation.sql SONRASI.\n-- DO/$$ blogu ICERMEZ; her SQL istemcisinde sorunsuz kosar.',
  auto: "-- SEMA: OTOMATIK - DO blogu runtime'da user_id sutununa bakar.\n-- (Bazi SQL istemcileri $$ bloklarini yanlis boler; sorun cikarsa\n--  --schema=old veya --schema=new ile yeniden uretin.)",
}[schemaArg];

const SOURCE_NOTE = source === 'manual'
  ? "--   Sync job'u bu satirlari ASLA ezmez. Ayrica as_of_date son 45 gun\n--   icindeyse bu fonlarin otomatik sync'i TAMAMEN atlanir."
  : "--   Sync job'u basarili bir cekim yaptiginda bu satirlari EZER, yeni\n--   listede olmayanlari SILER. Yani bunlar gercekten gecici placeholder.";

const raw = `-- =============================================================================
-- MANUEL FON ICERIGI - ${Array.from(new Set(rows.map((r) => r.fund_code))).join(', ')}
-- Ureten: scripts/manual-holdings.mjs --schema=${schemaArg}
-- source = '${source}' | ${rows.length} satir | notes = '${NOTES}'
--
-- IDEMPOTENT: tekrar calistirmak guvenlidir (ON CONFLICT DO UPDATE).
-- CIKTI SAF ASCII - kopyalarken Turkce karakter/emoji kaybi yasamazsiniz.
--
${SCHEMA_NOTE}
--
-- source='${source}' NE DEMEK:
${SOURCE_NOTE}
-- =============================================================================

${body}

-- -----------------------------------------------------------------------------
-- DOGRULAMA - calistirdiktan sonra bu sorguyu kosun
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
-- TEMIZLIK (yalnizca gerektiginde, yorumu kaldirip calistirin)
-- -----------------------------------------------------------------------------
-- DELETE FROM fund_holdings
--  WHERE fund_code IN (${IN_LIST})
--    AND notes = '${NOTES}';
`;

// Son emniyet: çıktıdaki HER şey ASCII olmalı
const nonAscii = Array.from(new Set(raw.match(/[^\x00-\x7F]/g) ?? []));
if (nonAscii.length > 0) {
  fail(`çıktıda ASCII dışı karakter kaldı: ${nonAscii.map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase()}`).join(', ')}`);
}

const out = outputPath ?? inputPath.replace(/\.json$/, '.sql');
writeFileSync(out, raw, 'utf8');
console.log(`\n✓ ${rows.length} satır, ${new Set(rows.map((r) => r.fund_code)).size} fon → ${out}`);
console.log(`  source='${source}' · şema=${schemaArg} · ${raw.length} bayt · ${raw.split('\n').length} satır · saf ASCII`);
