-- =============================================================================
-- YATIRIM TERMINALI - fund_nav_daily (gun sonu tahmin vs gerceklesen)
--
-- AMAC: Fon tahmininin NE KADAR YANILDIGINI olcmek ve tahmini gercege
-- yaklastirmak. Uc sayi yan yana durmali:
--
--   1. anlik tahmin       -> o an hesaplanan (fund_holdings x fiyatlar)
--   2. gun sonu TAHMINI   -> 18:20'de sabitlenen snapshot  (estimated_pct)
--   3. gerceklesen        -> TEFAS'in acikladigi NAV getirisi (actual_pct)
--                              TLY/THF: ayni gun ~22:00
--                              DFI    : ertesi sabah ~08:00
--
-- (2) ile (3) arasindaki fark, kalibrasyon katsayisini besler
-- (lib/fundCalibration.ts). Fark kapatildikca tahmin guclenir.
--
-- NEDEN AYRI TABLO: fund_holdings "fonun ICERIGI"ni tutar (hangi hisse,
-- hangi agirlik). Bu tablo "fonun GUNLUK PERFORMANSI"ni tutar. Ikisi farkli
-- yasam dongusune sahip; ayni tabloda birlestirmek as_of_date karisikligini
-- (summarizeHoldingRows hatasi) buyuturdu.
--
-- KURULUM: Supabase SQL Editor'da calistirin.
-- IDEMPOTENT: tekrar calistirmak guvenlidir.
-- CIKTI SAF ASCII - panoya kopyalarken Turkce karakter kaybi yasamazsiniz.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.fund_nav_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- user_id: RLS migration'i uygulanmissa ZORUNLU (service_role ile yazan
  -- job'lar SUPABASE_OWNER_USER_ID gondermeli). Uygulanmadiysa NULL kalabilir.
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,

  fund_code     VARCHAR(10)  NOT NULL,
  nav_date      DATE         NOT NULL,

  -- 18:20 snapshot'i. covered_pct, tahminin fonun yuzde kacina dayandigini
  -- gosterir: %53 kapsamali bir tahmin sistematik olarak sifira dogru
  -- basiktir, bu yuzden katsayi ile birlikte saklaniyor.
  estimated_pct NUMERIC(9,4),
  covered_pct   NUMERIC(8,4),

  -- TEFAS'in acikladigi GERCEK gunluk getiri. Once NULL baslar, NAV
  -- yayimlaninca geriye dogru doldurulur (DFI'de ertesi sabah).
  actual_pct    NUMERIC(9,4),
  actual_nav    NUMERIC(18,6),
  actual_at     TIMESTAMPTZ,

  -- Kalibrasyon: bu satir yazilirken uygulanan katsayi (1.0 = duzeltmesiz).
  -- Neden saklaniyor: gecmisi geriye donuk degerlendirirken "o gun hangi
  -- katsayiyla tahmin edilmisti" bilinmeli, yoksa backtest yanlis olur.
  calib_factor  NUMERIC(9,5) NOT NULL DEFAULT 1.0,

  -- estimated | actual | both
  status        VARCHAR(10)  NOT NULL DEFAULT 'estimated',

  source        VARCHAR(20)  NOT NULL DEFAULT 'app',
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- Ayni fonun ayni gunu icin TEK kayit. Upsert bunun uzerinden yurur.
  CONSTRAINT fund_nav_daily_user_fund_date_uk UNIQUE (user_id, fund_code, nav_date)
);

CREATE INDEX IF NOT EXISTS fund_nav_daily_fund_date_idx
  ON public.fund_nav_daily (fund_code, nav_date DESC);

COMMENT ON TABLE public.fund_nav_daily IS
  'Gun sonu fon tahmini (18:20 snapshot) ve TEFAS gerceklesen getirisi - kalibrasyon icin';

-- -----------------------------------------------------------------------------
-- DOGRULAMA
-- -----------------------------------------------------------------------------
SELECT fund_code, nav_date, estimated_pct, covered_pct, actual_pct,
       calib_factor, status
  FROM public.fund_nav_daily
 ORDER BY nav_date DESC, fund_code
 LIMIT 20;
-- Beklenen: tablo yeni olustugu icin 0 satir
