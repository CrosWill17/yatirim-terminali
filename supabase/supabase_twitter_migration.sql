-- ==============================================================================
-- YATIRIM TERMİNALİ — twitter-sync şema güncellemesi (v3.2)
-- İDMPOTENT: tekrar çalıştırılabilir (IF NOT NULL / IF NOT EXISTS).
-- Supabase SQL Editor'da bir kez çalıştırın (mevcut veriyi dokunmaz).
-- ==============================================================================

-- 1) VERİ EKSİK satırlar için: sayı yoksa NULL olabilsin (Rule 4 — uydurma yok)
ALTER TABLE social_predictions
  ALTER COLUMN predicted_return_pct DROP NOT NULL;

-- 2) Tweet izi: idempotency (aynı tweet iki kez yazılmasın)
ALTER TABLE social_predictions
  ADD COLUMN IF NOT EXISTS source_tweet_id VARCHAR(40);

CREATE UNIQUE INDEX IF NOT EXISTS idx_social_predictions_source_tweet
  ON social_predictions (source_tweet_id)
  WHERE source_tweet_id IS NOT NULL;
