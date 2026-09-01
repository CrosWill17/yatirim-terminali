-- VERİ EKSİK temizliği: @sevketozhan tweetlerinde "Açıklanmadı" gibi sayı içermeyen
-- satırlardan oluşan spam VERI_EKSİK kayıtlarını sil
-- İDMPOTENT, tekrar çalıştırılabilir

-- Önce kontrol: kaç tane VERI_EKSİK var?
-- SELECT status, count(*) FROM social_predictions GROUP BY status;

-- Sil: raw_text içinde "Açıklanmadı" geçen ve predicted_return_pct NULL olanlar
DELETE FROM social_predictions
WHERE status = 'VERI_EKSİK'
  AND predicted_return_pct IS NULL
  AND raw_text ILIKE '%Açıklanmadı%';

-- İsteğe bağlı: hiç sayı içermeyen (regex \d yok) VERI_EKSİK kayıtlarını da sil
-- NOT: Bu, gerçekten sayı çözülemeyen ama sayı içeren tweetleri korur
DELETE FROM social_predictions
WHERE status = 'VERI_EKSİK'
  AND predicted_return_pct IS NULL
  AND raw_text !~ '\d';

-- Son durum
-- SELECT status, count(*) FROM social_predictions GROUP BY status;
