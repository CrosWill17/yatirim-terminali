-- =============================================================================
-- YATIRIM TERMINALI - fund_holdings.asset_type (6/6)
--
-- NEDEN: fund_holdings tablosunda varlik tipi sutunu YOKTU; tablo ortuk olarak
-- "hisse tutuyor" varsayiyordu. Ama bir fonun icerigi yalnizca hisseden olusmaz:
--
--   DFI (Atlas Portfoy) Agustos 2026 KAP raporu:
--     HISSE      %53.23  (IEYHO, ISKPL, LIDER, BKRGY)
--     TEFAS FON  %30.90  (ABG, PSE, BAC, GDD, KVR, PFS)
--     BONO       % 0.26
--     MEVDUAT    %20.35
--
-- Alt fonlar da fona etki eder ve lib/marketData.ts zaten TEFAS NAV'ini
-- cekebiliyor (fetchFonalyQuote -> fonaly.com/funds/{code}). Onlari
-- fund_holdings'e yazabilmek icin tek eksik bu sutundu.
--
-- KURULUM: Supabase SQL Editor'da bu dosyanin tamamini calistirin.
-- IDEMPOTENT: tekrar calistirmak guvenlidir (IF NOT EXISTS).
-- CIKTI SAF ASCII - kopyalarken Turkce karakter kaybi yasamazsiniz.
--
-- ETKI: mevcut tum satirlar DEFAULT ile 'HISSE' olur - veri kaybi yok,
-- davranis degismez. Yalnizca yeni yazilan alt fon satirlari farkli tipe sahip.
-- =============================================================================

ALTER TABLE public.fund_holdings
  ADD COLUMN IF NOT EXISTS asset_type VARCHAR(20) NOT NULL DEFAULT 'HISSE';

-- Gecerli degerler (lib/assetMeta.ts icindeki TUR_LABEL sabiti ile hizali):
--   HISSE     -> BIST hisse senedi   (fiyat: Yahoo .IS)
--   TEFAS_FON -> TEFAS fonu / katilma belgesi (fiyat: fonaly.com)
--
-- NOT: CHECK kisiti bilerek YOK. Yeni bir varlik sinifi (or. BONO, MEVDUAT)
-- eklendiginde migration zorunlu olmasin; tip etiketi zaten arayuzde rozet
-- olarak gosteriliyor ve bilinmeyen tip "hisse" gibi davraniyor.

COMMENT ON COLUMN public.fund_holdings.asset_type IS
  'HISSE | TEFAS_FON - fiyat kaynagini belirler (Yahoo .IS vs fonaly.com)';

-- Geri alma (gerekiyorsa, yorumu kaldirip calistirin):
-- ALTER TABLE public.fund_holdings DROP COLUMN IF EXISTS asset_type;

-- -----------------------------------------------------------------------------
-- DOGRULAMA
-- -----------------------------------------------------------------------------
SELECT asset_type, count(*) AS satir
  FROM public.fund_holdings
 GROUP BY asset_type
 ORDER BY satir DESC;
-- Beklenen: migration'i yeni kostuysaniz tek satir -> HISSE
