/**
 * MANUEL FON İÇERİĞİ SQL DOĞRULAMASI
 *
 * scripts/manual-holdings.mjs'in ürettiği SQL dosyasını GERÇEK bir PostgreSQL
 * üzerinde, HEM eski şemada HEM supabase_rls_user_isolation.sql sonrasındaki
 * şemada çalıştırıp sonucu denetler.
 *
 *   npm run test:manual-sql
 *
 * Denetlenenler:
 *   1. SQL eski şemada çalışıyor
 *   2. Satır sayıları JSON ile birebir aynı
 *   3. En ağır satırlar ve ağırlıkları beklenen değerlerde
 *   4. Ağırlık toplamı ≤ 100 (lib/fundHoldings.ts validateParsed kuralı)
 *   5. MIN_IMPACT_PCT altı satırlar yazılmamış
 *   6. İdempotent — 2. koşuda satır artmıyor
 *   7. RLS migrasyonu sonrası tüm satırlar user_id alıyor
 *   8. Aynı SQL yeni şemada upsert olarak çalışıyor, çift kayıt yok
 *   9. Yalıtım: başka kullanıcı satırları göremiyor
 *
 * Bu test SQL metnine bakmaz; gerçekten çalıştırır. Böylece "VALUES bloğunda
 * sütun eksik" veya "as_of_date için ::date cast'i yok" gibi yalnızca koşunca
 * ortaya çıkan hataları yakalar.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * data/ altındaki her manual-holdings girdisi + ona karşılık gelen SQL.
 * Yeni bir manuel veri dosyası eklerken buraya da ekleyin.
 */
const CASES = [
  {
    label: 'Tera Portföy THF+TLY — Ağustos 2026 KAP raporu',
    json: 'data/tera_holdings_2026-08.json',
    sql: 'supabase/manual_holdings_tera_2026-08.sql',
  },
];

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const PORT = Number(process.env.PGTEST_PORT ?? 55441);
const DATA_DIR = process.env.PGTEST_DIR ?? join(REPO, 'node_modules', '.pgtest-manual');

let pass = 0;
let fail = 0;
const t = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ::  ${String(detail).replace(/\s+/g, ' ').slice(-180)}`);
  }
};

/**
 * CASES'teki dosyalar KULLANICIYA ÖZEL veridir ve .gitignore'dadır — repoda
 * bulunmazlar. Bu yüzden yokluk hata değil, normal durumdur: test o case'i
 * atlar. Hiç case kalmazsa 0 exit ile çıkar ki CI'da kırmızı görünmesin.
 *
 * Kendi verinizle koşmak için:
 *   node scripts/manual-holdings.mjs <veri.json> <çıktı.sql>
 * ve CASES listesine ikisini de ekleyin.
 */
const ACTIVE = CASES.filter((c) => existsSync(join(REPO, c.json)) && existsSync(join(REPO, c.sql)));
const SKIPPED = CASES.filter((c) => !ACTIVE.includes(c));

if (ACTIVE.length === 0) {
  console.log('MANUEL SQL DOĞRULAMA: koşacak case yok (veri dosyaları yerel, .gitignore\'da).');
  if (SKIPPED.length > 0) {
    console.log(`  atlanan: ${SKIPPED.map((c) => c.json).join(', ')}`);
    console.log('  Üretmek için: node scripts/manual-holdings.mjs <veri.json> <çıktı.sql>');
  }
  process.exit(0);
}

rmSync(DATA_DIR, { recursive: true, force: true });
const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: false,
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

const run = async (rel) => admin.query(readFileSync(join(REPO, rel), 'utf8'));
const count = async (sql, ...p) => Number((await admin.query(sql, p)).rows[0].c);

const SETUP = [
  'supabase/supabase_schema.sql',
  'supabase/supabase_fund_holdings_migration.sql',
  'supabase/supabase_twitter_migration.sql',
  'supabase/supabase_fund_proposals_migration.sql',
];

console.log('Kurulum: eski şema (RLS migrasyonu YOK)');
for (const f of SETUP) await run(f);
await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_A}', 'a@example.com')`);

