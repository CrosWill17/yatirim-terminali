/**
 * P1 — MİSAFİR MODU: HALKA AÇIK İZLEME LİSTESİ TESTLERİ
 *
 * Kritik kural: portföye ait HİÇBİR kod misafir listesine sızmamalı.
 */

import { describe, it, expect } from 'vitest';
import {
  PUBLIC_WATCHLIST, PUBLIC_PRECIOUS, PUBLIC_YAHOO_SYMBOLS,
  FORBIDDEN_FOR_GUEST, publicInstruments,
} from './publicWatchlist';

const EXPECTED_STOCKS = [
  'THYAO', 'GARAN', 'AKBNK', 'YKBNK', 'ISCTR', 'ASELS', 'TUPRS',
  'SASA', 'KCHOL', 'PETKM', 'EREGL', 'BIMAS', 'TCELL', 'ARCLK',
];

describe('halka açık hisse listesi', () => {
  it('beklenen 14 hisseyi içerir', () => {
    const codes = PUBLIC_WATCHLIST.map((i) => i.symbol);
    for (const c of EXPECTED_STOCKS) expect(codes).toContain(c);
  });

  it('kodlar tekil ve tümü HISSE türünde', () => {
    const codes = PUBLIC_WATCHLIST.map((i) => i.symbol);
    expect(new Set(codes).size).toBe(codes.length);
    expect(PUBLIC_WATCHLIST.every((i) => i.kind === 'HISSE')).toBe(true);
  });

  it('her satırda ad ve Yahoo sembolü dolu', () => {
    for (const i of PUBLIC_WATCHLIST) {
      expect(i.name.length).toBeGreaterThan(2);
      expect(i.yahoo.length).toBeGreaterThan(2);
      expect(i.group.length).toBeGreaterThan(2);
    }
  });

  it('BIST hisseleri .IS sonekiyle istenir', () => {
    expect(PUBLIC_WATCHLIST.every((i) => i.yahoo.endsWith('.IS'))).toBe(true);
  });
});

describe('altın / gümüş listesi', () => {
  it('altın ve gümüş satırları var', () => {
    expect(PUBLIC_PRECIOUS.some((i) => i.kind === 'ALTIN')).toBe(true);
    expect(PUBLIC_PRECIOUS.some((i) => i.kind === 'GUMUS')).toBe(true);
  });

  it('doğrulanmamış ticker verified=false işaretli (uydurma fiyat riski yok)', () => {
    const unverified = PUBLIC_PRECIOUS.filter((i) => !i.verified);
    expect(unverified.length).toBeGreaterThan(0);
    for (const i of unverified) expect(i.name).toMatch(/doğrulanmadı/i);
  });

  it('spot satırları doğrulanmış', () => {
    const spot = PUBLIC_PRECIOUS.filter((i) => ['XAU_GRAM', 'XAU_ONS', 'XAG_ONS'].includes(i.symbol));
    expect(spot).toHaveLength(3);
    expect(spot.every((i) => i.verified)).toBe(true);
  });
});

describe('portföy sızıntısı yok', () => {
  it('portföy kodları halka açık listede YOK', () => {
    const all = publicInstruments().map((i) => i.symbol.toUpperCase());
    for (const secret of FORBIDDEN_FOR_GUEST) expect(all).not.toContain(secret);
  });

  it('portföy kodları Yahoo sembol listesinde de YOK', () => {
    for (const secret of FORBIDDEN_FOR_GUEST) {
      expect(PUBLIC_YAHOO_SYMBOLS.map((s) => s.toUpperCase())).not.toContain(secret);
      expect(PUBLIC_YAHOO_SYMBOLS.map((s) => s.toUpperCase())).not.toContain(`${secret}.IS`);
    }
  });

  it('adlarda da portföy fon/hisse adı geçmiyor', () => {
    const names = publicInstruments().map((i) => i.name.toUpperCase()).join(' | ');
    expect(names).not.toContain('BURÇELIK');
    expect(names).not.toContain('TERA PORTFÖY BİRİNCİ');
    expect(names).not.toContain('ATLAS PORTFÖY SERBEST');
    expect(names).not.toContain('MASFEN');
    expect(names).not.toContain('SA-RARA');
    expect(names).not.toContain('EKİM TURİZM');
  });

  it('Yahoo sembol listesi tekil', () => {
    expect(new Set(PUBLIC_YAHOO_SYMBOLS).size).toBe(PUBLIC_YAHOO_SYMBOLS.length);
  });
});
