import { describe, expect, it } from 'vitest';
import {
  computeFundPrediction,
  monthEndOfLabel,
  parseFintablesHoldings,
  parseRotaborsaHoldings,
  prevMonthEndOfDate,
  toHoldingRows,
  validateParsed,
} from './fundHoldings';

// ---------------------------------------------------------------------------
// Fixture: rotaborsa.com — "TLY fonu hisseleri" tablosu (gerçek sayfa yapısı, 26.08.2026)
// ---------------------------------------------------------------------------

const ROTABORSA_HTML = `
<html><body>
<p>26 Ağustos 2026, 11:47 güncellendi</p>
<h3>TLY fonu hisseleri</h3>
<table>
<thead>
  <tr><th>Hisse</th><th>Güncel Ağırlık (%)</th><th>Önceki Ağırlık (%)</th></tr>
</thead>
<tbody>
  <tr>
    <td><a href="/hiseler/ozatd">Özata Denizcilik Sanayi ve Ticaret A.Ş.</a> (OZATD)</td>
    <td>%34,27</td><td>%14,30</td>
  </tr>
  <tr>
    <td>Destek Finans Faktoring A.Ş. (DSTKF)</td>
    <td>%12,02</td><td>%22,85</td>
  </tr>
  <tr>
    <td>Tera Yatırım Teknoloji Holding A.Ş. (TEHOL)</td>
    <td>%9,22</td><td>%7,14</td>
  </tr>
  <tr>
    <td>Peker Gayrimenkul Yatırım Ortaklığı A.Ş. (PEKGY)</td>
    <td>%8,76</td><td>%7,73</td>
  </tr>
  <tr>
    <td>Tera Yatırım Menkul Değerler A.Ş. (TERA)</td>
    <td>%4,11</td><td>%6,63</td>
  </tr>
  <tr>
    <td>Tera Finansal Yatırımlar Holding A.Ş. (TRHOL)</td>
    <td>%4,01</td><td>%5,61</td>
  </tr>
  <tr>
    <td>Yapı ve Kredi Bankası A.Ş. (YKBNK)</td>
    <td>%0,03</td><td>%0,00</td>
  </tr>
  <tr>
    <td>Efor Yatırım Sanayi Ticaret A.Ş. (EFOR)</td>
    <td>%0,01</td><td>%0,00</td>
  </tr>
  <tr>
    <td>Birleşim Grup Enerji Yatırımları A.Ş. (BIGEN)</td>
    <td>%0,00</td><td>%0,00</td>
  </tr>
</tbody>
</table>
<table>
  <tr><td>Son Fiyat (TL)</td><td>9.022,019037</td></tr>
  <tr><td>Yatırımcı Sayısı</td><td>110.539</td></tr>
</table>
</body></html>`;

// ---------------------------------------------------------------------------
// Fixture: fintables.com/fonlar/DFI — pozisyon kartları (10.08.2026)
// ---------------------------------------------------------------------------

const FINTABLES_HTML = `
<div>
  <p>Fon hisse portföyü ile ilgili tüm veriler <strong>10 Ağustos</strong> tarihinde açıklanan
  <strong>Temmuz 2026</strong> portföy dağılım raporu baz alınarak hesaplanmıştır.</p>
  <h4>En Büyük Pozisyonlar</h4>
  <a href="https://fintables.com/sirketler/IEYHO">
    <img alt="Işıklar Enerji ve Yapı Holding A.Ş. Şirket Logosu" src="x.png">
    <div>IEYHO</div><div>%41,32</div><div>%-23,46</div>
  </a>
  <a href="https://fintables.com/sirketler/ISKPL">
    <img alt="Işık Plastik Sanayi ve Dış Ticaret Pazarlama A.Ş. Şirket Logosu" src="y.png">
    <div>ISKPL</div><div>%3,28</div><div>%-1,65</div>
  </a>
  <a href="https://fintables.com/sirketler/LIDER">
    <img alt="LDR Turizm A.Ş. Şirket Logosu" src="z.png">
    <div>LIDER</div><div>%0,19</div><div>%-0,15</div>
  </a>
  <h4>Azaltılan Pozisyonlar</h4>
  <a href="https://fintables.com/sirketler/IEYHO">
    <img alt="Işıklar Enerji ve Yapı Holding A.Ş. Şirket Logosu" src="x.png">
    <div>IEYHO</div><div>%41,32</div><div>%-23,46</div>
  </a>
</div>`;

