/**
 * YATIRIM TERMİNALİ — SUPABASE VERİ ERİŞİM KATMANI (repo)
 *
 * P0 KURALI: SESSİZ YUTMA YASAK.
 *  - supabase-js hata FIRLATMAZ, { data, error } döndürür. Bu yüzden her
 *    yazma fonksiyonu `error` alanını kontrol eder ve sonucu { ok } olarak
 *    GERİ DÖNDÜRÜR. UI bu sonucu kırmızı banner'da gösterir.
 *  - Okuma (loadAll) başarısız olursa artık "connected" gibi görünmez:
 *    { ok: false, error } döner ve UI 'db_error' durumuna geçer.
 *  - Supabase yapılandırılmadıysa hiçbir şey "çalışıyor" gibi gösterilmez:
 *    kind='setup' hatası döner.
 *
 * YAZMA HEDEFLERİ: her fonksiyon yalnızca kendi tablosuna yazar.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Position, Decision, Transaction, CashMovement, SocialPrediction,
  FundHoldingRow, RepoError, RepoErrorKind, WriteResult,
} from './types';

function enabled(): boolean {
  return isSupabaseConfigured();
}

/** Aktif oturumdaki kullanıcının Supabase user id'si (RLS user_id yazmaları için). */
async function currentUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Hata yardımcıları                                                   */
/* ------------------------------------------------------------------ */

function setupError(operation: string): RepoError {
  return {
    kind: 'setup',
    operation,
    message: 'Supabase yapılandırılmadı (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY eksik)',
  };
}

/** Supabase hata nesnesini sınıflandır (RLS reddi / tablo yok / ağ). */
export function classifySupabaseError(
  operation: string,
  err: { message?: string; code?: string; status?: number } | null
): RepoError {
  const message = err?.message ?? 'bilinmeyen veritabanı hatası';
  const code = String(err?.code ?? '');
  const status = typeof err?.status === 'number' ? err.status : null;
  let kind: RepoErrorKind = 'unknown';
  if (code === '42501' || /row-level security|row level security|permission denied/i.test(message)) kind = 'rls';
  else if (code === '42P01' || /relation .* does not exist|could not find the table/i.test(message)) kind = 'not_found';
  else if (status === 401 || status === 403 || /invalid.*token|jwt/i.test(message)) kind = 'rls';
  else if (status === 0 || /fetch failed|network|timeout/i.test(message)) kind = 'network';
  return { kind, operation, message };
}

function warn(op: string, error: RepoError): void {
  // Kimlik bilgisi loglanmaz — yalnızca işlem adı, hata türü ve mesaj.
  console.warn(`[repo] ${op} başarısız (${error.kind}): ${error.message}`);
}

/** supabase-js dönüş gövdesi (builder thenable'dır). */
interface SupabaseResult {
  error: { message?: string; code?: string; status?: number } | null;
}

/**
 * Tek yazma deseni: `error` alanı kontrol edilir, hata varsa console.warn +
 * { ok:false, error } döner. Başarılıysa { ok:true }.
 * `fn` çağrısına oturumdaki `user_id` geçirilir — tüm yazmalar RLS
 * (auth.uid() = user_id) kuralına uygun şekilde user_id taşır.
 */
async function write(
  operation: string,
  fn: (userId: string) => PromiseLike<SupabaseResult>
): Promise<WriteResult> {
  if (!enabled()) {
    const e = setupError(operation);
    warn(operation, e);
    return { ok: false, error: e };
  }
  try {
    const userId = await currentUserId();
    if (!userId) {
      const e = classifySupabaseError(operation, {
        message: 'Oturum yok — user_id çözülemedi (giriş yapılmalı)',
        status: 401,
      });
      warn(operation, e);
      return { ok: false, error: e };
    }
    const { error } = await fn(userId);
    if (error) {
      const e = classifySupabaseError(operation, error);
      warn(operation, e);
      return { ok: false, error: e };
    }
    return { ok: true };
  } catch (err) {
    const e = classifySupabaseError(operation, {
      message: err instanceof Error ? err.message : String(err),
    });
    warn(operation, e);
    return { ok: false, error: e };
  }
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
  fundHoldings: FundHoldingRow[];
  proposals: FundHoldingProposal[];
  cashBalance: number | null;
  initialCapital: number | null;
  /** Güven skoru (yoksa null — UI varsayılan 78.5 kullanır). */
  trustScore: number | null;
}

