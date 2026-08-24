-- ==============================================================================
-- YATIRIM TERMİNALİ v3.0 — SUPABASE VERİTABANI ŞEMASI (RLS GÜVENLİK DAHİL)
-- ==============================================================================

-- 1. TABLOLARI OLUŞTUR
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
    amount NUMERIC(18, 4) NOT NULL,
    balance_after NUMERIC(18, 4) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    symbol VARCHAR(20) NOT NULL,
    transaction_type VARCHAR(20) NOT NULL,
    quantity NUMERIC(18, 4) NOT NULL,
    unit_price NUMERIC(18, 4) NOT NULL,
    total_amount NUMERIC(18, 4) NOT NULL,
    withholding_tax NUMERIC(18, 4) DEFAULT 0,
    net_amount NUMERIC(18, 4) NOT NULL,
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

-- ==============================================================================
-- 2. GÜVENLİK (ROW LEVEL SECURITY - RLS) ETKİNLEŞTİRME
-- ==============================================================================

ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_predictions ENABLE ROW LEVEL SECURITY;

-- 3. ERİŞİM İZİNLERİ (POLICIES) — Web sitenizin verileri okuyup yazabilmesi için:
DROP POLICY IF EXISTS "Public Access Portfolio" ON portfolio_positions;
CREATE POLICY "Public Access Portfolio" ON portfolio_positions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Access Cash" ON cash_ledger;
CREATE POLICY "Public Access Cash" ON cash_ledger FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Access Transactions" ON transactions;
CREATE POLICY "Public Access Transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Access Decisions" ON execution_decisions;
CREATE POLICY "Public Access Decisions" ON execution_decisions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Access Predictions" ON social_predictions;
CREATE POLICY "Public Access Predictions" ON social_predictions FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- 4. BAŞLANGIÇ VERİLERİNİ YÜKLE
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
('kr3', 'KGM', 'TUT (25.000 Pay)', 'bekliyor', 3.40, 2.60, 7, 'Gümüş yoğunluğu azaltıldı, stop 2.60.')
ON CONFLICT (id) DO NOTHING;