// ---------------------------------------------------------------------------
// monthEndOfLabel
// ---------------------------------------------------------------------------

describe('monthEndOfLabel', () => {
  it('Temmuz 2026 → 2026-07-31', () => {
    expect(monthEndOfLabel('Temmuz 2026')).toBe('2026-07-31');
  });
  it('Ağustos 2026 → 2026-08-31 (büyük harf, noktasız)', () => {
    expect(monthEndOfLabel('Ağustos 2026')).toBe('2026-08-31');
  });
  it('Şubat 2026 → 2026-02-28 (artık yıl değil)', () => {
    expect(monthEndOfLabel('Şubat 2026')).toBe('2026-02-28');
  });
  it('Şubat 2028 → 2028-02-29 (artık yıl)', () => {
    expect(monthEndOfLabel('Şubat 2028')).toBe('2028-02-29');
  });
  it('çözülemez → null', () => {
    expect(monthEndOfLabel('bilinmeyen dönem 1999')).toBeNull();
  });
});

describe('prevMonthEndOfDate', () => {
  it('Ağustos 2026 güncellemesi → Temmuz sonu', () => {
    expect(prevMonthEndOfDate('26', 'Ağustos', '2026')).toBe('2026-07-31');
  });
  it('Ocak 2026 güncellemesi → Aralık 2025 sonu (yıl değişimi)', () => {
    expect(prevMonthEndOfDate('5', 'Ocak', '2026')).toBe('2025-12-31');
  });
  it('geçersiz → null', () => {
    expect(prevMonthEndOfDate('99', 'Ağustos', '2026')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseRotaborsaHoldings
// ---------------------------------------------------------------------------

describe('parseRotaborsaHoldings', () => {
  const parsed = parseRotaborsaHoldings(ROTABORSA_HTML, 'TLY');

  it('8 hisse çözer (1 satır %0.01 filtresiyle dışlanır)', () => {
    expect(parsed.holdings).toHaveLength(8);
    expect(parsed.excludedCount).toBe(1);
  });

  it('ilk satır: OZATD %34,27, önceki %14,30, ad doğru', () => {
    const oz = parsed.holdings[0];
    expect(oz.ticker).toBe('OZATD');
    expect(oz.weightPct).toBeCloseTo(34.27, 4);
    expect(oz.prevWeightPct).toBeCloseTo(14.30, 4);
    expect(oz.name).toBe('Özata Denizcilik Sanayi ve Ticaret A.Ş.');
  });

  it('ağırlığa göre sıralıdır', () => {
    const w = parsed.holdings.map((h) => h.weightPct);
    expect([...w].sort((a, b) => b - a)).toEqual(w);
  });

  it('EFOR %0,01 kalır, BIGEN %0,00 dışlanır', () => {
    const efor = parsed.holdings.find((h) => h.ticker === 'EFOR');
    expect(efor?.weightPct).toBeCloseTo(0.01, 4);
    expect(parsed.holdings.some((h) => h.ticker === 'BIGEN')).toBe(false);
  });

  it('güncelleme tarihinden rapor dönemini çıkarır ("26 Ağustos 2026" güncellendi → Temmuz 2026 → 2026-07-31)', () => {
    expect(parsed.asOfDate).toBe('2026-07-31');
  });

  it('diğer tablolardaki (fiyat/yatırımcı) satırları hisse olarak almaz', () => {
    expect(parsed.holdings.some((h) => h.ticker === 'TL')).toBe(false);
    expect(parsed.holdings.every((h) => /^[A-Z]{2,5}$/.test(h.ticker))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseFintablesHoldings
// ---------------------------------------------------------------------------

describe('parseFintablesHoldings', () => {
  const parsed = parseFintablesHoldings(FINTABLES_HTML, 'DFI');

  it('3 hisse çözer (tekrar eden kart tekilleştirilir)', () => {
    expect(parsed.holdings).toHaveLength(3);
  });

  it('IEYHO %41,32 birincidir, ad "Şirket Logosu" eki olmadan', () => {
    const ileyho = parsed.holdings[0];
    expect(ileyho.ticker).toBe('IEYHO');
    expect(ileyho.weightPct).toBeCloseTo(41.32, 4);
    expect(ileyho.name).toBe('Işıklar Enerji ve Yapı Holding A.Ş.');
    // önceki ağırlık = güncel − değişim = 41.32 − (−23.46) = 64.78
    expect(ileyho.prevWeightPct).toBeCloseTo(64.78, 4);
  });

  it('rapor dönemi: Temmuz 2026 → 2026-07-31 + etiket', () => {
    expect(parsed.asOfDate).toBe('2026-07-31');
    expect(parsed.reportLabel).toContain('Temmuz 2026');
  });
});

// ---------------------------------------------------------------------------
// validateParsed + toHoldingRows
// ---------------------------------------------------------------------------

describe('validateParsed + toHoldingRows', () => {
  it('geçerli parse ok=true', () => {
    const p = parseRotaborsaHoldings(ROTABORSA_HTML, 'TLY');
    expect(validateParsed(p).ok).toBe(true);
  });

  it('boş parse ok=false', () => {
    const bad = parseRotaborsaHoldings('<html>boş sayfa</html>', 'TLY');
    expect(validateParsed(bad).ok).toBe(false);
  });

  it('satır üretimi: alanlar dolu, source=auto', () => {
    const rows = toHoldingRows(parseRotaborsaHoldings(ROTABORSA_HTML, 'TLY'));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toMatchObject({ fund_code: 'TLY', ticker: 'OZATD', source: 'auto' });
    expect(rows[0].as_of_date).toBe('2026-07-31');
    expect(rows[0].weight_pct).toBeCloseTo(34.27, 4);
  });
});

// ---------------------------------------------------------------------------
// computeFundPrediction
// ---------------------------------------------------------------------------

describe('computeFundPrediction', () => {
  const holdings = [
    { ticker: 'OZATD', name: null, weightPct: 34.27, prevWeightPct: null },
    { ticker: 'DSTKF', name: null, weightPct: 12.02, prevWeightPct: null },
    { ticker: 'TERA', name: null, weightPct: 4.11, prevWeightPct: null },
  ];

  it('Σ w×Δ: OZATD +%2, DSTKF −%1, TERA +%0.5 → tahmin', () => {
    const p = computeFundPrediction('TLY', holdings, {
      OZATD: { price: 100, changePct: 2 },
      DSTKF: { price: 50, changePct: -1 },
      TERA: { price: 10, changePct: 0.5 },
    });
    // 34.27*2/100 = 0.6854 ; 12.02*(-1)/100 = -0.1202 ; 4.11*0.5/100 = 0.02055
    expect(p.predictedPct).toBeCloseTo(0.6854 - 0.1202 + 0.02055, 5);
    expect(p.coveredPct).toBeCloseTo(50.4, 4);
    expect(p.missingTickers).toEqual([]);
    expect(p.contributions[0].ticker).toBe('OZATD'); // en büyük etki
  });

  it('fiyat eksik: o hisse missingTickers listesine, uydurma katkı yok', () => {
    const p = computeFundPrediction('TLY', holdings, {
      OZATD: { price: 100, changePct: 2 },
      // DSTKF eksik
      TERA: { price: 10, changePct: 0.5 },
    });
    expect(p.missingTickers).toEqual(['DSTKF']);
    expect(p.predictedPct).toBeCloseTo(0.6854 + 0.02055, 5);
    expect(p.coveredPct).toBeCloseTo(38.38, 4);
  });

  it('hiç fiyat yok → predicted 0 + tümü missing (null değil: veri yoksa katkı yok)', () => {
    const p = computeFundPrediction('TLY', holdings, {});
    expect(p.predictedPct).toBe(0);
    expect(p.missingTickers).toEqual(['OZATD', 'DSTKF', 'TERA']);
  });
});
