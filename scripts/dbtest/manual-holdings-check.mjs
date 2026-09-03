/**
 * MANUEL FON İÇERİĞİ SQL DOĞRULAMASI
 *
 *   npm run test:manual-sql
 *
 * scripts/manual-holdings.mjs'i HER ÜÇ modda (--schema=old|new|auto) çalıştırıp
 * ürettiği SQL'i GERÇEK bir PostgreSQL üzerinde koşar. SQL metnine bakmaz —
 * gerçekten çalıştırır. Böylece "VALUES bloğunda sütun eksik", "as_of_date için
 * ::date cast'i yok", "DO bloğu yanlış bölündü" gibi yalnızca koşunca ortaya
 * çıkan hataları yakalar.
 *
 * Denetlenen matris:
 *                      eski şema      yeni şema (RLS migrasyonu sonrası)
 *   --schema=old       ✓ çalışmalı    ✗ reddedilmeli
 *   --schema=new       ✗ reddedilmeli ✓ çalışmalı
 *   --schema=auto      ✓ çalışmalı    ✓ çalışmalı
 *
 * Ek olarak: satır sayıları, ağırlık toplamı ≤ 100, MIN_IMPACT_PCT filtresi,
 * tekrar eden ticker yokluğu, idempotency, user_id backfill, kullanıcı yalıtımı.
 *
 * VERİ DOSYALARI (data/*.json) kullanıcıya özeldir ve .gitignore'dadır — repoda
 * bulunmazlar. Yoksa test atlar ve 0 ile çıkar, CI kırmızı olmaz.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TMP = join(REPO, 'node_modules', '.pgtest-manual');

/** Yeni bir manuel veri dosyası eklerken buraya da ekleyin. */
const CASES = [
  { label: 'Tera Portföy THF+TLY — Ağustos 2026 KAP raporu', json: 'data/tera_holdings_2026-08.json' },
];

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const PORT = Number(process.env.PGTEST_PORT ?? 55441);

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ::  ${String(detail).replace(/\s+/g, ' ').slice(-180)}`); }
};

const ACTIVE = CASES.filter((c) => existsSync(join(REPO, c.json)));
if (ACTIVE.length === 0) {
  console.log('MANUEL SQL DOĞRULAMA: koşacak case yok (veri dosyaları yerel, .gitignore\'da).');
  console.log(`  beklenen: ${CASES.map((c) => c.json).join(', ')}`);
  console.log('  Üretmek için: node scripts/manual-holdings.mjs <veri.json> <çıktı.sql>');
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* Üreteci üç modda da koş                                             */
/* ------------------------------------------------------------------ */
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const variants = []; // { label, mode, sqlPath, spec }
for (const c of ACTIVE) {
  const spec = JSON.parse(readFileSync(join(REPO, c.json), 'utf8'));
  for (const mode of ['old', 'new', 'auto']) {
    const out = join(TMP, `${c.json.split('/').pop().replace(/\.json$/, '')}.${mode}.sql`);
    try {
      execFileSync(process.execPath, [join(REPO, 'scripts/manual-holdings.mjs'), c.json, out, `--schema=${mode}`],
        { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });

      // SAF ASCII DENETİMİ — kullanıcı bu yüzden iki kez hata aldı:
      // Supabase SQL Editor'e kopyalarken em-dash (U+2014), emoji (U+26A0) ve
      // görünmez U+FE0F kaybolup "unterminated quoted string" üretiyor.
      // Her satırda tekrarlanan uzun notes metni de dosyayı şişiriyordu.
      const text = readFileSync(out, 'utf8');
      const bad = Array.from(new Set(text.match(/[^\x00-\x7F]/g) ?? []));
      t(`--schema=${mode} çıktısı saf ASCII`, bad.length === 0,
        bad.map((x) => `U+${x.codePointAt(0).toString(16).toUpperCase()}`).join(','));

      variants.push({ label: c.label, mode, sqlPath: out, spec });
    } catch (e) {
      t(`üreteç --schema=${mode} (${c.json})`, false, e.stderr?.toString() ?? e.message);
    }
  }
}
console.log(`Üretilen varyant: ${variants.length} (${ACTIVE.length} veri × 3 mod)\n`);

/* ------------------------------------------------------------------ */
/* PostgreSQL                                                          */
/* ------------------------------------------------------------------ */
const pg = new EmbeddedPostgres({
  databaseDir: join(TMP, 'pgdata'), user: 'postgres', password: 'postgres', port: PORT, persistent: false,
});
await pg.initialise();
await pg.start();

const admin = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
await admin.connect();

// Supabase'in rol/şema yapısını taklit et
await admin.query(`
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
  GRANT SELECT ON auth.users TO authenticated, service_role;
  GRANT ALL ON SCHEMA public TO postgres, authenticated, anon, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon, service_role;
  GRANT authenticated TO postgres;