export type LoadResult =
  | { ok: true; bundle: DbBundle }
  | { ok: false; error: RepoError };

/* ------------------------------------------------------------------ */
/* OKUMA                                                               */
/* ------------------------------------------------------------------ */

export async function loadAll(): Promise<LoadResult> {
  if (!enabled()) return { ok: false, error: setupError('loadAll') };
  try {
    const [posRes, decRes, txnRes, cashRes, predRes, fundRes, propRes, balRes, setRes] = await Promise.all([
      supabase.from('portfolio_positions').select('*').order('symbol'),
      supabase.from('execution_decisions').select('*').order('created_at'),
      supabase.from('transactions').select('*').order('created_at', { ascending: false }),
      supabase.from('cash_ledger').select('*').order('created_at', { ascending: false }),
      supabase.from('social_predictions').select('*').order('prediction_date', { ascending: false }),
      supabase.from('fund_holdings').select('*').order('fund_code').order('weight_pct', { ascending: false }),
      supabase.from('fund_holding_proposals').select('*').eq('status', 'pending').order('detected_at', { ascending: false }),
      supabase.from('cash_ledger').select('balance_after').order('created_at', { ascending: false }).limit(1),
      supabase.from('app_settings').select('key, value'),
    ]);

    // ÇEKİRDEK tablolar: hata varsa yükleme BAŞARISIZ sayılır (sessiz devam yok).
    const core = [
      ['portfolio_positions', posRes], ['execution_decisions', decRes],
      ['transactions', txnRes], ['cash_ledger', cashRes], ['social_predictions', predRes],
    ] as const;
    for (const [table, res] of core) {
      if (res.error) {
        const error = classifySupabaseError(`loadAll:${table}`, res.error);
        warn(`loadAll:${table}`, error);
        return { ok: false, error };
      }
    }

    // fund_holdings: v3.2 migration'ı henüz çalıştırılmamış olabilir → yüklemeyi
    // engellemez ama hata GİZLENMEZ (console + UI ipucu).
    let fundHoldings: FundHoldingRow[] = [];
    if (fundRes.error) {
      const error = classifySupabaseError('loadAll:fund_holdings', fundRes.error);
      console.warn(
        `[repo] fund_holdings okunamadı (${error.kind}): ${error.message} — ` +
        'supabase/supabase_fund_holdings_migration.sql çalıştırıldı mı?'
      );
    } else {
      fundHoldings = ((fundRes.data as any[]) ?? []).map((r) => ({
        id: r.id,
        fund_code: r.fund_code,
        ticker: r.ticker,
        company_name: r.company_name ?? null,
        weight_pct: Number(r.weight_pct),
        as_of_date: String(r.as_of_date ?? '').slice(0, 10),
        source: ['manual', 'calibration', 'kap-pdf'].includes(r.source) ? r.source : 'auto',
        notes: r.notes ?? null,
      }));
    }

    // fund_holding_proposals: v3.4 migration henüz çalıştırılmamış olabilir → sessiz.
    let proposals: FundHoldingProposal[] = [];
    if (propRes.error) {
      console.warn(`[repo] fund_holding_proposals okunamadı: ${propRes.error.message} — supabase_fund_proposals_migration.sql çalıştırıldı mı?`);
    } else {
      proposals = ((propRes.data as any[]) ?? []).map((r) => ({
        id: r.id,
        fund_code: r.fund_code,
        ticker: r.ticker,
        weight_pct: Number(r.weight_pct),
        prev_weight_pct: r.prev_weight_pct != null ? Number(r.prev_weight_pct) : null,
        source_tweet_id: r.source_tweet_id ?? null,
        predictor_handle: r.predictor_handle ?? null,
        raw_text: r.raw_text ?? null,
        detected_at: r.detected_at,
        status: r.status,
      }));
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
      predicted_return_pct: r.predicted_return_pct != null ? Number(r.predicted_return_pct) : null,
      prediction_category: r.prediction_category ?? 'GUNLUK_GETIRI',
      raw_text: r.raw_text ?? '',
      prediction_date: r.prediction_date,
      actual_return_pct: r.actual_return_pct != null ? Number(r.actual_return_pct) : undefined,
      accuracy_score: r.accuracy_score != null ? Number(r.accuracy_score) : undefined,
      status: r.status ?? 'BEKLIYOR',
    }));

    // P0: kasa bakiyesi ve app_settings okuma hataları da SESSİZ yutulmaz.
    if (balRes.error) {
      console.warn(`[repo] cash_ledger bakiyesi okunamadı: ${balRes.error.message} — cashBalance null varsayılır.`);
    }
    if (setRes.error) {
      console.warn(`[repo] app_settings okunamadı: ${setRes.error.message} — initial_capital/trust_score null varsayılır.`);
    }

    const cashBalance = balRes.data?.[0] != null ? Number((balRes.data as any[])[0].balance_after) : null;
    const settings = (setRes.data as any[]) ?? [];
    const getSetting = (key: string): number | null => {
      const row = settings.find((s) => s.key === key);
      if (row == null || row.value == null) return null;
      const n = Number(row.value);
      return Number.isFinite(n) ? n : null;
    };
    const initialCapital = getSetting('initial_capital');
    const trustScore = getSetting('trust_score');

    return {
      ok: true,
      bundle: { positions, decisions, transactions, cashMovements, predictions, fundHoldings, proposals, cashBalance, initialCapital, trustScore },
    };
  } catch (err) {
    const error = classifySupabaseError('loadAll', {
      message: err instanceof Error ? err.message : String(err),
    });
    warn('loadAll', error);
    return { ok: false, error };
  }
}

