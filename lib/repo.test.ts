/**
 * P0 — KALICILIK GÜVENLİĞİ TESTLERİ
 *
 * Ana hedef: supabase-js'in döndürdüğü { data, error } içindeki `error` artık
 * YUTULMUYOR. Her yazma fonksiyonu { ok: false, error } döndürmeli;
 * loadAll() hata durumunda "connected" gibi görünmemeli.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mock = vi.hoisted(() => ({
  error: null as { message: string; code?: string; status?: number } | null,
  /** Tablo bazlı veri: tabloData['portfolio_positions'] vb. Tanımsızsa []. */
  tableData: {} as Record<string, any[]>,
  configured: true,
  calls: [] as string[],
  /** Yazma çağrılarının gövdeleri: { table, op, payload, options } */
  payloads: [] as { table: string; op: string; payload?: any; options?: any }[],
}));

vi.mock('./supabase', () => {
  const makeBuilder = (table: string): any => {
    const rec = (op: string, payload?: any, options?: any) => {
      mock.calls.push(`${op}:${table}`);
      mock.payloads.push({ table, op, payload, options });
    };
    const b: any = {
      upsert: (payload?: any, options?: any) => { rec('upsert', payload, options); return b; },
      insert: (payload?: any) => { rec('insert', payload); return b; },
      update: (payload?: any) => { rec('update', payload); return b; },
      delete: () => { rec('delete'); return b; },
      select: () => { rec('select'); return b; },
      order: () => b,
      eq: () => b,
      limit: () => b,
      in: () => b,
      // supabase builder'ları thenable'dır — repo sonucu await eder
      then: (res: any, rej: any) =>
        Promise.resolve({ data: mock.tableData[table] ?? [], error: mock.error }).then(res, rej),
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => makeBuilder(table),
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    },
    isSupabaseConfigured: () => mock.configured,
  };
});

import {
  loadAll, upsertPosition, upsertDecision, insertTransaction, insertCashMovement,
  insertPrediction, updatePrediction, setInitialCapital, saveDailySnapshot,
  upsertFundHolding, deleteFundHolding, classifySupabaseError,
} from './repo';
import type { Position, Decision, Transaction, CashMovement, SocialPrediction } from './types';

const pos: Position = {
  id: '1', symbol: 'THYAO', asset_name: 'Türk Hava Yolları A.O.', asset_type: 'BIST_HISSE',
  quantity: 10, unit_cost: 100, risk_score: 5, current_action: 'TUT', rationale: '', is_active: true,
};
const dec: Decision = {
  id: 'k1', symbol: 'THYAO', action_type: 'TUT', status: 'bekliyor', risk_score: 5,
  details: '', created_at: '2026-08-28',
};
const txn: Transaction = {
  id: 't1', symbol: 'THYAO', transaction_type: 'ALIS', quantity: 10, unit_price: 100,
  total_amount: 1000, withholding_tax: 0, net_amount: 1000, realized_pnl: 0, created_at: '2026-08-28T10:00:00Z',
};
const cash: CashMovement = {
  id: 'c1', movement_type: 'ALIS', amount: -1000, balance_after: 5000, description: '', category: 'ISLEM',
  created_at: '2026-08-28T10:00:00Z',
};
const pred: SocialPrediction = {
  id: 'p1', predictor_handle: '@x', fund_code: 'TLY', predicted_return_pct: 0.5,
  prediction_category: 'GUNLUK_GETIRI', raw_text: 'x', prediction_date: '2026-08-28', status: 'BEKLIYOR',
};

const RLS_ERROR = { message: 'new row violates row-level security policy for table "portfolio_positions"', code: '42501' };

