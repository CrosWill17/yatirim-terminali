-- =============================================================================
-- YATIRIM TERMİNALİ — KULLANICI YALITIMI (RLS v3)
--
-- SORUN: Önceki politikalarda koşul `auth.uid() IS NOT NULL` idi. Bu "giriş
--        yapmış HERHANGİ BİRİ" demektir — yalıtım değil. Site herkese açık
--        olduğu için hesap açan herkes tüm portföyü okuyup silebiliyordu.
--
-- ÇÖZÜM: Her tabloya `user_id` eklenir, politikalar `auth.uid() = user_id`
--        olur, tekil kısıtlar kullanıcı bazlı bileşiğe çevrilir.
--
-- Kurulum: supabase.com → SQL Editor → bu dosyanın tamamını çalıştırın.
-- İDİMPOTENT: tekrar çalıştırmak güvenlidir.
--
-- ⚠️  MEVCUT VERİ: Tablolarda veri varsa ve auth.users'ta TEK kullanıcı varsa
--     o kullanıcıya atanır. BİRDEN FAZLA kullanıcı varsa script BİLEREK HATA
--     VERİR — hangi satırın kime ait olduğuna otomatik karar vermez.
--     O durumda aşağıdaki "ELLE ATAMA" bloğunu düzenleyip tekrar çalıştırın.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. ÖN KONTROL — birden fazla kullanıcı varsa dur
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_users INT;
BEGIN
  SELECT count(*) INTO n_users FROM auth.users;
  IF n_users > 1 THEN
    RAISE EXCEPTION
      'auth.users içinde % kullanıcı var; mevcut satırlar otomatik atanamaz. '
      'Dosyadaki "1b. ELLE ATAMA" bloğunu düzenleyip tekrar çalıştırın.', n_users;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. user_id SÜTUNLARI (önce nullable — backfill'den sonra NOT NULL yapılır)
-- -----------------------------------------------------------------------------
ALTER TABLE portfolio_positions   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE cash_ledger           ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE transactions          ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE execution_decisions   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE social_predictions    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE app_settings          ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE portfolio_snapshots   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE fund_holdings         ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE fund_holdings_history ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE calibration_log       ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE fund_holding_proposals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- 1b. ELLE ATAMA (yalnızca 0. adımdaki hata geldiyse)
--     Aşağıdaki satırın yorumunu kaldırıp kendi auth.users.id'nizi yazın:
--
-- UPDATE portfolio_positions   SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE cash_ledger           SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE transactions          SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE execution_decisions   SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE social_predictions    SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE app_settings          SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE portfolio_snapshots   SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE fund_holdings         SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE fund_holdings_history SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE calibration_log       SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- UPDATE fund_holding_proposals SET user_id = '00000000-0000-0000-0000-000000000000' WHERE user_id IS NULL;
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 1c. BACKFILL — tek kullanıcı varsa tüm yetim satırlar ona atanır
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  owner UUID;
BEGIN
  SELECT id INTO owner FROM auth.users ORDER BY created_at LIMIT 1;
  IF owner IS NULL THEN
    RAISE NOTICE 'auth.users boş — backfill atlandı (temiz kurulum).';
    RETURN;
  END IF;

  UPDATE portfolio_positions    SET user_id = owner WHERE user_id IS NULL;
  UPDATE cash_ledger            SET user_id = owner WHERE user_id IS NULL;
  UPDATE transactions           SET user_id = owner WHERE user_id IS NULL;
  UPDATE execution_decisions    SET user_id = owner WHERE user_id IS NULL;
  UPDATE social_predictions     SET user_id = owner WHERE user_id IS NULL;
  UPDATE app_settings           SET user_id = owner WHERE user_id IS NULL;
  UPDATE portfolio_snapshots    SET user_id = owner WHERE user_id IS NULL;
  UPDATE fund_holdings          SET user_id = owner WHERE user_id IS NULL;
  UPDATE fund_holdings_history  SET user_id = owner WHERE user_id IS NULL;
  UPDATE calibration_log        SET user_id = owner WHERE user_id IS NULL;
  UPDATE fund_holding_proposals SET user_id = owner WHERE user_id IS NULL;

  RAISE NOTICE 'Backfill tamam: tüm yetim satırlar % kullanıcısına atandı.', owner;
END $$;

-- -----------------------------------------------------------------------------
-- 1d. GÜVENLİK AĞI — hâlâ NULL satır varsa NOT NULL'a geçme, DUR
--
--     En sık yaşanan durum: supabase_schema.sql'i çalıştırdınız (o dosya 8
--     satır yerleşik portföy INSERT eder) ama henüz HİÇ hesap açmadınız, yani
--     auth.users boş → backfill'in atayacağı kimse yok.
--     Çözüm: önce terminalden hesabınızı oluşturun, sonra bu dosyayı tekrar
--     çalıştırın. Bu dosya idempotent'tir, baştan koşmak güvenlidir.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  n_users INT;
  t TEXT;
  n BIGINT;
  orphans BIGINT := 0;
