/**
 * marketData.ts — fiyat beslemesi testleri
 *
 * Bu dosya, fon içeriği (fund_holdings) 100+ satıra çıkınca ortaya çıkan iki
 * hatayı kilitler:
 *
 *  1. KOD TAVANI: getStockQuotes / getFundQuotes / getMixedQuotes kodları
 *     `.slice(0, 60)` ile kırpıyordu. THF 77 + TLY 30 + DFI 4 = 111 satır
 *     olduğunda 51 kod fiyat alamıyor ve arayüzde etki sütunu SESSİZCE "—"
 *     kalıyordu. Şimdi tavan QUOTE_LIMIT (300).
 *
 *  2. EŞZAMANLILIK: `Promise.all(missing.map(...))` tüm kodları aynı anda
 *     ateşliyordu — 111 kod = Yahoo'ya 111 eşzamanlı istek = ban. Şimdi
 *     FETCH_CONCURRENCY (6).
 *
 * Ayrıca fon NAV cache'inin asimetrik TTL'i test edilir: başarılı sonuç 24 saat
 * (TEFAS günde bir açıklar), başarısız sonuç 5 dakika (fonaly geçici çökerse
 * arayüz tüm gün "VERİ EKSİK" göstermesin).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getFundQuotes,
  getStockQuotes,
  getMixedQuotes,
  toYahooSymbol,
  __resetQuoteCaches,
} from './marketData';

/** fonaly'nin parse ettiği biçim: "güncel fon fiyatı 7.730,551937 ₺, günlük getiri +1,56%" */
function fonalyHtml(price: string, change: string): string {
  return `<html><head><title>Fon</title></head><body>
    <p>güncel fon fiyatı ${price} ₺, günlük getiri ${change}%</p>
  </body></html>`;
}