/* ------------------------------------------------------------------ */
/* YAZMA — hepsi { ok } döndürür; sessiz yutma yok                     */
/* ------------------------------------------------------------------ */

export function upsertPosition(p: Position): Promise<WriteResult> {
  return write('upsertPosition', (userId) =>
    supabase.from('portfolio_positions').upsert(
      {
        user_id: userId,
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
      { onConflict: 'user_id,symbol' }
    )
  );
}

export function upsertDecision(d: Decision): Promise<WriteResult> {
  return write('upsertDecision', (userId) =>
    supabase.from('execution_decisions').upsert(
      {
        user_id: userId,
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
      { onConflict: 'user_id,id' }
    )
  );
}

export function insertTransaction(t: Transaction): Promise<WriteResult> {
  return write('insertTransaction', (userId) =>
    supabase.from('transactions').insert({
      user_id: userId,
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
    })
  );
}

export function insertCashMovement(m: CashMovement): Promise<WriteResult> {
  return write('insertCashMovement', (userId) =>
    supabase.from('cash_ledger').insert({
      user_id: userId,
      movement_type: m.movement_type,
      amount: m.amount,
      balance_after: m.balance_after,
      description: m.description,
      created_at: m.created_at,
    })
  );
}

export function insertPrediction(p: SocialPrediction): Promise<WriteResult> {
  return write('insertPrediction', (userId) =>
    supabase.from('social_predictions').insert({
      id: p.id, // UUID — doğrulama (updatePrediction) aynı id ile kesin eşleşir
      user_id: userId,
      predictor_handle: p.predictor_handle,
      fund_code: p.fund_code,
      predicted_return_pct: p.predicted_return_pct,
      prediction_category: p.prediction_category,
      raw_text: p.raw_text,
      prediction_date: p.prediction_date,
      actual_return_pct: p.actual_return_pct ?? null,
      accuracy_score: p.accuracy_score ?? null,
      status: p.status,
    })
  );
}

export function updatePrediction(p: SocialPrediction): Promise<WriteResult> {
  const patch = {
    actual_return_pct: p.actual_return_pct ?? null,
    accuracy_score: p.accuracy_score ?? null,
    status: p.status,
  };
  // p.id artık gerçek UUID (crypto.randomUUID) — toplu güncelleme riski yok.
  return write('updatePrediction', (userId) =>
    supabase.from('social_predictions').update(patch).eq('id', p.id).eq('user_id', userId)
  );
}

export function setInitialCapital(value: number): Promise<WriteResult> {
  return write('setInitialCapital', (userId) =>
    supabase.from('app_settings').upsert(
      { user_id: userId, key: 'initial_capital', value: String(value) },
      { onConflict: 'user_id,key' }
    )
  );
}

/** Güven skoru kalıcılığı (kullanıcı başına). */
export function setTrustScore(value: number): Promise<WriteResult> {
  return write('setTrustScore', (userId) =>
    supabase.from('app_settings').upsert(
      { user_id: userId, key: 'trust_score', value: String(value) },
      { onConflict: 'user_id,key' }
    )
  );
}

export function saveDailySnapshot(
  date: string,
  totalValue: number,
  cashBalance: number,
  breakdown: Record<string, number>
): Promise<WriteResult> {
  return write('saveDailySnapshot', (userId) =>
    supabase.from('portfolio_snapshots').upsert(
      { user_id: userId, snapshot_date: date, total_value: totalValue, cash_balance: cashBalance, breakdown },
      { onConflict: 'user_id,snapshot_date' }
    )
  );
}

/* --------------------- Fon içeriği (yalnız fund_holdings) ---------- */

export interface FundHoldingDraft {
  fund_code: string;
  ticker: string;
  company_name?: string | null;
  weight_pct: number;
  as_of_date: string;
  notes?: string | null;
}

/** Manuel override: source='manual' — otomatik sync job'u bu satırı asla ezmez. */
export function upsertFundHolding(h: FundHoldingDraft): Promise<WriteResult> {
  return write('upsertFundHolding', (userId) =>
    supabase.from('fund_holdings').upsert(
      {
        user_id: userId,
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: 'manual',
        notes: h.notes ?? 'manuel override (UI)',
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

/** KAP PDF — ana veri kaynağı (ham veri, onay gerektirmez, sync ezmez) */
export function upsertFundHoldingKapPdf(h: FundHoldingDraft): Promise<WriteResult> {
  return write('upsertFundHoldingKapPdf', (userId) =>
    supabase.from('fund_holdings').upsert(
      {
        user_id: userId,
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: 'kap-pdf',
        notes: h.notes ?? 'KAP PDF (ana kaynak, ham veri)',
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

/** Otomatik araştırma: source='auto' — sync job'u ezebilir, manuel/kap-pdf değil. */
export function upsertFundHoldingAuto(h: FundHoldingDraft & { source?: 'auto' | 'fintables' | 'rotaborsa' | 'kap-pdf' }): Promise<WriteResult> {
  return write('upsertFundHoldingAuto', (userId) =>
    supabase.from('fund_holdings').upsert(
      {
        user_id: userId,
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: (h as any).source ?? 'auto',
        notes: h.notes ?? 'otomatik araştırma (fintables/rotaborsa)',
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

/**
 * Fon içeriği satırı silme — (fund_code, ticker) anahtarıyla.
 * UI'ın ürettiği yerel id'ler UUID olmadığı için `.eq('id')` kullanılmaz;
 * tablo UNIQUE(user_id, fund_code, ticker) olduğundan bu eşleşme kesindir.
 */
export function deleteFundHolding(fundCode: string, ticker: string): Promise<WriteResult> {
  return write('deleteFundHolding', (userId) =>
    supabase.from('fund_holdings').delete().eq('user_id', userId).eq('fund_code', fundCode).eq('ticker', ticker)
  );
}

/* --------------------- Fon içeriği önerileri (Twitter foto OCR + onay) ---------- */

export interface FundHoldingProposal {
  id: string;
  fund_code: string;
  ticker: string;
  weight_pct: number;
  prev_weight_pct?: number | null;
  source_tweet_id?: string | null;
  predictor_handle?: string | null;
  raw_text?: string | null;
  detected_at?: string;
  status: 'pending' | 'approved' | 'rejected';
}

export async function loadProposals(): Promise<FundHoldingProposal[]> {
  if (!enabled()) return [];
  try {
    const { data, error } = await supabase.from('fund_holding_proposals').select('*').eq('status', 'pending').order('detected_at', { ascending: false });
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      id: r.id,
      fund_code: r.fund_code,
      ticker: r.ticker,
      weight_pct: Number(r.weight_pct),
      prev_weight_pct: r.prev_weight_pct != null ? Number(r.prev_weight_pct) : null,
      source_tweet_id: r.source_tweet_id ?? null,
      predictor_handle: r.predictor_handle ?? null,
      raw_text: r.raw_text ?? null,
      detected_at: r.detected_at,
      status: r.status,
    }));
  } catch {
    return [];
  }
}

export function approveProposal(id: string): Promise<WriteResult> {
  return write('approveProposal', (userId) =>
    supabase.from('fund_holding_proposals').update({ status: 'approved' }).eq('id', id).eq('user_id', userId)
  );
}

export function rejectProposal(id: string): Promise<WriteResult> {
  return write('rejectProposal', (userId) =>
    supabase.from('fund_holding_proposals').update({ status: 'rejected' }).eq('id', id).eq('user_id', userId)
  );
}

