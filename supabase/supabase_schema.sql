-- ==============================================================================
-- YATIRIM TERMİNALİ v3.4 — SUPABASE VERİTABANI ŞEMASI (v3 — KULLANICI YALITIMLI RLS)
--
-- Kurulum (sıfırdan):
--   1. supabase.com → yeni proje → SQL Editor → bu dosyanın tamamını çalıştır.
--   2. Daha sonra sırasıyla şunları da çalıştırın (idempotent migration'lar):
--        supabase/supabase_twitter_migration.sql
--        supabase/supabase_fund_holdings_migration.sql
--        supabase/supabase_fund_proposals_migration.sql
--   3. Authentication → Providers → Email AÇIK.
--      (Kişisel terminal için "Confirm email" KAPALI önerilir.)
--   4. Project Settings → API → URL ve anon key'i .env'e yazın:
--        NEXT_PUBLIC_SUPABASE_URL=...
--        NEXT_PUBLIC_SUPABASE_ANON_KEY=...
--   5. Terminali açın → ⚙️ Ayarlar sekmesinden giriş yapın.
--      İlk oturumda yerleşik portföy SUNUCUDAN otomatik aktarılır (bu dosyada seed YOK).
--
-- GÜVENLİK (v3): Her tabloda user_id sütunu vardır ve RLS politikaları
--   auth.uid() = user_id  kuralını uygular. Böylece oturum açmış bir kullanıcı
--   YALNIZCA kendi satırlarını görür/yazar. (v2'deki "auth.uid() IS NOT NULL"
--   herkes-herkese davranışını engeller.)
--
-- MEVCUT v2 KURULUMUNDAN YÜKSELTME:
--   supabase/supabase_user_isolation_migration.sql dosyasını çalıştırın.
-- ==============================================================================

-- 1. TABLOLAR
CREATE TABLE IF NOT EXISTS portfolio_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    symbol VARCHAR(20) NOT NULL,
    asset_name VARCHAR(100) NOT NULL,
    asset_type VARCHAR(30) NOT NULL,
    quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
    target_price NUMERIC(18, 4),
    stop_price NUMERIC(18, 4),
    risk_score INT,
    current_action VARCHAR(50) DEFAULT 'TUT',
    rationale TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS cash_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    movement_type VARCHAR(30) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    balance_after NUMERIC(18, 4) NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    symbol VARCHAR(20) NOT NULL,
    transaction_type VARCHAR(20) NOT NULL,
    quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
    unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    withholding_tax NUMERIC(18, 4) DEFAULT 0,
    net_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    realized_pnl NUMERIC(18, 4) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS execution_decisions (
    user_id UUID NOT NULL REFERENCES auth.users(id),
    id VARCHAR(50) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'bekliyor',
    target_price NUMERIC(18, 4),
    stop_price NUMERIC(18, 4),
    risk_score INT,
    details TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS social_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    predictor_handle VARCHAR(100) NOT NULL,
    fund_code VARCHAR(20) NOT NULL,
    -- NULL = sayı çözülemedi (VERİ EKSİK) — uydurma yok.
    predicted_return_pct NUMERIC(8, 4),
    prediction_category VARCHAR(50),
    raw_text TEXT,
    prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    actual_return_pct NUMERIC(8, 4),
    accuracy_score NUMERIC(5, 2),
    status VARCHAR(30) DEFAULT 'BEKLIYOR',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Uygulama ayarları (kullanıcı başına: başlangıç anaparası, güven skoru vb.)
CREATE TABLE IF NOT EXISTS app_settings (
    user_id UUID NOT NULL REFERENCES auth.users(id),
    key VARCHAR(40) NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
);

-- Günlük portföy snapshot (grafikler için zaman serisi biriktirir)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    snapshot_date DATE NOT NULL,
    total_value NUMERIC(18, 2) NOT NULL,
    cash_balance NUMERIC(18, 2) NOT NULL,
    breakdown JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, snapshot_date)
);

-- ==============================================================================
-- 2. GÜVENLİK — RLS: KULLANICI YALNIZCA KENDİ SATIRLARINI GÖRÜR/YAZAR
-- ==============================================================================
ALTER TABLE portfolio_positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_decisions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_predictions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots  ENABLE ROW LEVEL SECURITY;

-- Eski politika adlarını temizle (tekrar çalıştırılabilirlik için)
DROP POLICY IF EXISTS "Public Access Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Public Access Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Public Access Transactions" ON transactions;
DROP POLICY IF EXISTS "Public Access Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Public Access Predictions"  ON social_predictions;
DROP POLICY IF EXISTS "Auth Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Auth Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Auth Transactions" ON transactions;
DROP POLICY IF EXISTS "Auth Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Auth Predictions"  ON social_predictions;
DROP POLICY IF EXISTS "Auth Settings"     ON app_settings;
DROP POLICY IF EXISTS "Auth Snapshots"    ON portfolio_snapshots;

-- Kullanıcı yalıtımı: auth.uid() = user_id
CREATE POLICY "Auth Portfolio"    ON portfolio_positions  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Cash"         ON cash_ledger          FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Transactions" ON transactions         FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Decisions"    ON execution_decisions  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Predictions"  ON social_predictions   FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Settings"     ON app_settings         FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Auth Snapshots"    ON portfolio_snapshots  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ==============================================================================
-- 3. BAŞLANGIÇ VERİLERİ — YOK.
--    Yerleşik portföy, kasa ve kararlar uygulama tarafından İLK oturum açılışında
--    sunucudan (/api/seed) oturum doğrulanarak yazılır. Her satır o kullanıcının
--    user_id'si ile oluşur; bu yüzden SQL'de statik seed tutmak artık doğru olmaz.
-- ==============================================================================