/** Yahoo chart API biçimi */
function yahooJson(close: number, prevClose: number, time: number): string {
  return JSON.stringify({
    chart: {
      result: [{
        meta: { regularMarketPrice: close, chartPreviousClose: prevClose, regularMarketTime: time },
      }],
      error: null,
    },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let peakInFlight = 0;
let currentInFlight = 0;
let urlLog: string[] = [];

/**
 * 2026-09-03 PERŞEMBE 12:00 Istanbul (= 09:00 UTC) — seans AÇIK.
 *
 * marketData.ts artık isBistOpen() kontrolü yaptığı için testler saate
 * bağımlı hale geldi: akşam 18:00'dan sonra koşulsa getStockQuotes hiçbir
 * kod için dışarı çıkmaz ve tüm testler düşerdi. Bu yüzden sistem saati
 * SEANS İÇİ bir ana sabitleniyor; kapalı-seans davranışı ayrı describe'da.
 */
const OPEN_NOW = new Date('2026-09-03T09:00:00Z');   // Per 12:00 Istanbul
const CLOSED_NOW = new Date('2026-09-03T17:30:00Z'); // Per 20:30 Istanbul

beforeEach(() => {
  __resetQuoteCaches();
  peakInFlight = 0;
  currentInFlight = 0;
  urlLog = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(OPEN_NOW);

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urlLog.push(url);
    currentInFlight++;
    peakInFlight = Math.max(peakInFlight, currentInFlight);
    // Ağ gecikmesini taklit et — eşzamanlılık sınırı ancak böyle ölçülür
    await new Promise((r) => setTimeout(r, 5));
    currentInFlight--;

    if (url.includes('fonaly.com')) {
      const code = url.split('/funds/')[1]?.toUpperCase() ?? '';
      if (code === 'YOK') return new Response('not found', { status: 404 });
      return new Response(fonalyHtml('10,5', '+1,25'), { status: 200 });
    }
    if (url.includes('finance.yahoo.com')) {
      const sym = url.split('/chart/')[1]?.split('?')[0] ?? '';
      if (sym === 'YOK.IS') return new Response('nope', { status: 404 });
      return new Response(yahooJson(110, 100, Math.floor(Date.now() / 1000)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('?', { status: 404 });
  });

  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function codes(n: number, prefix = 'K'): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
}

describe('toYahooSymbol', () => {
  it('BIST koduna .IS ekler', () => {
    expect(toYahooSymbol('OZATD')).toBe('OZATD.IS');
  });
  it('zaten sonekliyse dokunmaz', () => {
    expect(toYahooSymbol('THYAO.IS')).toBe('THYAO.IS');
  });
});

describe('kod tavanı (eski hata: 60)', () => {
  it('getFundQuotes 150 kodun HEPSİNİ dener', async () => {
    const list = codes(150, 'F');
    const res = await getFundQuotes(list);
    expect(Object.keys(res)).toHaveLength(150);
    const fonalyCalls = urlLog.filter((u) => u.includes('fonaly.com'));
    expect(fonalyCalls.length).toBe(150);
  });

  it('getStockQuotes 150 kodun HEPSİNİ dener', async () => {
    const list = codes(150, 'S');
    const res = await getStockQuotes(list);
    expect(Object.keys(res)).toHaveLength(150);
    expect(urlLog.filter((u) => u.includes('yahoo.com')).length).toBe(150);
  });

  it('getMixedQuotes 111 kodu kırpmaz (THF 77 + TLY 30 + DFI 4 senaryosu)', async () => {
    const list = codes(111, 'M');
    const res = await getMixedQuotes(list);
    expect(Object.keys(res)).toHaveLength(111);
    // Hiçbir kod null kalmamalı — eski davranışta 51 kod null dönüyordu
    const nulls = Object.values(res).filter((q) => q === null);
    expect(nulls).toHaveLength(0);
  });

  it('300 üzeri istek yine de sınırlanır (ban koruması duruyor)', async () => {
    const list = codes(350, 'X');
    const res = await getFundQuotes(list);
    expect(Object.keys(res).length).toBeLessThanOrEqual(300);
  });
});

describe('eşzamanlılık sınırı (eski hata: hepsi birden)', () => {
  it('aynı anda en fazla 6 dış istek uçuşta', async () => {
    await getFundQuotes(codes(60, 'C'));
    expect(peakInFlight).toBeLessThanOrEqual(6);
    expect(peakInFlight).toBeGreaterThan(1); // gerçekten paralel çalışıyor
  });

  it('hisse tarafında da 6 sınırı geçerli', async () => {
    await getStockQuotes(codes(60, 'D'));
    expect(peakInFlight).toBeLessThanOrEqual(6);
  });
});

describe('fon NAV cache — asimetrik TTL', () => {
  it('başarılı sonuç cache\'lenir: ikinci çağrı istek atmaz', async () => {
    await getFundQuotes(['ABG']);
    const first = urlLog.length;
    const again = await getFundQuotes(['ABG']);
    expect(urlLog.length).toBe(first); // yeni istek yok
    expect(again.ABG?.changePct).toBeCloseTo(1.25, 4);
  });

  it('başarılı cache 24 saat dayanır (23 saat sonra hâlâ taze)', async () => {
    // Yalnızca Date sahtelenir: fetch mock'u setTimeout ile gecikme taklit ediyor,
    // setTimeout da sahtelenirse promise hiç çözülmüyor ve test asılıyor.
    vi.useFakeTimers({ toFake: ['Date'] });
    await getFundQuotes(['ABG']);
    const before = urlLog.length;
    vi.advanceTimersByTime(23 * 3600 * 1000);
    await getFundQuotes(['ABG']);
    expect(urlLog.length).toBe(before);
  });

  it('başarılı cache 25 saatte düşer (TEFAS yeni NAV açıkladı)', async () => {
    // Yalnızca Date sahtelenir: fetch mock'u setTimeout ile gecikme taklit ediyor,
    // setTimeout da sahtelenirse promise hiç çözülmüyor ve test asılıyor.
    vi.useFakeTimers({ toFake: ['Date'] });
    await getFundQuotes(['ABG']);
    const before = urlLog.length;
    vi.advanceTimersByTime(25 * 3600 * 1000);
    await getFundQuotes(['ABG']);
    expect(urlLog.length).toBeGreaterThan(before);
  });

  it('BAŞARISIZ sonuç yalnızca 5 dk cache\'lenir — 10 dk sonra tekrar dener', async () => {
    // Yalnızca Date sahtelenir: fetch mock'u setTimeout ile gecikme taklit ediyor,
    // setTimeout da sahtelenirse promise hiç çözülmüyor ve test asılıyor.
    vi.useFakeTimers({ toFake: ['Date'] });
    const first = await getFundQuotes(['YOK']);
    expect(first.YOK).toBeNull();
    const before = urlLog.length;

    // 3 dk sonra hâlâ cache'te → yeni istek yok
    vi.advanceTimersByTime(3 * 60_000);
    await getFundQuotes(['YOK']);
    expect(urlLog.length).toBe(before);

    // 10 dk sonra cache düşmüş olmalı → tekrar dener
    vi.advanceTimersByTime(10 * 60_000);
    await getFundQuotes(['YOK']);
    expect(urlLog.length).toBeGreaterThan(before);
  });
});

describe('getMixedQuotes — fon önceliği', () => {
  it('fonaly dönerse Yahoo sonucu ezilmez (fon fiyatı öncelikli)', async () => {
    const res = await getMixedQuotes(['ABG']);
    // fonaly +1,25 döndü; Yahoo +10 döndürürdü (110/100)
    expect(res.ABG?.changePct).toBeCloseTo(1.25, 4);
  });

  it('fonaly bulamazsa Yahoo\'ya düşer', async () => {
    const res = await getMixedQuotes(['YOK']);
    // fonaly 404 → null; Yahoo YOK.IS de 404 → null
    expect(res.YOK).toBeNull();
  });

  it('çözülemeyen kod null kalır, uydurma yapılmaz', async () => {
    const res = await getMixedQuotes(['YOK']);
    expect(res.YOK).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* SEANS SAATLERİ — dış veri kaynağına istek atma penceresi            */
/* ------------------------------------------------------------------ */
describe('seans kapalıyken dış istek atılmaz', () => {
  it('getStockQuotes kapalı seansda HİÇ fetch yapmaz, null döner', async () => {
    vi.setSystemTime(CLOSED_NOW); // Per 20:30 Istanbul
    const r = await getStockQuotes(['THYAO', 'GARAN']);
    expect(urlLog.filter((u) => u.includes('yahoo'))).toHaveLength(0);
    expect(r.THYAO).toBeNull();
    expect(r.GARAN).toBeNull();
  });

  it('getFundQuotes kapalı seansda HİÇ fetch yapmaz (5 dk neg-cache döngüsü durur)', async () => {
    vi.setSystemTime(CLOSED_NOW);
    await getFundQuotes(['ABG', 'PSE']);
    expect(urlLog.filter((u) => u.includes('fonaly'))).toHaveLength(0);
  });

  it('getMixedQuotes kapalı seansda toplam SIFIR dış istek atar', async () => {
    vi.setSystemTime(CLOSED_NOW);
    await getMixedQuotes(['THYAO', 'ABG', 'GARAN']);
    expect(urlLog).toHaveLength(0);
  });

  it('açık seansta aynı kodlar fetch edilir (gate fazla kaçırmıyor)', async () => {
    vi.setSystemTime(OPEN_NOW); // Per 12:00 Istanbul
    await getStockQuotes(['THYAO']);
    expect(urlLog.filter((u) => u.includes('yahoo'))).toHaveLength(1);
  });

  it('hafta sonu da kapalı sayılır — Cumartesi 12:00', async () => {
    vi.setSystemTime(new Date('2026-09-05T09:00:00Z')); // Cmt 12:00 Istanbul
    await getStockQuotes(['THYAO']);
    expect(urlLog).toHaveLength(0);
  });

  it('sıcak cache kapalıyken de servis edilir (kapanış fiyatı ekranda kalır)', async () => {
    // 1) açıkken doldur
    vi.setSystemTime(OPEN_NOW);
    await getStockQuotes(['THYAO']);
    expect(urlLog.filter((u) => u.includes('yahoo'))).toHaveLength(1);

    // 2) seans kapansın — TTL (60 sn) çoktan geçmiş olsa bile cache verilmeli
    vi.setSystemTime(new Date(OPEN_NOW.getTime() + 3 * 3600_000)); // +3 saat = 15:00... açık
    vi.setSystemTime(CLOSED_NOW); // 20:30 → kapalı, TTL 60sn çoktan geçmiş
    urlLog = [];
    const r = await getStockQuotes(['THYAO']);
    expect(urlLog).toHaveLength(0);
    expect(r.THYAO).not.toBeNull();
  });
});
