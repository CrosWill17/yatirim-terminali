-- =============================================================================
-- YATIRIM TERMİNALİ v3.4 — FON İÇERİĞİ ÖNERİLERİ (Twitter foto OCR + onay kutusu)
-- İDMPOTENT: tekrar çalıştırılabilir
-- Kurulum: Supabase SQL Editor'da bir kez çalıştırın
-- =============================================================================


-- ==============================================================================
-- YENIDEN CALISTIRMA KILIDI
--
-- supabase/supabase_rls_user_isolation.sql bir kez uygulandiysa bu dosyayi
-- TEKRAR CALISTIRMAYIN. Bu dosya zayif `auth.uid() IS NOT NULL` politikalarini
-- yeniden olusturur ve PostgreSQL izin verici (permissive) politikolari OR ile
-- birlestirdigi icin o zayif politika geri geldiginde `auth.uid() = user_id`
-- yalitimi SESSIZCE coker. Asagidaki kilit bunu imkansiz kilar.
--
-- NOT: Bu blok TEK SATIR ve tek `$$` cifti olarak yazildi. Cok satirli DO
-- bloklari ve satirlara bolunmus RAISE metinleri bazi SQL istemcilerinde
-- yanlis bolunup "syntax error at or near" hatasi verebiliyor.
-- ==============================================================================
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'portfolio_positions' AND column_name = 'user_id') THEN RAISE EXCEPTION 'DURDURULDU: supabase_rls_user_isolation.sql zaten uygulanmis (portfolio_positions.user_id mevcut). Bu dosyayi tekrar calistirmak zayif "auth.uid() IS NOT NULL" politikalarini geri getirip kullanici yalitimini SESSIZCE cokertirdi. Bu dosyayi atlayin.'; END IF; END $$;
CREATE TABLE IF NOT EXISTS fund_holding_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_code VARCHAR(10) NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  weight_pct NUMERIC(8,4) NOT NULL,
  prev_weight_pct NUMERIC(8,4),
  source_tweet_id VARCHAR(40),
  predictor_handle VARCHAR(100) DEFAULT '@sevketozhan',
  raw_text TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / approved / rejected
  UNIQUE (fund_code, ticker, source_tweet_id)
);

CREATE INDEX IF NOT EXISTS idx_fhp_fund_status ON fund_holding_proposals (fund_code, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fhp_ticker ON fund_holding_proposals (ticker);

ALTER TABLE fund_holding_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auth FundProposals" ON fund_holding_proposals;
CREATE POLICY "Auth FundProposals" ON fund_holding_proposals FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
