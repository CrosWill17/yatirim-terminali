/**
 * YATIRIM TERMİNALİ — SUPABASE VERİ ERİŞİM KATMANI (repo)
 *
 * Supabase yapılandırılmadıysa veya oturum yoksa tüm işlemler sessizce
 * no-op olur; uygulama yerel (bellek içi) modda çalışmaya devam eder.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Position, Decision, Transaction, CashMovement, SocialPrediction,
} from './types';

function enabled(): boolean {
  return isSupabaseConfigured();
}

/* ------------------------------------------------------------------ */
/* Tipler                                                              */
/* ------------------------------------------------------------------ */

export interface DbBundle {
  positions: Position[];
  decisions: Decision[];
  transactions: Transaction[];
  cashMovements: CashMovement[];
  predictions: SocialPrediction[];
  cashBalance: number | null;
  initialCapital: number | null;
}

/* ------------------------------------------------------------------ */
/* OKUMA                                                               */
/* ------------------------------------------------------------------ */

export async function loadAll(): Promise<DbBundle | null> {
  if (!enabled()) return null;
  try {
    const [posRes, decRes, txnRes, cashRes, predRes, balRes, setRes] = await Promise.all([
      supabase.from('portfolio_positions').select('*').order('symbol'),
      supabase.from('execution_decisions').select('*').order('created_at'),
      supabase.from('transactions').select('*').order('created_at', { ascending: false }),
      supabase.from('cash_ledger').select('*').order('created_at', { ascending: false }),
      supabase.from('social_predictions').select('*').order('prediction_date', { ascending: false }),
      supabase.from('cash_ledger').select('balance_after').order('created_at', { ascending: false }).limit(1),
      supabase.from('app_settings').select('key, value').eq('key', 'initial_capital'),
    ]);

    // Hangisi hata verdiyse (tablo yok, RLS reddetti vb.) null döndür — UI lokal modda kalsın.
    if (posRes.error || decRes.error || txnRes.error || cashRes.error || predRes.error) {
      return null;
    }

    const positions: Position[] = ((posRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      asset_name: r.asset_name,
      asset_type: r.asset_type,
      quantity: Number(r.quantity),
      unit_cost: Number(r.unit_cost),
      target_price: r.target_price != null ? Number(r.target_price) : undefined,
      stop_price: r.stop_price != null ? Number(r.stop_price) : undefined,
      risk_score: r.risk_score ?? 5,
      current_action: r.current_action ?? 'TUT',
      rationale: r.rationale ?? '',
      is_active: true,
    }));

    const decisions: Decision[] = ((decRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      action_type: r.action_type,
      status: r.status,
      target_price: r.target_price != null ? Number(r.target_price) : undefined,
      stop_price: r.stop_price != null ? Number(r.stop_price) : undefined,
      risk_score: r.risk_score ?? 5,
      details: r.details ?? '',
      created_at: (r.created_at ?? '').slice(0, 10),
    }));

    const transactions: Transaction[] = ((txnRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      transaction_type: r.transaction_type,
      quantity: Number(r.quantity),
      unit_price: Number(r.unit_price),
      total_amount: Number(r.total_amount),
      withholding_tax: Number(r.withholding_tax ?? 0),
      net_amount: Number(r.net_amount),
      realized_pnl: Number(r.realized_pnl ?? 0),
      notes: r.notes ?? undefined,
      created_at: r.created_at,
    }));

    const cashMovements: CashMovement[] = ((cashRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      movement_type: r.movement_type,
      amount: Number(r.amount),
      balance_after: Number(r.balance_after),
      description: r.description ?? '',
      category: r.movement_type,
      created_at: r.created_at,
    }));

    const predictions: SocialPrediction[] = ((predRes.data as any[]) ?? []).map((r) => ({
      id: r.id,
      predictor_handle: r.predictor_handle,
      fund_code: r.fund_code,
      predicted_return_pct: Number(r.predicted_return_pct),
      prediction_category: r.prediction_category ?? 'GUNLUK_GETIRI',
      raw_text: r.raw_text ?? '',
      prediction_date: r.prediction_date,
      actual_return_pct: r.actual_return_pct != null ? Number(r.actual_return_pct) : undefined,
      accuracy_score: r.accuracy_score != null ? Number(r.accuracy_score) : undefined,
      status: r.status ?? 'BEKLIYOR',
    }));

    const cashBalance = balRes.data?.[0] != null ? Number((balRes.data as any[])[0].balance_after) : null;
    const initialCapital = setRes.data?.[0] != null ? Number((setRes.data as any[])[0].value) : null;

    return { positions, decisions, transactions, cashMovements, predictions, cashBalance, initialCapital };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* YAZMA (tümü best-effort; hata loglanır, UI kırılmaz)                */
