/**
 * ŞEMA UYUMLULUK TESTLERİ
 *
 * Regresyon hedefi (gerçek arıza): twitter-sync her 30 dakikada
 *   "column social_predictions.user_id does not exist"
 * hatasıyla düşüyordu; job, RLS migrasyonunun uygulandığını VARSAYIYORDU.
 * Buradaki testler "varsayma, yokla" davranışını kilitler.
 */

import { describe, it, expect } from 'vitest';
import {
  isMissingColumnError,
  isDuplicateError,
  withOwner,
  withOwnerAll,
  conflictTarget,
  scopeToOwner,
  hasUserIdColumn,
  legacySchemaWarning,
} from './dbCompat';

const OWNER = '11111111-2222-3333-4444-555555555555';

/** Yoklama sorgusunu taklit eden en küçük istemci. */
function probeClient(error: { code?: string; message?: string } | null) {
  const calls: { table: string; cols: string; limit: number }[] = [];
  const client = {
    from(table: string) {
      return {
        select(cols: string) {
          return {
            limit(n: number) {
              calls.push({ table, cols, limit: n });
              return Promise.resolve({ error });
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('isMissingColumnError', () => {
  it('PostgreSQL 42703 kodunu tanır', () => {
    expect(isMissingColumnError({ code: '42703', message: 'boş' })).toBe(true);
  });

  it('canlıda görülen gerçek mesajı tanır', () => {
    expect(
      isMissingColumnError({ message: 'column social_predictions.user_id does not exist' }),
    ).toBe(true);
  });

  it('PostgREST schema cache mesajını tanır', () => {
    expect(
      isMissingColumnError({ message: "Could not find the 'user_id' column of 'fund_holdings' in the schema cache" }),
    ).toBe(true);
  });

  it('alakasız hatayı sütun hatası sanmaz', () => {
    expect(isMissingColumnError({ message: 'fetch failed' })).toBe(false);
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe('isDuplicateError', () => {
  it('23505 ve metin varyantlarını tanır', () => {
    expect(isDuplicateError({ code: '23505' })).toBe(true);
    expect(isDuplicateError({ message: 'duplicate key value violates unique constraint' })).toBe(true);
    expect(isDuplicateError({ message: 'row already exists' })).toBe(true);
  });

  it('başka hatayı yinelenen sanmaz', () => {
    expect(isDuplicateError({ message: 'column x does not exist' })).toBe(false);
  });
});

describe('withOwner / withOwnerAll', () => {
  it('yeni şemada user_id ekler', () => {
    expect(withOwner({ fund_code: 'TLY' }, OWNER, true)).toEqual({ fund_code: 'TLY', user_id: OWNER });
  });

  it('legacy şemada user_id EKLEMEZ (olmayan sütun PGRST204 verirdi)', () => {
    const row = withOwner({ fund_code: 'TLY' }, OWNER, false);
    expect(row).toEqual({ fund_code: 'TLY' });
    expect('user_id' in row).toBe(false);
  });

  it('girdi satırını mutasyona uğratmaz', () => {
    const src = { fund_code: 'TLY' };
    withOwner(src, OWNER, true);
    expect(src).toEqual({ fund_code: 'TLY' });
  });

  it('dizi hâli tüm satırlara uygulanır', () => {
    const rows = [{ ticker: 'THYAO' }, { ticker: 'ASELS' }];
    expect(withOwnerAll(rows, OWNER, true)).toEqual([
      { ticker: 'THYAO', user_id: OWNER },
      { ticker: 'ASELS', user_id: OWNER },
    ]);
    expect(withOwnerAll(rows, OWNER, false)).toEqual(rows);
  });
});

describe('conflictTarget', () => {
  it('yeni şemada tekil kısıt user_id ile bileşiktir', () => {
    expect(conflictTarget(['fund_code', 'ticker'], true)).toBe('user_id,fund_code,ticker');
  });

  it('legacy şemada user_id içermez', () => {
    expect(conflictTarget(['fund_code', 'ticker'], false)).toBe('fund_code,ticker');
  });
});

describe('scopeToOwner', () => {
  function fakeQuery() {
    const eqCalls: [string, unknown][] = [];
    const q: any = {
      eq(col: string, val: unknown) {
        eqCalls.push([col, val]);
        return q;
      },
    };
    return { q, eqCalls };
  }

  it('sütun varsa sorguyu sahibe daraltır', () => {
    const { q, eqCalls } = fakeQuery();
    scopeToOwner(q, OWNER, true);
    expect(eqCalls).toEqual([['user_id', OWNER]]);
  });

  it('sütun yoksa filtre EKLEMEZ (42703 böyle önlenir)', () => {
    const { q, eqCalls } = fakeQuery();
    const out = scopeToOwner(q, OWNER, false);
    expect(eqCalls).toEqual([]);
    expect(out).toBe(q);
  });

  it('zincirlemeye izin verir (dönen nesne yine sorgudur)', () => {
    const { q, eqCalls } = fakeQuery();
    scopeToOwner(q, OWNER, true).eq('fund_code', 'TLY');
    expect(eqCalls).toEqual([
      ['user_id', OWNER],
      ['fund_code', 'TLY'],
    ]);
  });
});

describe('hasUserIdColumn', () => {
  it('hata yoksa sütun VAR', async () => {
    const { client, calls } = probeClient(null);
    await expect(hasUserIdColumn(client, 'social_predictions')).resolves.toBe(true);
    expect(calls).toEqual([{ table: 'social_predictions', cols: 'user_id', limit: 1 }]);
  });

  it('canlıdaki gerçek hata mesajında sütun YOK', async () => {
    const { client } = probeClient({ message: 'column social_predictions.user_id does not exist' });
    await expect(hasUserIdColumn(client, 'social_predictions')).resolves.toBe(false);
  });

  it('ağ/izin hatasında GÜVENLİ TARAF: VAR kabul eder (yalıtım kazara kapanmasın)', async () => {
    const { client } = probeClient({ message: 'TypeError: fetch failed' });
    await expect(hasUserIdColumn(client, 'social_predictions')).resolves.toBe(true);
  });
});

describe('legacySchemaWarning', () => {
  it('tablo adını ve uygulanacak migrasyonu söyler', () => {
    const w = legacySchemaWarning('social_predictions');
    expect(w).toContain('social_predictions');
    expect(w).toContain('supabase_rls_user_isolation.sql');
  });
});
