/**
 * RLS KULLANICI YALITIMI — GERÇEK POSTGRESQL'E KARŞI DOĞRULAMA
 *
 * Neden: supabase/supabase_rls_user_isolation.sql bir güvenlik sınırı.
 * `auth.uid() = user_id` politikalarının gerçekten çalıştığını SQL metnine
 * bakarak DEĞİL, iki farklı kullanıcıyla sorgu atarak kanıtlıyoruz.
 *
 * embedded-postgres gerçek bir PostgreSQL ikilisi indirir ve geçici bir
 * cluster ayağa kaldırır; Supabase'in `auth` şeması + `auth.uid()` fonksiyonu
 * + `anon` / `authenticated` / `service_role` rolleri taklit edilir.
 *
 * Çalıştırma:  npm run test:db
 * Ağ gerekmez (ikili npm üzerinden gelir), harici servis gerekmez.
 *
 * NOT: Bu dosya `vitest` ile DEĞİL düz node ile koşar — sebebi süreç ömrü
 * boyunca tek bir PostgreSQL cluster'ı yaşatıp tüm senaryoları aynı veride
 * denemek. Çıkış kodu: 0 = hepsi geçti, 1 = en az bir başarısızlık.
 */

import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = join(ROOT, '.dbtest-data');
const PORT = Number(process.env.DBTEST_PORT ?? 55432);

/** Senaryodaki iki kullanıcı. */
const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

/** Kurulum sırasında çalıştırılan SQL dosyaları (sıra önemli). */
const SETUP_SQL = [
  'supabase/supabase_schema.sql',
  'supabase/supabase_fund_holdings_migration.sql',
  'supabase/supabase_twitter_migration.sql',
  'supabase/supabase_fund_proposals_migration.sql',
];
const MIGRATION = 'supabase/supabase_rls_user_isolation.sql';

let pass = 0;
let fail = 0;

