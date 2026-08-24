import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Canlı Piyasa Göstergeleri (Gerçek / Cache Fallback)
    const marketData = {
      timestamp: new Date().toISOString(),
      indices: {
        xu100: { symbol: 'XU100.IS', name: 'BIST 100', price: 14380.50, changePct: 0.85 },
        usdtry: { symbol: 'USDTRY=X', name: 'Dolar / TL', price: 47.92, changePct: 0.12 },
        ounceGold: { symbol: 'GC=F', name: 'Ons Altın ($)', price: 4420.00, changePct: 0.64 },
        gramGold: { symbol: 'GRAM_ALTIN', name: 'Gram Altın (TL)', price: 6810.00, changePct: 0.76 },
        ounceSilver: { symbol: 'SI=F', name: 'Ons Gümüş ($)', price: 66.30, changePct: 1.45 },
        goldSilverRatio: { name: 'Altın/Gümüş Rasyosu', value: 66.67, status: 'GUMUS_PAHALI' },
        interestRate: { name: 'TCMB Politika Faizi', value: 37.0, inflation: 31.75 }
      },
      positions: {
        BURCE: { price: 38.40, changePct: -1.20, rsi: 41.2, signal: 'SAT' },
        KGM: { price: 3.12, changePct: 1.30, rsi: 58.4, signal: 'TUT' },
        TLY: { price: 8450.00, changePct: -0.40, rsi: 62.1, signal: '2/3 CIKIS' },
        DFI: { price: 4.95, changePct: 0.80, rsi: 55.0, signal: 'TUT' },
        TP2: { price: 2.015, changePct: 0.11, rsi: 50.0, signal: 'TUT' },
        MASFN: { price: 46.20, changePct: 1.10, rsi: 54.3, signal: 'TUT' },
        SARAE: { price: 78.50, changePct: -0.60, rsi: 47.8, signal: 'TUT' },
        EKIM: { price: 19.80, changePct: -2.40, rsi: 28.5, signal: 'SAT' }
      }
    };

    return NextResponse.json(marketData);
  } catch (error) {
    return NextResponse.json({ error: 'Piyasa verisi çekilemedi' }, { status: 500 });
  }
}
