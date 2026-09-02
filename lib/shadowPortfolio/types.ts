/**
 * Gölge Portföy (Shadow Portfolio) — Tip Tanımları
 * Modül 1: Günlük Kalibrasyon + Modül 2: Canlı Hesaplama
 *
 * Strict TypeScript: tüm sayılar number, ağırlıklar % cinsinden (0-100), getiri % cinsinden.
 */

export interface FundWeight {
  /** BIST hisse kodu, örn. THYAO, TERA, NAKIT, VIOP */
  ticker: string;
  /** Fon içindeki ağırlık (%) — 0.01 ≤ w ≤ 10 (SPK), toplam 100 */
  weightPct: number;
  /** Opsiyonel: şirket adı, KAP'tan */
  companyName?: string | null;
  /** Varlık tipi: hisse, nakit, viop, diğer */
  assetType?: 'hisse' | 'nakit' | 'viop' | 'diger';
  /** Önceki gün ağırlığı (değişim takibi için) */
  prevWeightPct?: number | null;
}

export interface StockPerformance {
  /** Hisse kodu */
  ticker: string;
  /** Dünkü kapanışa göre değişim (%) — örn. +2.35, -1.2 */
  changePct: number;
  /** Dünkü kapanış fiyatı (opsiyonel, log için) */
  closePrice?: number;
  /** Tarih YYYY-MM-DD */
  date: string;
  /** Hacim vs. ek sinyal (opsiyonel, yeni hisse girişi tahmini için) */
  volume?: number;
}

export interface CalibrationConfig {
  /** Tek hisse max ağırlık (%) — SPK serbest fon için genelde %10 */
  maxSingleWeightPct: number;
  /** Min anlamlı ağırlık (%) — altında filtre */
  minWeightPct: number;
  /** Kalibrasyon eşiği (%) — |Δ| ≤ eşik ise kalibrasyon yapma */
  deltaThresholdPct: number;
  /** Günlük max devir (%) — yönetici bir günde portföyün en fazla bu kadarını çevirir (plausibility) */
  maxDailyTurnoverPct: number;
  /** Toplam ağırlık hedefi (%) — genelde 100 */
  targetTotalWeightPct: number;
  /** Float toleransı — validateWeights için epsilon */
  epsilon: number;
}

export const DEFAULT_CALIBRATION_CONFIG: CalibrationConfig = {
  maxSingleWeightPct: 10,
  minWeightPct: 0.01,
  deltaThresholdPct: 0.1, // %0.1 altında kalibrasyon yok
  maxDailyTurnoverPct: 20, // bir günde portföyün %20'sinden fazla dönmez (heuristik)
  targetTotalWeightPct: 100,
  epsilon: 0.001, // %0.001 tolerans
};

export interface WeightAdjustment {
  ticker: string;
  oldWeightPct: number;
  newWeightPct: number;
  deltaWeightPct: number; // new - old
  reason: string; // örn. "Δ +%0.25 kapatmak için ANELE → DSTKF kaydırma"
}

export interface CalibrationResult {
  /** Kalibre edilmiş yeni ağırlıklar (sabah W_i) */
  newWeights: FundWeight[];
  /** Eski tahmini getiri (P_getiri) = Σ(W_i_old * R_i) */
  oldPredictedReturnPct: number;
  /** Gerçek TEFAS getirisi (G_gercek) */
  actualReturnPct: number;
  /** Sapma Δ = G_gercek - P_getiri */
  deltaPct: number;
  /** Açıklanan Δ (uygulanan kaydırma ile) */
  explainedDeltaPct: number;
  /** Kalan açıklanamayan Δ */
  residualDeltaPct: number;
  /** Yapılan ayarlamalar */
  adjustments: WeightAdjustment[];
  /** Güven skoru 0-1: Δ'nın ne kadarını mantıklı senaryo ile açıkladık */
  confidence: number;
  /** Kalibrasyon yapıldı mı? */
  calibrated: boolean;
  /** Notlar (log) */
  notes: string[];
}

export interface TefasDailyReturn {
  fundCode: string;
  date: string; // YYYY-MM-DD (dün)
  returnPct: number; // G_gercek, örn. +1.23
  navPrice?: number;
  source: 'tefas' | 'fintables' | 'fallback';
}

export interface LiveCalculationInput {
  fundCode: string;
  calibratedWeights: FundWeight[]; // sabah W_i
  livePerformances: StockPerformance[]; // R_i canlı
}

export interface LiveCalculationResult {
  fundCode: string;
  totalReturnPct: number; // Σ(W_i * R_i)
  coveredWeightPct: number;
  contributions: { ticker: string; weightPct: number; changePct: number; impactPct: number }[];
  missingTickers: string[];
  calculatedAt: string; // ISO
}
