-- ==============================================================================
-- YATIRIM TERMİNALİ v3.1 — SUPABASE VERİTABANI ŞEMASI (v2 — AUTH GÜVENCELİ RLS)
--
-- Kurulum:
--   1. supabase.com → yeni proje → SQL Editor → bu dosyanın tamamını çalıştır.
--   2. Authentication → Providers → Email AÇIK.
--      (Kişisel terminal için "Confirm email" KAPALI önerilir; açık bırakırsanız
--       terminaldeki "Hesap Oluştur" sonrası e-postanızdaki onay linkine tıklayın.)
--   3. Project Settings → API → URL ve anon key'i .env'e yazın:
--        NEXT_PUBLIC_SUPABASE_URL=...
--        NEXT_PUBLIC_SUPABASE_ANON_KEY=...
--   4. Terminali açın → ⚙️ Ayarlar sekmesinden giriş yapın.
--      İlk oturum açılışında yerleşik portföyünüz otomatik olarak DB'ye aktarılır.
-- ==============================================================================

-- 1. TABLOLAR
CREATE TABLE IF NOT EXISTS portfolio_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    asset_name VARCHAR(100) NOT NULL,
    asset_type VARCHAR(30) NOT NULL,
    quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
    target_price NUMERIC(18, 4),
    stop_price NUMERIC(18, 4),
    risk_score INT,
    current_action VARCHAR(50) DEFAULT 'TUT',
    rationale TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movement_type VARCHAR(30) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
    balance_after NUMERIC(18, 4) NOT NULL DEFAULT 0,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id VARCHAR(50) PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'bekliyor',
    target_price NUMERIC(18, 4),
    stop_price NUMERIC(18, 4),
    risk_score INT,
    details TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS social_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    predictor_handle VARCHAR(100) NOT NULL,
    fund_code VARCHAR(20) NOT NULL,
    predicted_return_pct NUMERIC(8, 4) NOT NULL,
    prediction_category VARCHAR(50),
    raw_text TEXT,
    prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    actual_return_pct NUMERIC(8, 4),
    accuracy_score NUMERIC(5, 2),
    status VARCHAR(30) DEFAULT 'BEKLIYOR',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Uygulama ayarları (başlangıç anaparası vb. anahtar-değer)
CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(40) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Günlük portföy snapshot (grafikler için zaman serisi biriktirir)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL UNIQUE,
    total_value NUMERIC(18, 2) NOT NULL,
    cash_balance NUMERIC(18, 2) NOT NULL,
    breakdown JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 2. GÜVENLİK — RLS: SADECE OTURUM AÇMIŞ KULLANICI (auth.uid()) OKUYUP YAZABİLİR
-- ==============================================================================
ALTER TABLE portfolio_positions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger          ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_decisions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_predictions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_snapshots  ENABLE ROW LEVEL SECURITY;

-- Eski herkese-açık policy'leri kaldır (varsa)
DROP POLICY IF EXISTS "Public Access Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Public Access Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Public Access Transactions" ON transactions;
DROP POLICY IF EXISTS "Public Access Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Public Access Predictions"  ON social_predictions;

-- Önceki Auth policy'lerini temizle (tekrar çalıştırılabilirlik için)
DROP POLICY IF EXISTS "Auth Portfolio"    ON portfolio_positions;
DROP POLICY IF EXISTS "Auth Cash"         ON cash_ledger;
DROP POLICY IF EXISTS "Auth Transactions" ON transactions;
DROP POLICY IF EXISTS "Auth Decisions"    ON execution_decisions;
DROP POLICY IF EXISTS "Auth Predictions"  ON social_predictions;
DROP POLICY IF EXISTS "Auth Settings"     ON app_settings;
DROP POLICY IF EXISTS "Auth Snapshots"    ON portfolio_snapshots;

-- Authenticated kullanıcı policy'leri
CREATE POLICY "Auth Portfolio"    ON portfolio_positions  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Cash"         ON cash_ledger          FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Transactions" ON transactions         FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Decisions"    ON execution_decisions  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Predictions"  ON social_predictions   FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Settings"     ON app_settings         FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Snapshots"    ON portfolio_snapshots  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ==============================================================================
-- 3. BAŞLANGIÇ VERİLERİ
-- NOT: Terminal ilk oturum açılışında yerleşik portföyü otomatik aktarır;
-- bu INSERT'ler yalnızca manuel SQL ile hızlı kurulum için buradadır.
-- ==============================================================================
INSERT INTO portfolio_positions (symbol, asset_name, asset_type, quantity, unit_cost, target_price, stop_price, risk_score, current_action, rationale)
VALUES
('BURCE', 'Burçelik Vana', 'BIST_HISSE', 3938, 40.96, 53.40, 32.50, 10, 'KADEMELİ SAT', 'Zarar eden şirket, merdivenli çıkış.'),
('KGM', 'QNB Gümüş Fonu', 'TEFAS_FON', 25000, 2.99, 3.40, 2.60, 7, 'TUT', 'Gümüş yoğunluğu azaltıldı, stop 2.60.'),
('TLY', 'Tera Hisse Fonu', 'TEFAS_FON', 7, 6493, 9900, 7250, 9, '2/3 ÇIKIŞ', 'OZATD %34 yoğunlaşması var. 2/3 kâr al.'),
('DFI', 'Deniz Hisse Fonu', 'TEFAS_FON', 10400, 3.846, 6.10, 4.60, 9, 'TUT', 'Stop 4.60 korumalı.'),
('TP2', 'Tacirler PPF', 'PPF', 24197, 1.963, 2.20, 1.96, 1, 'TUT', 'Nakit park yeri (Faiz %37).'),
('MASFN', 'Master Finans', 'BIST_HISSE', 486, 45.68, 52.00, 39.50, 7, 'TUT', 'USD fonksiyonel para.'),
('SARAE', 'Saray Matbaa', 'BIST_HISSE', 211, 70.00, 90.00, 68.00, 8, 'TUT', '88-97 bandı kâr al.'),
('EKIM', 'Ekim Varlık', 'BIST_HISSE', 630, 30.26, 22.00, 18.37, 10, 'SAT', 'HBK negatif, stop 18.37.')
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO cash_ledger (movement_type, amount, balance_after, description)
VALUES ('BASLANGIC', 257706, 257706, 'Mevcut Kullanılabilir Serbest Nakit')
ON CONFLICT DO NOTHING;

INSERT INTO execution_decisions (id, symbol, action_type, status, target_price, stop_price, risk_score, details)
VALUES
('kr1', 'TLY', '2/3 ÇIKIŞ', 'onaylandi', 9900, 7250, 9, 'OZATD yoğunlaşması sebebiyle 2/3 kâr realizasyonu.'),
('kr2', 'BURCE', 'MERDİVENLİ SAT', 'bekliyor', 53.40, 32.50, 10, 'Zarar eden şirket riskini azaltmak için kademeli satış.'),
('kr3', 'KGM', 'TUT (25.000 Pay)', 'bekliyor', 3.40, 2.60, 7, 'Gümüş yoğunlaşması azaltıldı, kalan 25.000 pay stop 2.60 ile taşınıyor.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('initial_capital', '678000')
ON CONFLICT (key) DO NOTHING;