`);

const runFile = async (absPath) => admin.query(readFileSync(absPath, 'utf8'));
const runRepo = async (rel) => admin.query(readFileSync(join(REPO, rel), 'utf8'));
const count = async (sql) => Number((await admin.query(sql)).rows[0].c);

const SETUP = [
  'supabase/supabase_schema.sql',
  'supabase/supabase_fund_holdings_migration.sql',
  'supabase/supabase_twitter_migration.sql',
  'supabase/supabase_fund_proposals_migration.sql',
];

console.log('=== ESKİ ŞEMA kuruluyor (RLS migrasyonu YOK) ===');
for (const f of SETUP) await runRepo(f);
await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_A}', 'a@example.com')`);

/** Bir varyantı koşup içerik denetimlerini yapar. shouldWork=false ise hata bekler. */
async function exercise(v, schemaLabel, shouldWork) {
  const codes = v.spec.funds.map((f) => f.fund_code);
  const inList = codes.map((x) => `'${x}'`).join(', ');
  const tag = `--schema=${v.mode} @ ${schemaLabel}`;

  let ran = false;
  let err = null;
  try { await runFile(v.sqlPath); ran = true; } catch (e) { err = e; }

  if (!shouldWork) {
    t(`${tag} → REDDEDİLDİ`, !ran, ran ? 'çalıştı ama çalışmamalıydı' : '');
    if (!ran) console.log(`        (${err.code ?? ''} ${String(err.message).split('\n')[0].slice(0, 90)})`);
    return;
  }

  t(`${tag} → çalıştı`, ran, err?.message);
  if (!ran) return;

  // user_id seçilmez: eski şemada o sütun yok, sorgu 42703 verirdi.
  // user_id denetimi ayrıca, migrasyon sonrasında yapılıyor.
  const rows = (await admin.query(
    `SELECT fund_code, ticker, weight_pct FROM fund_holdings
      WHERE fund_code IN (${inList}) ORDER BY fund_code, weight_pct DESC`
  )).rows;

  for (const code of codes) {
    const mine = rows.filter((r) => r.fund_code === code);
    const jsonCount = v.spec.funds.find((f) => f.fund_code === code).holdings.length;
    const total = mine.reduce((s, r) => s + Number(r.weight_pct), 0);

    t(`${tag} ${code} satır yazıldı (≤ ${jsonCount})`, mine.length > 0 && mine.length <= jsonCount, `${mine.length}/${jsonCount}`);
    t(`${tag} ${code} toplam ağırlık 1–100`, total >= 1 && total <= 100.0001, `%${total.toFixed(4)}`);
    t(`${tag} ${code} MIN_IMPACT_PCT altı yok`, mine.every((r) => Number(r.weight_pct) >= 0.01),
      mine.filter((r) => Number(r.weight_pct) < 0.01).map((r) => r.ticker).join(','));
    t(`${tag} ${code} duplike ticker yok`, mine.length === new Set(mine.map((r) => r.ticker)).size);
  }
  return rows.length;
}

console.log('\n=== MATRİS: eski şema ===');
for (const v of variants) await exercise(v, 'eski', v.mode !== 'new');

console.log('\n=== İdempotency (eski şema, old modu) ===');
for (const v of variants.filter((x) => x.mode === 'old')) {
  const before = await count(`SELECT count(*) c FROM fund_holdings`);
  try { await runFile(v.sqlPath); t('--schema=old 2. koşu başarılı', true); }
  catch (e) { t('--schema=old 2. koşu başarılı', false, e.message); }
  const after = await count(`SELECT count(*) c FROM fund_holdings`);
  t('--schema=old 2. koşuda satır artmadı', before === after, `${before} → ${after}`);
}

console.log('\n=== RLS MİGRASYONU uygulanıyor (yeni şema) ===');
await runRepo('supabase/supabase_rls_user_isolation.sql');

const allCodes = ACTIVE.flatMap((c) => JSON.parse(readFileSync(join(REPO, c.json), 'utf8')).funds.map((f) => f.fund_code));
const allIn = allCodes.map((x) => `'${x}'`).join(', ');
t('eski modla yazılan satırlar user_id aldı',
  await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn}) AND user_id IS NULL`) === 0);

console.log('\n=== MATRİS: yeni şema ===');
for (const v of variants) await exercise(v, 'yeni', v.mode !== 'old');

console.log('\n=== Çift kayıt kontrolü ===');
t('toplam satır = doğru kullanıcıya bağlı satır',
  await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn})`)
  === await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn}) AND user_id = '${USER_A}'`));

console.log('\n=== Yalıtım ===');
await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_B}', 'b@example.com')`);
const other = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
await other.connect();
await other.query('SET ROLE authenticated');
await other.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [USER_B]);
const bRows = await other.query(`SELECT * FROM fund_holdings WHERE fund_code IN (${allIn})`);
t("B, A'nın manuel içeriğini göremiyor", bRows.rowCount === 0, `${bRows.rowCount} satır`);
await other.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [USER_A]);
const aRows = await other.query(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn})`);
t('A kendi içeriğini görüyor', Number(aRows.rows[0].c) > 0, aRows.rows[0].c);
await other.end();

console.log(`\n${'='.repeat(64)}`);
console.log(`MANUEL SQL DOĞRULAMA SONUCU: ${pass} geçti, ${fail} kaldı`);
console.log('='.repeat(64));

await admin.end();
await pg.stop();
rmSync(TMP, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
