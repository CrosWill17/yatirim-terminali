-- Gölge Portföy (Shadow Portfolio) — Modül 1 & 2 için tablolar
-- Vercel Cron her sabah 09:30 kalibrasyon yapar, canlı hesaplama istek üzerine

-- 1) TEFAS gerçek getirileri (G_gercek)
CREATE TABLE IF NOT EXISTS tefas_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code text NOT NULL,
  date date NOT NULL,
  return_pct numeric NOT NULL, -- günlük getiri %, örn. 1.23
  nav_price numeric,
  source text NOT NULL DEFAULT 'tefas' CHECK (source IN ('tefas','fintables','fallback')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(fund_code, date)
);

-- 2) Kalibrasyon logu — her günün Δ, güven, turnover, yeni ağırlıklar
CREATE TABLE IF NOT EXISTS calibration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code text NOT NULL,
  calibration_date date NOT NULL, -- sabah kalibrasyon tarihi (bugün)
  yesterday_date date NOT NULL, -- dünün tarihi (TEFAS getirisi)
  old_predicted_return_pct numeric NOT NULL,
  actual_return_pct numeric NOT NULL,
  delta_pct numeric NOT NULL,
  explained_delta_pct numeric NOT NULL,
  residual_delta_pct numeric NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >=0 AND confidence <=1),
  total_turnover_pct numeric NOT NULL,
  new_weights jsonb NOT NULL, -- FundWeight[]
  adjustments jsonb NOT NULL, -- WeightAdjustment[]
  notes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  UNIQUE(fund_code, calibration_date)
);

-- Indexler
CREATE INDEX IF NOT EXISTS idx_tefas_returns_fund_date ON tefas_returns(fund_code, date DESC);
CREATE INDEX IF NOT EXISTS idx_calibration_log_fund_date ON calibration_log(fund_code, calibration_date DESC);

-- RLS (mevcut politikalar gibi auth gerektir)
ALTER TABLE tefas_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_log ENABLE ROW LEVEL SECURITY;

-- Anon ve authenticated okuyabilir, sadece service_role yazabilir (mevcut fund_holdings gibi)
DROP POLICY IF EXISTS "allow_read_tefas" ON tefas_returns;
CREATE POLICY "allow_read_tefas" ON tefas_returns FOR SELECT USING (true);

DROP POLICY IF EXISTS "allow_read_calibration" ON calibration_log;
CREATE POLICY "allow_read_calibration" ON calibration_log FOR SELECT USING (true);

-- Service role bypass RLS zaten, ek policy gerekmez yazma için

-- fund_holdings source check genişlet (kap-pdf, calibration dahil)
-- Eğer eski check varsa güncelle
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='fund_holdings') THEN
    -- Mevcut constraint'i bul ve genişlet (eğer varsa)
    -- Basit: check'i drop edip yeniden ekle (tüm source değerlerini kapsayan)
    BEGIN
      ALTER TABLE fund_holdings DROP CONSTRAINT IF EXISTS fund_holdings_source_check;
    EXCEPTION WHEN OTHERS THEN
      -- constraint yoksa sorun değil
      NULL;
    END;
    ALTER TABLE fund_holdings ADD CONSTRAINT fund_holdings_source_check 
      CHECK (source IN ('auto','manual','kap-pdf','calibration','fintables','rotaborsa'));
  END IF;
END $$;