BEGIN
  SELECT count(*) INTO n_users FROM auth.users;

  FOREACH t IN ARRAY ARRAY[
    'portfolio_positions','cash_ledger','transactions','execution_decisions',
    'social_predictions','app_settings','portfolio_snapshots','fund_holdings',
    'fund_holdings_history','calibration_log','fund_holding_proposals'
  ]
  LOOP
    EXECUTE format('SELECT count(*) FROM public.%I WHERE user_id IS NULL', t) INTO n;
    orphans := orphans + n;
  END LOOP;

  IF orphans > 0 AND n_users = 0 THEN
    RAISE EXCEPTION
      'auth.users BOŞ ama tablolarda % yetim satır var. '
      'Önce terminalden hesabınızı oluşturun (⚙️ Ayarlar & DB → Hesap Oluştur), '
      'sonra bu dosyayı TEKRAR çalıştırın — idempotent olduğu için güvenlidir.', orphans;
  ELSIF orphans > 0 THEN
    RAISE EXCEPTION
      '% satırın user_id''si hâlâ NULL. "1b. ELLE ATAMA" bloğunu doldurun.', orphans;
  END IF;
END $$;

ALTER TABLE portfolio_positions    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE cash_ledger            ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE execution_decisions    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE social_predictions     ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE app_settings           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE portfolio_snapshots    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holdings          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holdings_history  ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE calibration_log        ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holding_proposals ALTER COLUMN user_id SET NOT NULL;

-- -----------------------------------------------------------------------------
-- 1e. DEFAULT auth.uid() — tarayıcı insert'lerinde user_id UNUTULSA BİLE
--     JWT'den otomatik dolar. WITH CHECK ile birlikte çift emniyet.
--
--     NOT: service_role ile yazan GitHub Actions job'larında auth.uid() NULL'dır;
--     o job'lar user_id'yi AÇIKÇA göndermek zorunda (SUPABASE_OWNER_USER_ID).
-- -----------------------------------------------------------------------------
ALTER TABLE portfolio_positions    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE cash_ledger            ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE transactions           ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE execution_decisions    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE social_predictions     ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE app_settings           ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE portfolio_snapshots    ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE fund_holdings          ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE fund_holding_proposals ALTER COLUMN user_id SET DEFAULT auth.uid();

-- -----------------------------------------------------------------------------
-- 2. TEKİL KISITLAR → KULLANICI BAZLI BİLEŞİK
--    (İki farklı kullanıcı aynı sembolü/anahtarı tutabilmeli.)
-- -----------------------------------------------------------------------------
ALTER TABLE portfolio_positions  DROP CONSTRAINT IF EXISTS portfolio_positions_symbol_key;
ALTER TABLE portfolio_positions  DROP CONSTRAINT IF EXISTS portfolio_positions_user_id_symbol_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_positions_user_symbol ON portfolio_positions (user_id, symbol);

ALTER TABLE app_settings         DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE app_settings         DROP CONSTRAINT IF EXISTS app_settings_key_key;

ALTER TABLE portfolio_snapshots  DROP CONSTRAINT IF EXISTS portfolio_snapshots_snapshot_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_snapshots_user_date ON portfolio_snapshots (user_id, snapshot_date);

ALTER TABLE execution_decisions  DROP CONSTRAINT IF EXISTS execution_decisions_pkey;

-- Bileşik PRIMARY KEY'ler koşulsuz eklenemez (2. koşuda "already exists").
-- Var mı diye bakıp yoksa ekle → gerçek idempotentlik.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.app_settings'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.app_settings ADD PRIMARY KEY (user_id, key);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.execution_decisions'::regclass AND contype = 'p'
  ) THEN
    ALTER TABLE public.execution_decisions ADD PRIMARY KEY (user_id, id);
  END IF;
END $$;

ALTER TABLE fund_holdings        DROP CONSTRAINT IF EXISTS fund_holdings_fund_code_ticker_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fund_holdings_user_fund_ticker ON fund_holdings (user_id, fund_code, ticker);

ALTER TABLE calibration_log      DROP CONSTRAINT IF EXISTS calibration_log_fund_code_cal_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_calibration_user_fund_date ON calibration_log (user_id, cal_date, fund_code);

ALTER TABLE fund_holding_proposals DROP CONSTRAINT IF EXISTS fund_holding_proposals_fund_code_ticker_source_tweet_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_user_fund_ticker_tweet
  ON fund_holding_proposals (user_id, fund_code, ticker, source_tweet_id);

