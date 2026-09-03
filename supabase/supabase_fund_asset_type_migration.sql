-- =============================================================================
-- YATIRIM TERMINALI — fund_holdings.asset_type (6/6)
--
-- NEDEN: fund_holdings tablosunda varlık tipi sütunu YOKTU; tablo örtük olarak
-- "hisse tutuyor" varsayıyordu. Ama bir fonun içeriği yalnızca hisseden oluşmaz:
--
--   DFI (Atlas Portföy) Ağustos 2026 KAP raporu:
--     HİSSE      %53,23  (IEYHO, ISKPL, LIDER, BKRGY)
--     TEFAS FON  %30,90  (ABG, PSE, BAC, GDD, KVR, PFS)
--     BONO       % 0,26
--     MEVDUAT    %20,35
--
-- Alt fonlar da fona etki eder ve lib/marketData.ts zaten TEFAS NAV'ını
-- çekebiliyor (fetchFonalyQuote → fonaly.com/funds/{code}). Onları
-- fund_holdings'e yazabilmek için tek eksik bu sütundu.
--
-- KURULUM: Supabase SQL Editor'da bu dosyanın tamamını çalıştırın.
-- IDEMPOTENT: tekrar çalıştırmak güvenlidir (IF NOT EXISTS).
--
-- ETKİ: mevcut tüm satırlar DEFAULT ile 'HISSE' olur — veri kaybı yok,
-- davranış değişmez. Yalnızca yeni yazılan alt fon satırları farklı tipe sahip.
-- =============================================================================

ALTER TABLE public.fund_holdings
  ADD COLUMN IF NOT EXISTS asset_type VARCHAR(20) NOT NULL DEFAULT 'HISSE';

-- Geçerli değerler. lib/assetMeta.ts'teki ASSET_TYPE_LABELS ile hizalı:
--   HISSE     → BIST hisse senedi (fiyat: Yahoo .IS)
--   TEFAS_FON → TEFAS fonu / katılma belgesi (fiyat: fonaly.com)
--
-- NOT: CHECK kısıtı bilerek YOK. Yeni bir varlık sınıfı (ör. BONO, MEVDUAT)
-- eklendiğinde migration zorunlu olmasın; tip etiketi zaten arayüzde rozet
-- olarak gösteriliyor ve bilinmeyen tip "hisse" gibi davranıyor.

COMMENT ON COLUMN public.fund_holdings.asset_type IS
  'HISSE | TEFAS_FON — fiyat kaynağını belirler (Yahoo .IS vs fonaly.com)';

-- Geri alma (gerekiyorsa, yorumu kaldırıp çalıştırın):
-- ALTER TABLE public.fund_holdings DROP COLUMN IF EXISTS asset_type;

-- -----------------------------------------------------------------------------
-- DOGRULAMA
-- -----------------------------------------------------------------------------
SELECT asset_type, count(*) AS satir
  FROM public.fund_holdings
 GROUP BY asset_type
 ORDER BY satir DESC;
-- Beklenen: migration'ı yeni koştuysanız tek satır → HISSE
