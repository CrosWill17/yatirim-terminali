/**
 * db.ts — Gölge Portföy veritabanı işlemleri (Modül 1 & 2)
 * 
 * Tablolar (Supabase):
 * - fund_holdings (mevcut) — kalibre edilmiş ağırlıklar W_i
 * - calibration_log (YENİ) — günlük kalibrasyon geçmişi, Δ, güven vs
 * - tefas_returns (YENİ) — TEFAS gerçek getirileri G_gercek
 * 
 * Ayrı dosya: repo.ts genel, burası sadece shadow portfolio.
 */

import { supabase, isSupabaseConfigured } from '../supabase';
import type { FundWeight, CalibrationResult, TefasDailyReturn } from './types';

export interface CalibrationLogRow {
  id?: string;
  fund_code: string;
  calibration_date: string; // YYYY-MM-DD (sabah)
  yesterday_date: string; // dünün tarihi
  old_predicted_return_pct: number;
  actual_return_pct: number;
  delta_pct: number;
  explained_delta_pct: number;
  residual_delta_pct: number;
  confidence: number;
  total_turnover_pct: number;
  new_weights: FundWeight[];
  adjustments: any; // JSON
  notes: string[];
  created_at?: string;
}

export async function saveCalibrationLog(log: CalibrationLogRow): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const { error } = await supabase.from('calibration_log').insert({
    fund_code: log.fund_code,
    calibration_date: log.calibration_date,
    yesterday_date: log.yesterday_date,
    old_predicted_return_pct: log.old_predicted_return_pct,
    actual_return_pct: log.actual_return_pct,
    delta_pct: log.delta_pct,
    explained_delta_pct: log.explained_delta_pct,
    residual_delta_pct: log.residual_delta_pct,
    confidence: log.confidence,
    total_turnover_pct: log.new_weights.reduce((s, w) => s + Math.abs((w.prevWeightPct ?? 0) - w.weightPct), 0) / 2,
    new_weights: log.new_weights,
    adjustments: log.adjustments,
    notes: log.notes,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function saveTefasReturn(ret: TefasDailyReturn): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  const { error } = await supabase.from('tefas_returns').upsert(
    {
      fund_code: ret.fundCode,
      date: ret.date,
      return_pct: ret.returnPct,
      nav_price: ret.navPrice ?? null,
      source: ret.source,
    },
    { onConflict: 'fund_code,date' }
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function loadLatestCalibratedWeights(fundCode: string): Promise<FundWeight[] | null> {
  if (!isSupabaseConfigured()) return null;

  // Önce calibration_log'dan en son kalibre edilmiş ağırlıkları al
  const { data: logData, error: logErr } = await supabase
    .from('calibration_log')
    .select('new_weights')
    .eq('fund_code', fundCode.toUpperCase())
    .order('calibration_date', { ascending: false })
    .limit(1);

  if (!logErr && logData && logData.length > 0 && Array.isArray(logData[0].new_weights)) {
    return logData[0].new_weights as FundWeight[];
  }

  // Fallback: fund_holdings tablosundan kap-pdf/manual/auto
  const { data, error } = await supabase
    .from('fund_holdings')
    .select('ticker, weight_pct, company_name, source, as_of_date')
    .eq('fund_code', fundCode.toUpperCase())
    .order('weight_pct', { ascending: false });

  if (error || !data) return null;

  return data.map((r: any) => ({
    ticker: r.ticker,
    weightPct: Number(r.weight_pct),
    companyName: r.company_name,
    assetType: 'hisse' as const,
  }));
}

export async function upsertCalibratedWeights(
  fundCode: string,
  weights: FundWeight[],
  asOfDate: string
): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase not configured' };

  // fund_holdings'e source='calibration' olarak yaz (manual/kap-pdf korunur, ama calibration da korunur)
  const rows = weights.map((w) => ({
    fund_code: fundCode.toUpperCase(),
    ticker: w.ticker.toUpperCase(),
    company_name: w.companyName ?? null,
    weight_pct: w.weightPct,
    as_of_date: asOfDate,
    source: 'calibration' as const,
    notes: `gölge portföy kalibrasyon ${asOfDate} | prev %${w.prevWeightPct?.toFixed(2) ?? '—'}`,
  }));

  const { error } = await supabase.from('fund_holdings').upsert(rows, { onConflict: 'fund_code,ticker' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