-- Okuma yolları artık her zaman user_id ile filtrelenir → indeks şart
CREATE INDEX IF NOT EXISTS idx_positions_user      ON portfolio_positions   (user_id);
CREATE INDEX IF NOT EXISTS idx_cash_user           ON cash_ledger           (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_user            ON transactions          (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_user      ON execution_decisions   (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_predictions_user    ON social_predictions    (user_id, prediction_date DESC);
CREATE INDEX IF NOT EXISTS idx_fund_holdings_user  ON fund_holdings         (user_id, fund_code);

-- -----------------------------------------------------------------------------
-- 3. RLS POLİTİKALARI — auth.uid() = user_id
-- -----------------------------------------------------------------------------
ALTER TABLE portfolio_positions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_decisions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_predictions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_holdings          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_holdings_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_holding_proposals ENABLE ROW LEVEL SECURITY;

-- Eski (zayıf) politikaları kaldır
DROP POLICY IF EXISTS "Auth Portfolio"      ON portfolio_positions;
DROP POLICY IF EXISTS "Auth Cash"           ON cash_ledger;
DROP POLICY IF EXISTS "Auth Transactions"   ON transactions;
DROP POLICY IF EXISTS "Auth Decisions"      ON execution_decisions;
DROP POLICY IF EXISTS "Auth Predictions"    ON social_predictions;
DROP POLICY IF EXISTS "Auth Settings"       ON app_settings;
DROP POLICY IF EXISTS "Auth Snapshots"      ON portfolio_snapshots;
DROP POLICY IF EXISTS "Auth FundHoldings"   ON fund_holdings;
DROP POLICY IF EXISTS "Auth FundHist"       ON fund_holdings_history;
DROP POLICY IF EXISTS "Auth Calibration"    ON calibration_log;
DROP POLICY IF EXISTS "Auth FundProposals"  ON fund_holding_proposals;
DROP POLICY IF EXISTS "Public Access Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Public Access Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Public Access Transactions" ON transactions;
DROP POLICY IF EXISTS "Public Access Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Public Access Predictions"  ON social_predictions;

-- Kendi politikalarımızı da düşür — aksi hâlde 2. koşuda
-- "policy ... already exists" hatası verir (idempotent'lik şart).
DROP POLICY IF EXISTS "Owner Portfolio"      ON portfolio_positions;
DROP POLICY IF EXISTS "Owner Cash"           ON cash_ledger;
DROP POLICY IF EXISTS "Owner Transactions"   ON transactions;
DROP POLICY IF EXISTS "Owner Decisions"      ON execution_decisions;
DROP POLICY IF EXISTS "Owner Predictions"    ON social_predictions;
DROP POLICY IF EXISTS "Owner Settings"       ON app_settings;
DROP POLICY IF EXISTS "Owner Snapshots"      ON portfolio_snapshots;
DROP POLICY IF EXISTS "Owner FundHoldings"   ON fund_holdings;
DROP POLICY IF EXISTS "Owner Calibration"    ON calibration_log;
DROP POLICY IF EXISTS "Owner FundProposals"  ON fund_holding_proposals;
DROP POLICY IF EXISTS "Owner FundHist Read"  ON fund_holdings_history;

-- Yeni politikalar: SAHİP OKUR/YAZAR
CREATE POLICY "Owner Portfolio"     ON portfolio_positions    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Cash"          ON cash_ledger            FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Transactions"  ON transactions           FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Decisions"     ON execution_decisions    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Predictions"   ON social_predictions     FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Settings"      ON app_settings           FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Snapshots"     ON portfolio_snapshots    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner FundHoldings"  ON fund_holdings          FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner Calibration"   ON calibration_log        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Owner FundProposals" ON fund_holding_proposals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- fund_holdings_history: kullanıcı kendi geçmişini okur; YAZMAYI yalnızca
-- tetikleyici yapar (aşağıda SECURITY DEFINER), o yüzden INSERT politikası yok.
DROP POLICY IF EXISTS "Owner FundHist Read" ON fund_holdings_history;
CREATE POLICY "Owner FundHist Read" ON fund_holdings_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 4. HISTORY TETİKLEYİCİSİ — user_id'yi de taşır
--    SECURITY DEFINER: tetikleyici tablo sahibi olarak çalışır, böylece
--    history'ye yazarken çağıranın INSERT politikasına takılmaz.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_fund_holdings_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.fund_holdings_history
    (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source)
  VALUES
    (NEW.user_id, NEW.fund_code, NEW.ticker, NEW.company_name, NEW.weight_pct, NEW.as_of_date, NEW.source);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fund_holdings_history_trg ON fund_holdings;
CREATE TRIGGER fund_holdings_history_trg
  AFTER INSERT OR UPDATE ON fund_holdings
  FOR EACH ROW EXECUTE FUNCTION trg_fund_holdings_history();

-- -----------------------------------------------------------------------------
-- 5. DOĞRULAMA — çalıştırdıktan sonra bu çıktıyı kontrol edin
-- -----------------------------------------------------------------------------
-- SELECT tablename, policyname, qual
--   FROM pg_policies
--  WHERE schemaname = 'public'
--  ORDER BY tablename;
--
-- Beklenen: her tabloda `((auth.uid() = user_id))` koşulu.
-- `auth.uid() IS NOT NULL` içeren HİÇBİR politika kalmamalı:
-- SELECT tablename, policyname FROM pg_policies
--  WHERE schemaname = 'public' AND qual ILIKE '%IS NOT NULL%';