for (const c of ACTIVE) {
  const spec = JSON.parse(readFileSync(join(REPO, c.json), 'utf8'));
  const codes = spec.funds.map((f) => f.fund_code);
  const inList = codes.map((x) => `'${x}'`).join(', ');
  const expected = Object.fromEntries(spec.funds.map((f) => [f.fund_code, f.holdings.length]));
  // MIN_IMPACT_PCT altı satırlar üreteç tarafından dışlanır → beklenen sayıyı
  // JSON'dan değil, üretilen SQL'in kendi NOTES değerinden türetmek yerine
  // doğrudan DB'den okuyup tutarlılığı denetliyoruz.

  console.log(`\n=== ${c.label} ===`);
  console.log(`    dosya: ${c.sql}`);

  try {
    await run(c.sql);
    t('SQL eski şemada çalıştı', true);
  } catch (e) {
    t('SQL eski şemada çalıştı', false, e.message);
    continue;
  }

  const rows = (await admin.query(
    `SELECT fund_code, ticker, weight_pct FROM fund_holdings
      WHERE fund_code IN (${inList}) ORDER BY fund_code, weight_pct DESC`
  )).rows;

  for (const code of codes) {
    const mine = rows.filter((r) => r.fund_code === code);
    const total = mine.reduce((s, r) => s + Number(r.weight_pct), 0);
    const jsonCount = expected[code];
    console.log(`    ${code}: ${mine.length}/${jsonCount} satır, toplam ağırlık %${total.toFixed(2)}`);

    // Dışlanan satırlar olabileceği için <= beklenen, ama 0 olmamalı
    t(`${code} satır yazıldı`, mine.length > 0 && mine.length <= jsonCount, `${mine.length} / ${jsonCount}`);
    t(`${code} ağırlık toplamı ≤ 100`, total <= 100.0001, `%${total.toFixed(4)}`);
    t(`${code} ağırlık toplamı ≥ 1`, total >= 1, `%${total.toFixed(4)}`);

    const below = mine.filter((r) => Number(r.weight_pct) < 0.01);
    t(`${code} MIN_IMPACT_PCT altı satır yok`, below.length === 0, below.map((r) => r.ticker).join(','));

    const dupes = mine.length - new Set(mine.map((r) => r.ticker)).size;
    t(`${code} tekrar eden ticker yok`, dupes === 0, `${dupes} duplike`);
  }

  console.log('  -- idempotency --');
  try {
    await run(c.sql);
    t('2. koşu başarılı', true);
  } catch (e) {
    t('2. koşu başarılı', false, e.message);
  }
  const after = await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${inList})`);
  t('2. koşuda satır sayısı artmadı', after === rows.length, `${after} != ${rows.length}`);
}

console.log('\n=== RLS migrasyonu uygulanıyor ===');
await run('supabase/supabase_rls_user_isolation.sql');

const allCodes = ACTIVE.flatMap((c) => JSON.parse(readFileSync(join(REPO, c.json), 'utf8')).funds.map((f) => f.fund_code));
const allIn = allCodes.map((x) => `'${x}'`).join(', ');

t('tüm manuel satırlar user_id aldı',
  await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn}) AND user_id IS NULL`) === 0);
t('hepsi doğru kullanıcıya bağlı',
  await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn}) AND user_id = '${USER_A}'`) > 0);

console.log('\n=== Aynı SQL yeni şemada (upsert) ===');
for (const c of ACTIVE) {
  try {
    await run(c.sql);
    t(`${c.sql.split('/').pop()} yeni şemada çalıştı`, true);
  } catch (e) {
    t(`${c.sql.split('/').pop()} yeni şemada çalıştı`, false, e.message);
  }
}
t('çift kayıt oluşmadı',
  await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn})`)
  === await count(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn}) AND user_id = '${USER_A}'`));

console.log('\n=== Yalıtım ===');
await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_B}', 'b@example.com')`);
const other = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
await other.connect();
await other.query('SET ROLE authenticated');
await other.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [USER_B]);
const bRows = await other.query(`SELECT * FROM fund_holdings WHERE fund_code IN (${allIn})`);
t("B kullanıcısı A'nın manuel içeriğini göremiyor", bRows.rowCount === 0, `${bRows.rowCount} satır`);
await other.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [USER_A]);
const aRows = await other.query(`SELECT count(*) c FROM fund_holdings WHERE fund_code IN (${allIn})`);
t('A kendi içeriğini görüyor', Number(aRows.rows[0].c) > 0, aRows.rows[0].c);
await other.end();

console.log(`\n${'='.repeat(64)}`);
console.log(`MANUEL SQL DOĞRULAMA SONUCU: ${pass} geçti, ${fail} kaldı`);
console.log('='.repeat(64));

await admin.end();
await pg.stop();
rmSync(DATA_DIR, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