function t(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ::  ${String(extra).replace(/\s+/g, ' ').slice(-200)}`);
  }
}

rmSync(DATA_DIR, { recursive: true, force: true });

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: 'postgres',
  password: 'postgres',
  port: PORT,
  persistent: false,
});

const conn = { host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' };

let exitCode = 1;
try {
  await pg.initialise();
  await pg.start();

  const admin = new Client(conn);
  await admin.connect();

  /* ------------------------------------------------------------------ */
  /* Supabase ortamının taklidi                                          */
  /* ------------------------------------------------------------------ */
  await admin.query(`
    CREATE ROLE anon          NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role  NOLOGIN BYPASSRLS;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
    -- Supabase'in gerçek auth.uid() tanımıyla aynı şekil:
    -- JWT'nin "sub" claim'ini okur, oturum yoksa NULL döner.
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon, service_role;
    GRANT SELECT ON auth.users TO authenticated, service_role;
    GRANT ALL ON SCHEMA public TO postgres, authenticated, anon, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon, service_role;
    GRANT authenticated TO postgres;
  `);
  console.log('✓ Supabase-benzeri ortam hazır (auth.users, auth.uid(), 3 rol)');

  const run = async (f) => { await admin.query(readFileSync(join(ROOT, f), 'utf8')); };
  for (const f of SETUP_SQL) await run(f);
  console.log(`✓ Kurulum SQL'leri çalıştı (${SETUP_SQL.length} dosya)`);

  /** Belirli bir kullanıcı gibi (JWT'li authenticated) sorgu at. */
  const asUser = async (uid, sql, params = []) => {
    const c = new Client(conn);
    await c.connect();
    await c.query('SET ROLE authenticated');
    await c.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [uid]);
    try {
      return { ok: true, res: await c.query(sql, params) };
    } catch (e) {
      return { ok: false, err: e };
    } finally {
      await c.end();
    }
  };

  /** RLS'i atlayan service_role gibi sorgu at (GitHub Actions job'ları). */
  const asServiceRole = async (sql, params = []) => {
    const c = new Client(conn);
    await c.connect();
    await c.query('SET ROLE service_role');
    try {
      return { ok: true, res: await c.query(sql, params) };
    } catch (e) {
      return { ok: false, err: e };
    } finally {
      await c.end();
    }
  };

  /* ------------------------------------------------------------------ */
  console.log('\n=== 1. Migrasyonun hata yolları ===');
  await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_A}','a@x.com'), ('${USER_B}','b@x.com')`);
  try {
    await run(MIGRATION);
    t('2 kullanıcı varken BİLEREK durur (kim kime ait otomatik karar vermez)', false, 'hata vermedi');
  } catch (e) {
    t('2 kullanıcı varken BİLEREK durur', /otomatik atanamaz|1b\. ELLE ATAMA/.test(e.message), e.message);
  }

  await admin.query('DELETE FROM auth.users');
  try {
    await run(MIGRATION);
    t('auth.users boş + veri varken yol gösterir', false, 'hata vermedi');
  } catch (e) {
    t('auth.users boş + veri varken "önce hesap oluşturun" der', /hesabınızı oluşturun/.test(e.message), e.message);
  }

  console.log('\n=== 2. Mutlu yol: tek kullanıcı + mevcut veri ===');
  await admin.query(`INSERT INTO auth.users (id, email) VALUES ('${USER_A}','a@x.com')`);
  try {
    await run(MIGRATION);
    t('migrasyon başarılı (8 seed pozisyonu A\'ya atandı)', true);
  } catch (e) {
    t('migrasyon başarılı', false, e.message);
  }
  for (const n of [2, 3]) {
    try {
      await run(MIGRATION);
      t(`idempotent — ${n}. koşu da başarılı`, true);
    } catch (e) {
      t(`idempotent — ${n}. koşu da başarılı`, false, e.message);
    }
  }

  console.log('\n=== 3. Politika denetimi (pg_policies) ===');
  const pol = await admin.query(
    `SELECT tablename, policyname, qual, with_check FROM pg_policies WHERE schemaname='public'`
  );
  const weak = pol.rows.filter((r) => /IS NOT NULL/i.test(`${r.qual ?? ''}${r.with_check ?? ''}`));
  t('zayıf (auth.uid() IS NOT NULL) politika kalmadı', weak.length === 0, JSON.stringify(weak));
  const notOwner = pol.rows.filter((r) => r.qual && !/auth\.uid\(\) = user_id/.test(r.qual));
  t('tüm USING koşulları auth.uid() = user_id', notOwner.length === 0, JSON.stringify(notOwner));
  console.log(`        (${pol.rows.length} politika denetlendi)`);

  console.log('\n=== 4. Sahip kendi verisini görür ===');
  let r = await asUser(USER_A, 'SELECT symbol FROM portfolio_positions');
  t('A seed portföyü okuyor (8 satır)', r.ok && r.res.rowCount === 8, r.ok ? `${r.res.rowCount} satır` : r.err.message);

  console.log('\n=== 5. Başka kullanıcı HİÇBİR tabloyu göremez ===');
  await admin.query(`INSERT INTO auth.users (id,email) VALUES ('${USER_B}','b@x.com') ON CONFLICT DO NOTHING`);
  for (const [label, table] of [
    ['portföy', 'portfolio_positions'], ['kasa', 'cash_ledger'], ['işlemler', 'transactions'],
    ['kararlar', 'execution_decisions'], ['tahminler', 'social_predictions'],
    ['ayarlar', 'app_settings'], ['fon içeriği', 'fund_holdings'], ['fon geçmişi', 'fund_holdings_history'],
  ]) {
    r = await asUser(USER_B, `SELECT * FROM ${table}`);
    t(`B ${label} okuyamıyor (0 satır)`, r.ok && r.res.rowCount === 0, r.ok ? `${r.res.rowCount} satır SIZDI` : r.err.message);
  }

  console.log('\n=== 6. Başkasının satırı silinemez / değiştirilemez ===');
  r = await asUser(USER_B, `DELETE FROM portfolio_positions WHERE symbol='BURCE'`);
  t('B silme 0 satır etkiledi', r.ok && r.res.rowCount === 0, r.ok ? `${r.res.rowCount} satır SİLİNDİ` : '');
  r = await asUser(USER_B, `UPDATE portfolio_positions SET quantity=1 WHERE symbol='BURCE'`);
  t('B güncelleme 0 satır etkiledi', r.ok && r.res.rowCount === 0, r.ok ? `${r.res.rowCount} satır DEĞİŞTİ` : '');
  r = await asUser(USER_A, `SELECT quantity FROM portfolio_positions WHERE symbol='BURCE'`);
  t("A'nın verisi bozulmadı (3938)", r.ok && Number(r.res.rows[0].quantity) === 3938, r.ok ? String(r.res.rows[0].quantity) : '');

  console.log('\n=== 7. DEFAULT auth.uid() — user_id göndermeden insert ===');
  r = await asUser(USER_B, `INSERT INTO portfolio_positions (symbol, asset_name, asset_type, quantity, unit_cost)
    VALUES ('THYAO','THY','BIST_HISSE',10,100) RETURNING user_id::text`);
  t('user_id otomatik B oldu', r.ok && r.res.rows[0].user_id === USER_B, r.ok ? r.res.rows[0].user_id : r.err.message);

  console.log('\n=== 8. WITH CHECK — başkası adına yazılamaz ===');
  r = await asUser(USER_B, `INSERT INTO portfolio_positions (user_id, symbol, asset_name, asset_type, quantity, unit_cost)
    VALUES ('${USER_A}','GARAN','G','BIST_HISSE',1,1)`);
  t("B, A adına yazamıyor (RLS reddi)", !r.ok && /row-level security/.test(r.err.message), r.ok ? 'YAZABİLDİ' : r.err.message);

  console.log('\n=== 9. Bileşik tekil kısıt: aynı sembol iki kullanıcıda ===');
  r = await asUser(USER_A, `INSERT INTO portfolio_positions (symbol, asset_name, asset_type, quantity, unit_cost)
    VALUES ('THYAO','THY','BIST_HISSE',5,100)`);
  t('A da THYAO tutabiliyor (çakışma yok)', r.ok, r.ok ? '' : r.err.message);
  const cnt = await admin.query(`SELECT count(*) c FROM portfolio_positions WHERE symbol='THYAO'`);
  t('THYAO 2 ayrı satır (A + B)', Number(cnt.rows[0].c) === 2, String(cnt.rows[0].c));

  console.log("\n=== 10. repo.ts'in onConflict hedefi (user_id,symbol) çalışıyor ===");
  r = await asUser(USER_B, `INSERT INTO portfolio_positions (symbol, asset_name, asset_type, quantity, unit_cost)
    VALUES ('THYAO','THY','BIST_HISSE',99,100)
    ON CONFLICT (user_id, symbol) DO UPDATE SET quantity=EXCLUDED.quantity RETURNING quantity`);
  t('B upsert kendi satırını 99 yaptı', r.ok && Number(r.res.rows[0].quantity) === 99, r.ok ? String(r.res.rows[0].quantity) : r.err.message);
  r = await asUser(USER_A, `SELECT quantity FROM portfolio_positions WHERE symbol='THYAO'`);
  t("A'nın THYAO satırı etkilenmedi (5)", r.ok && Number(r.res.rows[0].quantity) === 5, r.ok ? String(r.res.rows[0].quantity) : '');

  console.log('\n=== 11. app_settings bileşik PK ===');
  r = await asUser(USER_B, `INSERT INTO app_settings (key, value) VALUES ('initial_capital','100000')`);
  t('B kendi initial_capital anahtarını yazabiliyor', r.ok, r.ok ? '' : r.err.message);
  const s = await admin.query(`SELECT count(*) c FROM app_settings WHERE key='initial_capital'`);
  t("app_settings'te 2 ayrı satır", Number(s.rows[0].c) === 2, String(s.rows[0].c));

  console.log('\n=== 12. fund_holdings + history tetikleyicisi user_id taşıyor ===');
  r = await asUser(USER_A, `INSERT INTO fund_holdings (fund_code, ticker, weight_pct, as_of_date, source)
    VALUES ('TLY','OZATD',34.27,'2026-07-31','auto') RETURNING user_id::text`);
  t('fund_holdings insert + user_id otomatik', r.ok && r.res.rows[0].user_id === USER_A, r.ok ? '' : r.err.message);
  const h = await admin.query(`SELECT user_id::text u FROM fund_holdings_history ORDER BY snapshot_at DESC LIMIT 1`);
  t('history tetikleyicisi user_id taşıdı', h.rowCount === 1 && h.rows[0].u === USER_A, h.rowCount ? h.rows[0].u : 'satır yok');

  console.log('\n=== 13. service_role (GitHub Actions) user_id göndermek ZORUNDA ===');
  r = await asServiceRole(`INSERT INTO social_predictions (predictor_handle, fund_code, prediction_date)
    VALUES ('@x','TLY','2026-09-01')`);
  t('user_id olmadan REDDEDİLİR (auth.uid() NULL → NOT NULL ihlali)',
    !r.ok && /null value in column "user_id"/.test(r.err.message), r.ok ? 'YAZABİLDİ' : r.err.message);
  r = await asServiceRole(`INSERT INTO social_predictions (user_id, predictor_handle, fund_code, prediction_date)
    VALUES ('${USER_A}','@x','TLY','2026-09-01') RETURNING id`);
  t('açık user_id ile service_role yazabiliyor', r.ok, r.ok ? '' : r.err.message);

  console.log('\n=== 14. Oturumsuz (anon) hiçbir şey okuyamaz ===');
  r = await (async () => {
    const c = new Client(conn);
    await c.connect();
    await c.query('SET ROLE anon');
    try { return { ok: true, res: await c.query('SELECT * FROM portfolio_positions') }; }
    catch (e) { return { ok: false, err: e }; }
    finally { await c.end(); }
  })();
  t('anon 0 satır görüyor', r.ok && r.res.rowCount === 0, r.ok ? `${r.res.rowCount} satır SIZDI` : '');

  await admin.end();
  exitCode = fail > 0 ? 1 : 0;
} finally {
  await pg.stop();
  rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(`\n${'='.repeat(64)}`);
console.log(`RLS DOĞRULAMA SONUCU: ${pass} geçti, ${fail} kaldı`);
console.log('='.repeat(64));
process.exit(exitCode);
