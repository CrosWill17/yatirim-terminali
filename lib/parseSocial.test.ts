import { describe, it, expect } from 'vitest';
import { parseSocialTweet, KNOWN_SYMBOLS } from './parseSocial';

describe('parseSocialTweet — @sevketozhan formatları', () => {
  it('FORMAT A: "#TLY 0,53" → tahmin, virgül ondalık, % yok', () => {
    const p = parseSocialTweet('#TLY 0,53');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.53);
    expect(p.hasPercentSign).toBe(false);
    expect(p.rawText).toBe('#TLY 0,53');
  });

  it('FORMAT B: "#TLY +0.8218%" → gerçekleşen, nokta ondalık, % var', () => {
    const p = parseSocialTweet('#TLY +0.8218%');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.8218);
    expect(p.hasPercentSign).toBe(true);
  });

  it('FORMAT B negatif: "#DFI -0.24%"', () => {
    const p = parseSocialTweet('#DFI -0.24%');
    expect(p.fundCode).toBe('DFI');
    expect(p.value).toBe(-0.24);
    expect(p.hasPercentSign).toBe(true);
  });

  it('hashtag + iki nokta: "#TLY: 0.53"', () => {
    const p = parseSocialTweet('#TLY: 0.53');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.53);
  });

  it('küçük harf hashtag: "#tly 0,53" → TLY', () => {
    const p = parseSocialTweet('#tly 0,53');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.53);
  });

  it('metin içinde: "bugün #KGM 0.12 olur" → KGM 0.12', () => {
    const p = parseSocialTweet('bugün #KGM 0.12 olur');
    expect(p.fundCode).toBe('KGM');
    expect(p.value).toBe(0.12);
    expect(p.hasPercentSign).toBe(false);
  });

  it('@handle tespiti: "@foo #TLY 0,53"', () => {
    const p = parseSocialTweet('@foo #TLY 0,53');
    expect(p.predictorHandle).toBe('@foo');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.53);
  });
});

describe('parseSocialTweet — legacy serbest metin', () => {
  it('sonda %: "TLY bugün 0.45% bekliyorum"', () => {
    const p = parseSocialTweet('TLY bugün 0.45% bekliyorum');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.45);
    expect(p.hasPercentSign).toBe(true);
  });

  it('başta %: "TLY %1.2 olabilir"', () => {
    const p = parseSocialTweet('TLY %1.2 olabilir');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(1.2);
    expect(p.hasPercentSign).toBe(true);
  });

  it('yüzde kelimesi: "TLY yüzde 0.45"', () => {
    const p = parseSocialTweet('TLY yüzde 0.45');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBe(0.45);
    expect(p.hasPercentSign).toBe(false);
  });
});

describe('parseSocialTweet — Kural 4 (uydurma yok) & sınırlar', () => {
  it('kod var sayı yok → value=null (VERİ EKSİK): "#KGM bugün hareketli"', () => {
    const p = parseSocialTweet('#KGM bugün hareketli');
    expect(p.fundCode).toBe('KGM');
    expect(p.value).toBeNull();
  });

  it('finans sinyali yok → fundCode=null: "Bugün hava güzel"', () => {
    const p = parseSocialTweet('Bugün hava güzel');
    expect(p.fundCode).toBeNull();
    expect(p.value).toBeNull();
  });

  it('mantıksız büyüklük → value=null (sanity): "#TLY 53"', () => {
    const p = parseSocialTweet('#TLY 53');
    expect(p.fundCode).toBe('TLY');
    expect(p.value).toBeNull();
  });

  it('kod olmadan sayı → fundCode=null (sadece sayı finans sinyali değildir)', () => {
    const p = parseSocialTweet('0.45%');
    expect(p.fundCode).toBeNull();
  });
});

describe('parseSocialTweet — kategori', () => {
  it('varsayılan GUNLUK_GETIRI', () => {
    expect(parseSocialTweet('#TLY 0,53').category).toBe('GUNLUK_GETIRI');
  });
  it('KAP sinyali', () => {
    expect(parseSocialTweet('KAP bildirimi: #TLY 0,53').category).toBe('KAP_DUYURUSU');
  });
});

describe('parseSocialTweet — KNOWN_SYMBOLS tutarlılığı', () => {
  it('portföydeki 8 kod listede', () => {
    for (const s of ['BURCE', 'MASFN', 'SARAE', 'EKIM', 'TLY', 'DFI', 'KGM', 'TP2']) {
      expect(KNOWN_SYMBOLS).toContain(s);
    }
  });
});
