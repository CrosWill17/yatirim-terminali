-- =============================================================================
-- YATIRIM TERMİNALİ v3.2 — FON İÇERİĞİ (FUND HOLDINGS) ŞEMASI
--
-- Kurulum: supabase.com → SQL Editor → bu dosyanın tamamını çalıştır.
-- İDİMPOTENT: tekrar çalıştırmak güvenli. Mevcut tabloları/değerleri DEĞİŞTİRMEZ.
--
-- Etki: 3 yeni tablo + 1 tetikleyici (history otomatik snapshot).
-- =============================================================================

-- 1) fund_holdings — her fonun GÜNCEL hisse içeriği (bir hisse = bir satır)
CREATE TABLE IF NOT EXISTS fund_holdings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code     VARCHAR(10)  NOT NULL,
  ticker        VARCHAR(10)  NOT NULL,
  company_name  TEXT,
  weight_pct    NUMERIC(8,4) NOT NULL,            -- fon içindeki ağırlık (%) = fona etkisi
  as_of_date    DATE         NOT NULL,            -- resmi rapor dönemi (aylık KAP raporu)
  source        VARCHAR(30)  NOT NULL DEFAULT 'auto', -- auto | calibration | manual
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (fund_code, ticker)
);
CREATE INDEX IF NOT EXISTS idx_fund_holdings_fund ON fund_holdings (fund_code);

-- 2) fund_holdings_history — her değişimde otomatik snapshot (denetim + aylık değişim)
CREATE TABLE IF NOT EXISTS fund_holdings_history (
  id            BIGSERIAL PRIMARY KEY,
  fund_code     VARCHAR(10)  NOT NULL,
  ticker        VARCHAR(10)  NOT NULL,
  company_name  TEXT,
  weight_pct    NUMERIC(8,4) NOT NULL,
  as_of_date    DATE         NOT NULL,
  source        VARCHAR(30)  NOT NULL,
  snapshot_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fhh_fund_ticker ON fund_holdings_history (fund_code, ticker, snapshot_at DESC);

-- 3) calibration_log — gün sonu kalibrasyon kayıtları (kalibrasyon job'u doldurur)
CREATE TABLE IF NOT EXISTS calibration_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code           VARCHAR(10)  NOT NULL,
  cal_date            DATE         NOT NULL,
  model_predicted_pct NUMERIC(8,4),
  official_pct        NUMERIC(8,4),
  residual_pct        NUMERIC(8,4),
  adjustments         JSONB,
  notes               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (fund_code, cal_date)
);

-- Tetikleyici: fund_holdings'e her INSERT/UPDATE → history'ye snapshot
-- (SET search_path = '' : Supabase güvenlik linter tavsiyesi; tablo açıkça nitelenir)
CREATE OR REPLACE FUNCTION public.trg_fund_holdings_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.fund_holdings_history (fund_code, ticker, company_name, weight_pct, as_of_date, source)
  VALUES (NEW.fund_code, NEW.ticker, NEW.company_name, NEW.weight_pct, NEW.as_of_date, NEW.source);
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fund_holdings_history_trg ON fund_holdings;
CREATE TRIGGER fund_holdings_history_trg
  AFTER INSERT OR UPDATE ON fund_holdings
  FOR EACH ROW EXECUTE FUNCTION trg_fund_holdings_history();

-- RLS: mevcut tablolarla aynı desen (yalnız oturum açmış kullanıcı okur/yazar)
ALTER TABLE fund_holdings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fund_holdings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE calibration_log       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth FundHoldings" ON fund_holdings;
DROP POLICY IF EXISTS "Auth FundHist"     ON fund_holdings_history;
DROP POLICY IF EXISTS "Auth Calibration"  ON calibration_log;

CREATE POLICY "Auth FundHoldings" ON fund_holdings         FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth FundHist"     ON fund_holdings_history FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Auth Calibration"  ON calibration_log       FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
