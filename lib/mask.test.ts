/**
 * P2 — GİZLİLİK MASKESİ TESTLERİ
 * Hassas (TL/adet) değerler maskelenir; kamu verisi (%, ad, endeks) maskelenmez.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MASK, MASK_STORAGE_KEY, formatSensitive, formatPublic, maskText,
  readMaskPreference, writeMaskPreference,
} from './mask';

describe('formatSensitive (TL tutarları ve adetler)', () => {
  it('maske kapalıyken tr-TR biçiminde değer + son ek', () => {
    expect(formatSensitive(1234567, false, { suffix: ' TL' })).toBe('1.234.567 TL');
    expect(formatSensitive(2.99, false, { digits: 4, minDigits: 2, suffix: ' TL' })).toBe('2,99 TL');
  });

  it('maske açıkken içerik hiç hesaplanmaz → **', () => {
    expect(formatSensitive(1234567, true, { suffix: ' TL' })).toBe(MASK);
    expect(formatSensitive(0, true)).toBe(MASK);
    expect(formatSensitive(-98765.43, true, { suffix: ' TL', signed: true })).toBe(MASK);
  });

  it('imzalı biçim: pozitifte + öneki', () => {
    expect(formatSensitive(1500, false, { signed: true })).toBe('+1.500');
    expect(formatSensitive(-1500, false, { signed: true })).toBe('-1.500');
  });

  it('null/undefined/NaN → — (uydurma değer yok)', () => {
    expect(formatSensitive(null, false)).toBe('—');
    expect(formatSensitive(undefined, false)).toBe('—');
    expect(formatSensitive(Number.NaN, false)).toBe('—');
  });

  it('özel fallback kullanılabilir', () => {
    expect(formatSensitive(null, false, { fallback: 'VERİ EKSİK' })).toBe('VERİ EKSİK');
  });
});

describe('formatPublic (kamuya açık veri — maskelenmez)', () => {
  it('fonksiyon maske parametresi almaz: yüzde her zaman görünür', () => {
    expect(formatPublic(12.345, { digits: 2 })).toBe('12,35');
    expect(formatPublic(-0.5, { signed: true })).toBe('-0,5');
    expect(formatPublic(0.45, { signed: true, percentSign: true })).toBe('%+0,45');
  });

  it('null → —', () => {
    expect(formatPublic(null)).toBe('—');
  });
});

describe('maskText (metin tabanlı hassas içerik)', () => {
  it('maske açıkken metin gizlenir', () => {
    expect(maskText('Kasa: 257.706 TL', true)).toBe(MASK);
    expect(maskText('Kasa: 257.706 TL', false)).toBe('Kasa: 257.706 TL');
  });
});

describe('maske tercihi localStorage\'da kalıcı', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('anahtar sabit: yt.mask.v1', () => {
    expect(MASK_STORAGE_KEY).toBe('yt.mask.v1');
  });

  it('varsayılan KAPALI', () => {
    expect(readMaskPreference()).toBe(false);
  });

  it('yaz → oku (refresh sonrası korunur)', () => {
    writeMaskPreference(true);
    expect(readMaskPreference()).toBe(true);
    expect(store.get(MASK_STORAGE_KEY)).toBe('1');
    writeMaskPreference(false);
    expect(readMaskPreference()).toBe(false);
    expect(store.get(MASK_STORAGE_KEY)).toBe('0');
  });

  it('localStorage erişilemezse çökmez, kapalı döner', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('SecurityError'); },
        setItem: () => { throw new Error('SecurityError'); },
      },
    });
    expect(readMaskPreference()).toBe(false);
    expect(() => writeMaskPreference(true)).not.toThrow();
  });
});
