import { describe, it, expect } from 'vitest';
import { parseKapPdfHoldings, validateKapParsed } from './kapPdfParser';

describe('parseKapPdfHoldings — pipe format (fetch_page)', () => {
  it('TLY Nisan-2025 pipe tablosunu doğru parse eder ve PEHOL toplar', () => {
    const sample = `
| DAGHL | TL | DAGI YATIRIM | 0,13 | 0,12 | 0,12 |
| DSTKF | TL | DESTEK | 38,36 | 36,91 | 37,28 |
| PEHOL | TL | Pera | 30,75 | 29,60 | 29,88 |
| PEHOL | TL | Pera | 0,26 | 0,25 | 0,25 |
| TERA | TL | TERA | 4,73 | 4,56 | 4,60 |
TLY Nisan-2025
`;
    const parsed = parseKapPdfHoldings(sample, 'TLY');
    expect(parsed.fundCode).toBe('TLY');
    expect(parsed.asOfDate).toBe('2025-04-30');
    expect(parsed.holdings.length).toBe(4);
    const pehol = parsed.holdings.find((h) => h.ticker === 'PEHOL');
    expect(pehol?.weightPct).toBeCloseTo(31.01, 2);
    expect(validateKapParsed(parsed).ok).toBe(true);
  });
});

describe('parseKapPdfHoldings — plain text (pdf-parse)', () => {
  it('düz metin satırlarını parse eder', () => {
    const sample = `
TLY Temmuz-2025
DSTKF TL DESTEK FAKTORING 38,36 36,91 37,28
PEHOL TL Pera 30,75 29,60 29,88
`;
    const parsed = parseKapPdfHoldings(sample, 'TLY');
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.asOfDate).toBe('2025-07-31');
  });

  it('%0.01 altı dışlanır', () => {
    const sample = `
TLY Nisan-2025
EUREN TL EUROPEN 0,00 0,00 0,00
GARAN TL GARANTI 0,04 0,03 0,03
`;
    const parsed = parseKapPdfHoldings(sample, 'TLY');
    expect(parsed.holdings.length).toBe(1);
    expect(parsed.holdings[0].ticker).toBe('GARAN');
    expect(parsed.excludedCount).toBe(1);
  });
});
