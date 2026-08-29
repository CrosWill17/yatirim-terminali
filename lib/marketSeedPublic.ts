/**
 * İSTEMCİ-GÜVENLİ PİYASA SEED'İ (P1)
 *
 * lib/marketData.ts içindeki SEED_MARKET portföy KODLARINI da içerir
 * (BURCE, TLY, …). O modül SUNUCU tarafında kalır; istemci bundle'ına
 * portföy kodu sızmaması için arayüz bu dosyadaki, YALNIZCA kamuya açık
 * endeksleri içeren seed ile başlar. Portföy fiyatları oturum açıldıktan
 * sonra /api/market yanıtıyla gelir.
 */

import { calculateGoldSilverRatio } from './calculations';
import type { MarketData } from './marketData';

const RATIO = calculateGoldSilverRatio(4720.5, 68.915);

export const PUBLIC_SEED_MARKET: MarketData = {
  source: 'seed',
  timestamp: '2026-08-25T21:00:00+03:00',
  dataDate: '25.08.2026',
  indices: {
    xu100: { price: 14433.63, changePct: -0.47, asOf: '25.08.2026 kapanış' },
    usdtry: { price: 48.1139, changePct: 0.05, asOf: '25.08.2026 kapanış' },
    ounceGold: { price: 4720.5, changePct: 0.2, asOf: '25.08.2026 kapanış' },
    gramGold: { price: 7220.45, changePct: 0.24, asOf: '25.08.2026 kapanış (BIST XGLD)' },
    ounceSilver: { price: 68.915, changePct: null, asOf: '25.08.2026 kapanış' },
    goldSilverRatio: {
      value: RATIO.ratio,
      status: RATIO.status,
      interpretation: RATIO.interpretation,
    },
    interestRate: { value: 37.0, inflation: 31.75 },
  },
  // Portföy kodu YOK — yalnızca girişli kullanıcının /api/market yanıtıyla dolar.
  positions: {},
};