/* ------------------------------------------------------------------ */

export async function upsertPosition(p: Position): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('portfolio_positions').upsert(
      {
        symbol: p.symbol,
        asset_name: p.asset_name,
        asset_type: p.asset_type,
        quantity: p.quantity,
        unit_cost: p.unit_cost,
        target_price: p.target_price ?? null,
        stop_price: p.stop_price ?? null,
        risk_score: p.risk_score,
        current_action: p.current_action,
        rationale: p.rationale,
      },
      { onConflict: 'symbol' }
    );
  } catch (e) {
    console.warn('[repo] upsertPosition:', e);
  }
}

export async function upsertDecision(d: Decision): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('execution_decisions').upsert(
      {
        id: d.id,
        symbol: d.symbol,
        action_type: d.action_type,
        status: d.status,
        target_price: d.target_price ?? null,
        stop_price: d.stop_price ?? null,
        risk_score: d.risk_score,
        details: d.details,
        created_at: d.created_at,
      },
      { onConflict: 'id' }
    );
  } catch (e) {
    console.warn('[repo] upsertDecision:', e);
  }
}

export async function insertTransaction(t: Transaction): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('transactions').insert({
      symbol: t.symbol,
      transaction_type: t.transaction_type,
      quantity: t.quantity,
      unit_price: t.unit_price,
      total_amount: t.total_amount,
      withholding_tax: t.withholding_tax,
      net_amount: t.net_amount,
      realized_pnl: t.realized_pnl,
      notes: t.notes ?? null,
      created_at: t.created_at,
    });
  } catch (e) {
    console.warn('[repo] insertTransaction:', e);
  }
}

export async function insertCashMovement(m: CashMovement): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('cash_ledger').insert({
      movement_type: m.movement_type,
      amount: m.amount,
      balance_after: m.balance_after,
      description: m.description,
      created_at: m.created_at,
    });
  } catch (e) {
    console.warn('[repo] insertCashMovement:', e);
  }
}

export async function insertPrediction(p: SocialPrediction): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('social_predictions').insert({
      predictor_handle: p.predictor_handle,
      fund_code: p.fund_code,
      predicted_return_pct: p.predicted_return_pct,
      prediction_category: p.prediction_category,
      raw_text: p.raw_text,
      prediction_date: p.prediction_date,
      actual_return_pct: p.actual_return_pct ?? null,
      accuracy_score: p.accuracy_score ?? null,
      status: p.status,
    });
  } catch (e) {
    console.warn('[repo] insertPrediction:', e);
  }
}

export async function updatePrediction(p: SocialPrediction): Promise<void> {
  if (!enabled()) return;
  try {
    // local id uuid değilse (Date.now tabanlı) symbol+tarih+metin ile yakala
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRe.test(p.id)) {
      await supabase.from('social_predictions').update({
        actual_return_pct: p.actual_return_pct ?? null,
        accuracy_score: p.accuracy_score ?? null,
        status: p.status,
      }).eq('id', p.id);
    } else {
      await supabase.from('social_predictions').update({
        actual_return_pct: p.actual_return_pct ?? null,
        accuracy_score: p.accuracy_score ?? null,
        status: p.status,
      }).eq('raw_text', p.raw_text).eq('fund_code', p.fund_code);
    }
  } catch (e) {
    console.warn('[repo] updatePrediction:', e);
  }
}

export async function setInitialCapital(value: number): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('app_settings').upsert({ key: 'initial_capital', value: String(value) });
  } catch (e) {
    console.warn('[repo] setInitialCapital:', e);
  }
}

export async function saveDailySnapshot(
  date: string,
  totalValue: number,
  cashBalance: number,
  breakdown: Record<string, number>
): Promise<void> {
  if (!enabled()) return;
  try {
    await supabase.from('portfolio_snapshots').upsert(
      { snapshot_date: date, total_value: totalValue, cash_balance: cashBalance, breakdown },
      { onConflict: 'snapshot_date' }
    );
  } catch (e) {
    console.warn('[repo] saveDailySnapshot:', e);
  }
}
