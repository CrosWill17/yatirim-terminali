-- ==============================================================================
-- YATIRIM TERMİNALİ — KULLANICI YALITIMI YÜKSELTMESİ (v2 → v3)
--
-- NE YAPAR:
--   1. Tüm tablolara user_id sütunu ekler.
--   2. RLS politikalarını "auth.uid() IS NOT NULL" (herkes-herkese) yerine
--      "auth.uid() = user_id" (yalnızca kendi satırları) yapar.
--   3. Çok kullanıcıda çakışan global UNIQUE/PK kısıtlarını (symbol, snapshot_date,
--      fund_holdings anahtarı, karar id'si, app_settings anahtarı) kullanıcı bazlı
--      hale getirir.
--
-- ⚠️ UYGULAMA SIRASI (ÖNEMLİ):
--   ADIM 1 → bu dosyadaki "ADIM 1" bölümünü çalıştırın (sütun ekleme).
--   ADIM 2 → aşağıdaki backfill satırlarını kendi kullanıcı id'nizle doldurup çalıştırın.
--   ADIM 3 → bu dosyadaki "ADIM 3" bölümünü çalıştırın (kısıt + politika + NOT NULL).
--
-- Kendi user_id'nizi öğrenmek için (SQL Editor):
--   SELECT id, email FROM auth.users;
-- ==============================================================================

-- ==============================================================================
-- ADIM 1 — user_id sütunlarını ekle (nullable; önce backfill, sonra NOT NULL)
-- ==============================================================================
ALTER TABLE portfolio_positions  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE cash_ledger          ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE transactions         ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE execution_decisions  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE social_predictions   ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE app_settings         ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE portfolio_snapshots  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE fund_holdings        ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE fund_holdings_history ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE calibration_log      ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);
ALTER TABLE fund_holding_proposals ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ==============================================================================
-- ADIM 2 — BACKFILL (MEVCUT VERİYİ KENDİ KULLANICINIZA ATAYIN)
--
-- Aşağıdaki satırlardaki '<SENIN_USER_ID>' kısmını kendi user_id'nizle değiştirin
-- (SELECT id, email FROM auth.users; ile bulun), sonra çalıştırın.
-- ==============================================================================
-- UPDATE portfolio_positions  SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE cash_ledger          SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE transactions         SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE execution_decisions  SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE social_predictions   SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE app_settings         SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE portfolio_snapshots  SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE fund_holdings        SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE fund_holdings_history SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE calibration_log      SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;
-- UPDATE fund_holding_proposals SET user_id = '<SENIN_USER_ID>' WHERE user_id IS NULL;

-- ==============================================================================
-- ADIM 3 — KISIT DEĞİŞİMLERİ + POLİTİKALAR + NOT NULL
-- (Bu bölümü yalnızca ADIM 2 backfill TAMAMLANDIKTAN sonra çalıştırın;
--  aksi hâlde user_id NULL olduğu için PK/UNIQUE ekleme hatası alırsınız.)
-- ==============================================================================

-- 3a) Global benzersiz kısıtları kullanıcı bazlı yap
-- portfolio_positions: (symbol) → (user_id, symbol)
ALTER TABLE portfolio_positions DROP CONSTRAINT IF EXISTS portfolio_positions_symbol_key;
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_positions_user_symbol_key ON portfolio_positions (user_id, symbol);

-- execution_decisions: PK(id) → PK(user_id, id)
ALTER TABLE execution_decisions DROP CONSTRAINT IF EXISTS execution_decisions_pkey;
ALTER TABLE execution_decisions ADD PRIMARY KEY (user_id, id);

-- app_settings: PK(key) → PK(user_id, key)
ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
ALTER TABLE app_settings ADD PRIMARY KEY (user_id, key);

-- portfolio_snapshots: (snapshot_date) → (user_id, snapshot_date)
ALTER TABLE portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_snapshot_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_user_date_key ON portfolio_snapshots (user_id, snapshot_date);

-- fund_holdings: (fund_code, ticker) → (user_id, fund_code, ticker)
ALTER TABLE fund_holdings DROP CONSTRAINT IF EXISTS fund_holdings_fund_code_ticker_key;
CREATE UNIQUE INDEX IF NOT EXISTS fund_holdings_user_fund_ticker_key ON fund_holdings (user_id, fund_code, ticker);

-- calibration_log: (fund_code, cal_date) → (user_id, fund_code, cal_date)
ALTER TABLE calibration_log DROP CONSTRAINT IF EXISTS calibration_log_fund_code_cal_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS calibration_log_user_fund_date_key ON calibration_log (user_id, fund_code, cal_date);

-- fund_holding_proposals: (fund_code, ticker, source_tweet_id) → kullanıcı bazlı
ALTER TABLE fund_holding_proposals DROP CONSTRAINT IF EXISTS fund_holding_proposals_fund_code_ticker_source_tweet_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS fund_holding_proposals_user_key ON fund_holding_proposals (user_id, fund_code, ticker, source_tweet_id);

-- social_predictions: source_tweet_id tekil indeksi kullanıcı bazlı
DROP INDEX IF EXISTS idx_social_predictions_source_tweet;
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_predictions_source_tweet
  ON social_predictions (user_id, source_tweet_id)
  WHERE source_tweet_id IS NOT NULL;

-- 3b) user_id sütunlarını NOT NULL yap
ALTER TABLE portfolio_positions   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE cash_ledger           ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE transactions          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE execution_decisions   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE social_predictions    ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE app_settings          ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE portfolio_snapshots   ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holdings         ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holdings_history ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE calibration_log       ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE fund_holding_proposals ALTER COLUMN user_id SET NOT NULL;

-- 3c) RLS politikalarını kullanıcı yalıtımlı yap
DROP POLICY IF EXISTS "Auth Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Auth Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Auth Transactions" ON transactions;
DROP POLICY IF EXISTS "Auth Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Auth Predictions"  ON social_predictions;
DROP POLICY IF EXISTS "Auth Settings"     ON app_settings;
DROP POLICY IF EXISTS "Auth Snapshots"    ON portfolio_snapshots;
DROP POLICY IF EXISTS "Auth FundHoldings" ON fund_holdings;
DROP POLICY IF EXISTS "Auth FundHist"     ON fund_holdings_history;
DROP POLICY IF EXISTS "Auth Calibration"  ON calibration_log;
DROP POLICY IF EXISTS "Auth FundProposals" ON fund_holding_proposals;

CREATE POLICY "Auth Portfolio"    ON portfolio_positions  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Cash"         ON cash_ledger          FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Transactions" ON transactions         FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Decisions"    ON execution_decisions  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Predictions"  ON social_predictions   FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Settings"     ON app_settings         FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Snapshots"    ON portfolio_snapshots  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth FundHoldings" ON fund_holdings        FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth FundHist"     ON fund_holdings_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Calibration"  ON calibration_log      FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth FundProposals" ON fund_holding_proposals FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3d) Tetikleyici (fund_holdings → history) user_id'yi de kopyalasın (varsa eski tetikleyiciyi güncelle)
CREATE OR REPLACE FUNCTION public.trg_fund_holdings_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.fund_holdings_history (user_id, fund_code, ticker, company_name, weight_pct, as_of_date, source)
  VALUES (NEW.user_id, NEW.fund_code, NEW.ticker, NEW.company_name, NEW.weight_pct, NEW.as_of_date, NEW.source);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
