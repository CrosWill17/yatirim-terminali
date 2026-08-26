/**
 * YATIRIM TERMİNALİ v3.1 — FİNANSAL FORMÜLLER VE HESAPLAMA MOTORU
 */

// 1. Gram Altın Hesaplama (Ons + USD/TRY)
export function calculateGramGold(ounceGoldUsd: number, usdTry: number): number {
  if (!ounceGoldUsd || !usdTry) return 0;
  return (ounceGoldUsd / 31.1034768) * usdTry;
}

// 2. Altın / Gümüş Rasyosu
export function calculateGoldSilverRatio(ounceGoldUsd: number, ounceSilverUsd: number): {
  ratio: number;
  status: 'GUMUS_PAHALI' | 'GUMUS_UCUZ' | 'DENGEDE';
  interpretation: string;
} {
  if (!ounceGoldUsd || !ounceSilverUsd) return { ratio: 0, status: 'DENGEDE', interpretation: 'Veri yok' };
  const ratio = ounceGoldUsd / ounceSilverUsd;
  
  // Tarihsel ortalama ~80
  if (ratio < 70) {
    return {
      ratio,
      status: 'GUMUS_PAHALI',
      interpretation: `Rasyo ${ratio.toFixed(1)}: Gümüş tarihsel ortalamasına (80) göre altına kıyasla primli/pahalı bölgede.`
    };
  } else if (ratio > 85) {
    return {
      ratio,
      status: 'GUMUS_UCUZ',
      interpretation: `Rasyo ${ratio.toFixed(1)}: Gümüş altına göre tarihsel olarak iskontolu/ucuz bölgede.`
    };
  }
  return {
    ratio,
    status: 'DENGEDE',
    interpretation: `Rasyo ${ratio.toFixed(1)}: Altın/Gümüş dengeli bantta.`
  };
}

// 3. Stopaj Hesaplama
export function calculateTax(
  assetType: string,
  symbol: string,
  buyTotalCost: number,
  sellTotalRevenue: number
): { profit: number; taxRate: number; taxAmount: number; netRevenue: number } {
  const profit = Math.max(0, sellTotalRevenue - buyTotalCost);
  let taxRate = 0;

  // Hisse senedi yoğun fonlarda (THF vb.) veya BIST hisselerinde stopaj %0
  if (assetType === 'BIST_HISSE' || symbol === 'THF') {
    taxRate = 0.0;
  } else if (assetType === 'TEFAS_FON' || assetType === 'PPF') {
    // Serbest ve diğer yatırım fonlarında güncel stopaj %17.5
    taxRate = 0.175;
  }

  const taxAmount = profit * taxRate;
  const netRevenue = sellTotalRevenue - taxAmount;

  return {
    profit,
    taxRate,
    taxAmount,
    netRevenue
  };
}

// 4. Sosyal Medya Tahmin İsabet Skoru (7 Adım Kuralı)
export function calculateAccuracyScore(predictedPct: number, actualPct: number): number {
  const diff = Math.abs(predictedPct - actualPct);
  if (diff < 0.05) return 100;
  if (diff < 0.10) return 80;
  if (diff < 0.20) return 60;
  if (diff < 0.50) return 30;
  return 0;
}

// 5. Güven Skoru Güncelleme (0.7 * eski + 0.3 * isabet)
export function updateTrustScore(oldTrustScore: number, accuracyScore: number): number {
  const updated = 0.7 * oldTrustScore + 0.3 * accuracyScore;
  return Number(Math.min(100, Math.max(0, updated)).toFixed(2));
}

// 6. Nihai Birleştirilmiş Tahmin Sinyali
export function blendForecast(modelForecastPct: number, benchmarkForecastPct: number): number {
  return Number((modelForecastPct * 0.6 + benchmarkForecastPct * 0.4).toFixed(4));
}

// 7. Reel Getiri Hesaplama (Fisher Denklemi)
export function calculateRealReturn(nominalReturnPct: number, inflationPct: number): number {
  return Number((((1 + nominalReturnPct / 100) / (1 + inflationPct / 100) - 1) * 100).toFixed(2));
}