beforeEach(() => {
  mock.error = null;
  mock.tableData = {};
  mock.configured = true;
  mock.calls = [];
  mock.payloads = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('P0 — yazma fonksiyonları hatayı geri döndürür (sessiz yutma yok)', () => {
  const cases: [string, () => Promise<any>][] = [
    ['upsertPosition', () => upsertPosition(pos)],
    ['upsertDecision', () => upsertDecision(dec)],
    ['insertTransaction', () => insertTransaction(txn)],
    ['insertCashMovement', () => insertCashMovement(cash)],
    ['insertPrediction', () => insertPrediction(pred)],
    ['updatePrediction', () => updatePrediction(pred)],
    ['setInitialCapital', () => setInitialCapital(678000)],
    ['saveDailySnapshot', () => saveDailySnapshot('2026-08-28', 1000, 500, { NAKİT: 500 })],
    ['upsertFundHolding', () => upsertFundHolding({ fund_code: 'TLY', ticker: 'OZATD', weight_pct: 34.27, as_of_date: '2026-07-31' })],
    ['deleteFundHolding', () => deleteFundHolding('11111111-1111-1111-1111-111111111111')],
  ];

  it.each(cases)('%s başarılıysa { ok: true }', async (_name, fn) => {
    mock.error = null;
    await expect(fn()).resolves.toEqual({ ok: true });
  });

  it.each(cases)('%s RLS hatasında { ok: false, kind: rls }', async (_name, fn) => {
    mock.error = RLS_ERROR;
    const res = await fn();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('rls');
      expect(res.error.message).toContain('row-level security');
    }
  });

  it('her yazma hatası console.warn ile de loglanır', async () => {
    mock.error = RLS_ERROR;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await upsertPosition(pos);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('upsertPosition');
  });
});

describe('P0 — Supabase yapılandırılmadıysa "çalışıyor" gibi görünmez', () => {
  it('yazma kind=setup hatası döndürür', async () => {
    mock.configured = false;
    const res = await upsertPosition(pos);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('setup');
  });

  it('loadAll kind=setup hatası döndürür (bundle yok)', async () => {
    mock.configured = false;
    const res = await loadAll();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('setup');
  });
});

describe('P0 — loadAll hatayı bildirir, sahte connected yok', () => {
  it('tablo yoksa ok:false + kind=not_found', async () => {
    mock.error = { message: 'relation "public.portfolio_positions" does not exist', code: '42P01' };
    const res = await loadAll();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.kind).toBe('not_found');
      expect(res.error.operation).toContain('portfolio_positions');
    }
  });

  it('RLS reddinde ok:false + kind=rls', async () => {
    mock.error = RLS_ERROR;
    const res = await loadAll();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('rls');
  });

  it('başarılı okumada bundle döner (fundHoldings dahil)', async () => {
    mock.error = null;
    mock.tableData = {
      fund_holdings: [
        {
          id: 'h1', fund_code: 'TLY', ticker: 'OZATD', company_name: 'Ozata Denizcilik',
          weight_pct: 34.27, as_of_date: '2026-07-31T00:00:00Z', source: 'auto',
          notes: 'KAP aylık raporu | dışlanan: 3',
        },
      ],
      portfolio_positions: [
        {
          id: '1', symbol: 'THYAO', asset_name: 'Türk Hava Yolları A.O.', asset_type: 'BIST_HISSE',
          quantity: '10', unit_cost: '100.5', target_price: null, stop_price: null,
          risk_score: 5, current_action: 'TUT', rationale: '',
        },
      ],
    };
    const res = await loadAll();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bundle.fundHoldings).toHaveLength(1);
      expect(res.bundle.fundHoldings[0].weight_pct).toBeCloseTo(34.27, 4);
      expect(res.bundle.fundHoldings[0].as_of_date).toBe('2026-07-31');
      expect(res.bundle.positions).toHaveLength(1);
      expect(res.bundle.positions[0].quantity).toBe(10);
      expect(res.bundle.positions[0].unit_cost).toBeCloseTo(100.5, 4);
    }
  });
});

describe('P0 — hata sınıflandırma', () => {
  it('RLS mesajı → rls', () => {
    expect(classifySupabaseError('op', RLS_ERROR).kind).toBe('rls');
  });
  it('permission denied → rls', () => {
    expect(classifySupabaseError('op', { message: 'permission denied for table x' }).kind).toBe('rls');
  });
  it('tablo yok → not_found', () => {
    expect(classifySupabaseError('op', { message: 'could not find the table public.fund_holdings' }).kind).toBe('not_found');
  });
  it('401 → rls (oturum geçersiz)', () => {
    expect(classifySupabaseError('op', { message: 'invalid token', status: 401 }).kind).toBe('rls');
  });
  it('ağ hatası → network', () => {
    expect(classifySupabaseError('op', { message: 'fetch failed', status: 0 }).kind).toBe('network');
  });
  it('bilinmeyen → unknown, mesaj korunur', () => {
    const e = classifySupabaseError('op', { message: 'bambaşka bir sorun' });
    expect(e.kind).toBe('unknown');
    expect(e.message).toBe('bambaşka bir sorun');
    expect(e.operation).toBe('op');
  });
});

describe('P0 — fon içeriği yazma hedefi yalnız fund_holdings', () => {
  it('upsertFundHolding fund_holdings tablosuna yazar', async () => {
    await upsertFundHolding({ fund_code: 'DFI', ticker: 'TUPRS', weight_pct: 12, as_of_date: '2026-07-31' });
    expect(mock.calls).toContain('upsert:fund_holdings');
    expect(mock.calls.some((c) => c.includes('social_predictions'))).toBe(false);
  });

  it('deleteFundHolding fund_holdings tablosundan siler', async () => {
    await deleteFundHolding('x');
    expect(mock.calls).toContain('delete:fund_holdings');
  });
});

describe('P3 — manuel override kaynağı korunur', () => {
  it("upsertFundHolding source='manual' yazar ve (fund_code,ticker) üzerinde çakışma çözer", async () => {
    await upsertFundHolding({
      fund_code: 'DFI', ticker: 'TUPRS', company_name: 'Türkiye Petrol Rafinerileri A.Ş.',
      weight_pct: 12.5, as_of_date: '2026-07-31', notes: 'elle girildi',
    });
    const call = mock.payloads.find((c) => c.op === 'upsert' && c.table === 'fund_holdings');
    expect(call).toBeTruthy();
    expect(call!.payload.source).toBe('manual');
    expect(call!.payload.fund_code).toBe('DFI');
    expect(call!.payload.ticker).toBe('TUPRS');
    expect(call!.payload.weight_pct).toBeCloseTo(12.5, 4);
    expect(call!.options).toEqual({ onConflict: 'fund_code,ticker' });
  });

  it('pozisyon yazması yalnız portfolio_positions tablosuna gider', async () => {
    await upsertPosition(pos);
    const tables = new Set(mock.payloads.map((c) => c.table));
    expect(tables.size).toBe(1);
    expect(tables.has('portfolio_positions')).toBe(true);
  });

  it('tahmin yazması yalnız social_predictions tablosuna gider', async () => {
    await insertPrediction(pred);
    const tables = new Set(mock.payloads.map((c) => c.table));
    expect(Array.from(tables)).toEqual(['social_predictions']);
  });
});
