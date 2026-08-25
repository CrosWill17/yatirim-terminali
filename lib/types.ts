export type AssetType = 'BIST_HISSE' | 'TEFAS_FON' | 'EMTIA_ETF' | 'PPF';
export type ActionType = 'AL' | 'SAT' | 'TUT' | 'KADEMELI_SAT' | '2/3 CIKIS';
export type DecisionStatus = 'bekliyor' | 'onaylandi' | 'uygulandi' | 'reddedildi';

export interface Position {
  id: string;
  symbol: string;
  asset_name: string;
  asset_type: AssetType;
  quantity: number;
  unit_cost: number;
  current_price?: number;
  /** Günlük değişim (%). null = bu tarih için bilinmiyor. */
  daily_change_pct?: number | null;
  target_price?: number;
  stop_price?: number;
  risk_score: number;
  current_action: string;
  rationale: string;
  is_active: boolean;
}

export interface Transaction {
  id: string;
  symbol: string;
  transaction_type: 'ALIS' | 'SATIS' | 'TEMETTU';
  quantity: number;
  unit_price: number;
  total_amount: number;
  withholding_tax: number;
  net_amount: number;
  realized_pnl: number;
  notes?: string;
  created_at: string;
}

export interface CashMovement {
  id: string;
  movement_type: string;
  amount: number;
  balance_after: number;
  description: string;
  category: string;
  created_at: string;
}

export interface Decision {
  id: string;
  symbol: string;
  action_type: string;
  status: DecisionStatus;
  target_price?: number;
  stop_price?: number;
  risk_score: number;
  details: string;
  created_at: string;
}

export interface SocialPredictor {
  id: string;
  handle: string;
  display_name: string;
  trust_score: number;
  total_predictions: number;
  successful_predictions: number;
  notes?: string;
}

export interface SocialPrediction {
  id: string;
  predictor_handle: string;
  fund_code: string;
  predicted_return_pct: number;
  prediction_category: string;
  raw_text: string;
  prediction_date: string;
  actual_return_pct?: number;
  accuracy_score?: number;
  status: 'BEKLIYOR' | 'DOGRULANDI' | 'GECERSIZ';
}

export interface MarketTicker {
  symbol: string;
  name: string;
  price: number;
  changePct: number;
  currency: string;
}
