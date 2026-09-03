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
 * KULLANICI YALITIMI (supabase/supabase_rls_user_isolation.sql):
 *  - Her tabloda `user_id UUID NOT NULL DEFAULT auth.uid()` var. Tarayıcı
 *    oturumunun JWT'si PostgREST'e gittiği için user_id OTOMATİK dolar —
 *    bu yüzden payload'larda user_id GÖNDERMİYORUZ (göndersek de RLS
 *    WITH CHECK başkasının id'sini reddeder).
 *  - `onConflict` hedefleri bu yüzden BİLEŞİK: 'user_id,symbol' vb.
 *    Tekil kısıtlar kullanıcı bazlı; iki kullanıcı aynı sembolü tutabilir.
 *  - Okumalarda .eq('user_id', ...) YOK: RLS zaten süzer, ekstra filtre
 *    yanlışı gizler.
 *
 * YAZMA HEDEFLERİ: her fonksiyon yalnızca kendi tablosuna yazar.
 */

import { supabase, isSupabaseConfigured } from './supabase';
import {
  Position, Decision, Transaction, CashMovement, SocialPrediction,
  FundAssetType, FundHoldingRow, RepoError, RepoErrorKind, WriteResult,
} from './types';

function enabled(): boolean {
  return isSupabaseConfigured();
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
 */
async function write(
  operation: string,
  fn: () => PromiseLike<SupabaseResult>
): Promise<WriteResult> {
  if (!enabled()) {
    const e = setupError(operation);
    warn(operation, e);
    return { ok: false, error: e };
  }
  try {
    const { error } = await fn();
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
      supabase.from('app_settings').select('key, value').eq('key', 'initial_capital'),
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
        // Migration koşmadıysa sütun döndürülmez → 'HISSE' varsay (eski davranış).
        asset_type: r.asset_type ?? 'HISSE',
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

    const cashBalance = balRes.data?.[0] != null ? Number((balRes.data as any[])[0].balance_after) : null;
    const initialCapital = setRes.data?.[0] != null ? Number((setRes.data as any[])[0].value) : null;

    return {
      ok: true,
      bundle: { positions, decisions, transactions, cashMovements, predictions, fundHoldings, proposals, cashBalance, initialCapital },
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
  return write('upsertPosition', () =>
    supabase.from('portfolio_positions').upsert(
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
      { onConflict: 'user_id,symbol' }
    )
  );
}

export function upsertDecision(d: Decision): Promise<WriteResult> {
  return write('upsertDecision', () =>
    supabase.from('execution_decisions').upsert(
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
      { onConflict: 'user_id,id' }
    )
  );
}

export function insertTransaction(t: Transaction): Promise<WriteResult> {
  return write('insertTransaction', () =>
    supabase.from('transactions').insert({
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
  return write('insertCashMovement', () =>
    supabase.from('cash_ledger').insert({
      movement_type: m.movement_type,
      amount: m.amount,
      balance_after: m.balance_after,
      description: m.description,
      created_at: m.created_at,
    })
  );
}

export function insertPrediction(p: SocialPrediction): Promise<WriteResult> {
  return write('insertPrediction', () =>
    supabase.from('social_predictions').insert({
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
  // local id uuid değilse (Date.now tabanlı) symbol+tarih+metin ile yakala
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const patch = {
    actual_return_pct: p.actual_return_pct ?? null,
    accuracy_score: p.accuracy_score ?? null,
    status: p.status,
  };
  return write('updatePrediction', () =>
    uuidRe.test(p.id)
      ? supabase.from('social_predictions').update(patch).eq('id', p.id)
      : supabase.from('social_predictions').update(patch).eq('raw_text', p.raw_text).eq('fund_code', p.fund_code)
  );
}

export function setInitialCapital(value: number): Promise<WriteResult> {
  return write('setInitialCapital', () =>
    supabase.from('app_settings').upsert(
      { key: 'initial_capital', value: String(value) },
      // app_settings'in PK'si artık bileşik: (user_id, key)
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
  return write('saveDailySnapshot', () =>
    supabase.from('portfolio_snapshots').upsert(
      { snapshot_date: date, total_value: totalValue, cash_balance: cashBalance, breakdown },
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
  /**
   * Varlık sınıfı. Verilmezse 'HISSE'.
   * ÖNEMLİ: yalnızca supabase_fund_asset_type_migration.sql koştuysa gönderilir —
   * aksi hâlde supabase "column asset_type does not exist" der ve YAZMA PATLAR.
   * Bu yüzden assetTypePayload() sütunun var olup olmadığını bilmediğimiz
   * durumlarda alanı hiç eklemiyor; DB'deki DEFAULT 'HISSE' devreye giriyor.
   */
  asset_type?: FundAssetType;
}

/**
 * asset_type migration'ı geriye dönük uyumlu olsun diye: tip verilmediyse
 * payload'a alanı HİÇ koyma. Böylece migration koşmamış projelerde eski
 * davranış aynen sürer.
 */
function assetTypePayload(h: FundHoldingDraft): Record<string, string> {
  return h.asset_type ? { asset_type: h.asset_type } : {};
}

/** Manuel override: source='manual' — otomatik sync job'u bu satırı asla ezmez. */
export function upsertFundHolding(h: FundHoldingDraft): Promise<WriteResult> {
  return write('upsertFundHolding', () =>
    supabase.from('fund_holdings').upsert(
      {
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: 'manual',
        notes: h.notes ?? 'manuel override (UI)',
        ...assetTypePayload(h),
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

/** KAP PDF — ana veri kaynağı (ham veri, onay gerektirmez, sync ezmez) */
export function upsertFundHoldingKapPdf(h: FundHoldingDraft): Promise<WriteResult> {
  return write('upsertFundHoldingKapPdf', () =>
    supabase.from('fund_holdings').upsert(
      {
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: 'kap-pdf',
        notes: h.notes ?? 'KAP PDF (ana kaynak, ham veri)',
        ...assetTypePayload(h),
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

/** Otomatik araştırma: source='auto' — sync job'u ezebilir, manuel/kap-pdf değil. */
export function upsertFundHoldingAuto(h: FundHoldingDraft & { source?: 'auto' | 'fintables' | 'rotaborsa' | 'kap-pdf' }): Promise<WriteResult> {
  return write('upsertFundHoldingAuto', () =>
    supabase.from('fund_holdings').upsert(
      {
        fund_code: h.fund_code,
        ticker: h.ticker,
        company_name: h.company_name ?? null,
        weight_pct: h.weight_pct,
        as_of_date: h.as_of_date,
        source: (h as any).source ?? 'auto',
        notes: h.notes ?? 'otomatik araştırma (fintables/rotaborsa)',
        ...assetTypePayload(h),
      },
      { onConflict: 'user_id,fund_code,ticker' }
    )
  );
}

export function deleteFundHolding(id: string): Promise<WriteResult> {
  return write('deleteFundHolding', () =>
    supabase.from('fund_holdings').delete().eq('id', id)
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
  return write('approveProposal', () =>
    supabase.from('fund_holding_proposals').update({ status: 'approved' }).eq('id', id)
  );
}

export function rejectProposal(id: string): Promise<WriteResult> {
  return write('rejectProposal', () =>
    supabase.from('fund_holding_proposals').update({ status: 'rejected' }).eq('id', id)
  );
}

