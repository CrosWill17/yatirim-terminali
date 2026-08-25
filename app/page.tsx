'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, PieChart, ShieldAlert,
  AlertTriangle, ArrowUpRight, ArrowDownRight,
  RefreshCw, Activity, Download, Play, Send, LogIn, LogOut, PlusCircle, FileText
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { calculateTax, calculateAccuracyScore, updateTrustScore } from '@/lib/calculations';
import { Position, Decision, CashMovement, SocialPrediction, Transaction } from '@/lib/types';
import { SEED_MARKET, MarketData } from '@/lib/marketData';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  loadAll, upsertPosition, upsertDecision, insertTransaction,
  insertCashMovement, insertPrediction, updatePrediction,
  setInitialCapital, saveDailySnapshot,
} from '@/lib/repo';

/* ------------------------------------------------------------------ */
/* Yerleşik başlangıç verileri (20.08.2026) — DB boşsa buradan aktarılır */
/* ------------------------------------------------------------------ */
const SEED_POSITIONS: Position[] = [
  { id: '1', symbol: 'BURCE', asset_name: 'Burçelik Vana', asset_type: 'BIST_HISSE', quantity: 3938, unit_cost: 40.96, target_price: 53.40, stop_price: 32.50, risk_score: 10, current_action: 'KADEMELİ SAT', rationale: 'Zarar eden şirket (F/K -24.2, PD/DD 2.45). Merdivenli çıkış (%5 ağırlığa iniş).', is_active: true },
  { id: '2', symbol: 'KGM', asset_name: 'QNB Gümüş Fon Sepeti', asset_type: 'TEFAS_FON', quantity: 25000, unit_cost: 2.99, target_price: 3.40, stop_price: 2.60, risk_score: 7, current_action: 'TUT', rationale: 'Gümüşe %95 endeksli. Tek emtia yoğunluğu 25.000 paya indirildi, stop korumalı.', is_active: true },
  { id: '3', symbol: 'TLY', asset_name: 'Tera Portföy 1. Hisse Fonu', asset_type: 'TEFAS_FON', quantity: 7, unit_cost: 6493, target_price: 9900, stop_price: 7250, risk_score: 9, current_action: '2/3 ÇIKIŞ', rationale: 'OZATD tek hisse %34.27 risk konsantrasyonu. 2/3 kâr al, 1/3 stop korumalı TUT.', is_active: true },
  { id: '4', symbol: 'DFI', asset_name: 'Deniz Portföy 1. Hisse Fonu', asset_type: 'TEFAS_FON', quantity: 10400, unit_cost: 3.846, target_price: 6.10, stop_price: 4.60, risk_score: 9, current_action: 'TUT', rationale: '27 hisseye dağılmış (%53 hisse + %28 fon). 2024 LIDER geçmişi sebebiyle stop korumalı.', is_active: true },
  { id: '5', symbol: 'TP2', asset_name: 'Tacirler Para Piyasası Fonu', asset_type: 'PPF', quantity: 24197, unit_cost: 1.963, target_price: 2.20, stop_price: 1.96, risk_score: 1, current_action: 'TUT', rationale: 'Nakit park yeri. Politika faizi %37, TÜFE %31.75 ortamında pozitif reel getiri.', is_active: true },
  { id: '6', symbol: 'MASFN', asset_name: 'Master Finans Faktoring', asset_type: 'BIST_HISSE', quantity: 486, unit_cost: 45.68, target_price: 52.00, stop_price: 39.50, risk_score: 7, current_action: 'TUT', rationale: 'F/K ~12.2, HBK 3.58, USD fonksiyonel para avantajı.', is_active: true },
  { id: '7', symbol: 'SARAE', asset_name: 'Saray Matbaacılık', asset_type: 'BIST_HISSE', quantity: 211, unit_cost: 70.00, target_price: 90.00, stop_price: 68.00, risk_score: 8, current_action: 'TUT', rationale: '88-97 bandında kâr al (Fib %23.6 = 88.1).', is_active: true },
  { id: '8', symbol: 'EKIM', asset_name: 'Ekim Varlık Kiralama', asset_type: 'BIST_HISSE', quantity: 630, unit_cost: 30.26, target_price: 22.00, stop_price: 18.37, risk_score: 10, current_action: 'SAT', rationale: 'HBK -2.06, Beta 2.79. İlk tepkide veya 18.37 dibi kırılırsa acil satış.', is_active: true }
];

const SEED_DECISIONS: Decision[] = [
  { id: 'kr1', symbol: 'TLY', action_type: '2/3 ÇIKIŞ', status: 'onaylandi', target_price: 9900, stop_price: 7250, risk_score: 9, details: 'OZATD aşırı yoğunlaşması sebebiyle 2/3 kâr realizasyonu. Stop 7.250 TL.', created_at: '2026-08-20' },
  { id: 'kr2', symbol: 'BURCE', action_type: 'MERDİVENLİ SAT', status: 'bekliyor', target_price: 53.40, stop_price: 32.50, risk_score: 10, details: 'Zarar eden şirket riskini azaltmak için 36.5-38 / 40.96 / 46.0 / 53.4 kademeleri.', created_at: '2026-08-20' },
  { id: 'kr3', symbol: 'KGM', action_type: 'TUT (25.000 Pay)', status: 'bekliyor', target_price: 3.40, stop_price: 2.60, risk_score: 7, details: 'Gümüş yoğunlaşması azaltıldı, kalan 25.000 pay stop 2.60 ile taşınıyor.', created_at: '2026-08-20' },
  { id: 'kr4', symbol: 'EKIM', action_type: 'İLK TEPKİDE SAT', status: 'bekliyor', target_price: 22.00, stop_price: 18.37, risk_score: 10, details: 'HBK negatif ve beta çok yüksek. 18.37 dip altı acil stop.', created_at: '2026-08-20' },
  { id: 'kr5', symbol: 'NAKIT', action_type: 'NAKİT DAĞITIMI', status: 'bekliyor', risk_score: 3, details: 'Nakit havuzu: %40 TP2, %30 THF hisse fonu, %10 Altın BYF, %20 tampon nakit.', created_at: '2026-08-20' },
  { id: 'kr6', symbol: 'PORTFOY', action_type: 'STOP DÜZELTMELERİ', status: 'onaylandi', risk_score: 5, details: 'Tüm pozisyonlar için tanımlanan stop seviyeleri sisteme işlendi.', created_at: '2026-08-20' },
  { id: 'kr10', symbol: 'TLY', action_type: 'POZİSYON ARTIRMA', status: 'reddedildi', risk_score: 9, details: 'OZATD risk yoğunlaşması nedeniyle pozisyon artırımı kesinlikle reddedildi.', created_at: '2026-08-20' }
];

const SEED_PREDICTIONS: SocialPrediction[] = [
  { id: 'p1', predictor_handle: '@sevketozhan', fund_code: 'TLY', predicted_return_pct: 0.45, prediction_category: 'GUNLUK_GETIRI', raw_text: 'TLY bugün %0.45 civarı getiri yazabilir.', prediction_date: '2026-08-20', actual_return_pct: 0.40, accuracy_score: 100, status: 'DOGRULANDI' },
  { id: 'p2', predictor_handle: '@sevketozhan', fund_code: 'DFI', predicted_return_pct: 0.80, prediction_category: 'GUNLUK_GETIRI', raw_text: 'DFI portföy dağılımına göre +%0.80 beklenti.', prediction_date: '2026-08-21', actual_return_pct: 0.75, accuracy_score: 100, status: 'DOGRULANDI' }
];

const CHART_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#e2e8f0'];

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#0d121f', border: '1px solid #1e293b', borderRadius: 8,
  color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
};

interface AlertItem { code: string; level: 'DANGER' | 'WARN' | 'INFO'; title: string; detail: string; }
type DbState = 'local' | 'loading' | 'auth_required' | 'connected';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analysis' | 'portfolio' | 'decisions' | 'ledger' | 'cash' | 'social' | 'settings'>('dashboard');

  /* ------------------------- Durum (State) ------------------------- */
  const [positions, setPositions] = useState<Position[]>(SEED_POSITIONS);
  const [cashBalance, setCashBalance] = useState<number>(257706);
  const [initialCapital, setInitialCapitalState] = useState<number>(678000);
  const [decisions, setDecisions] = useState<Decision[]>(SEED_DECISIONS);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [tweetInput, setTweetInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [trustScore, setTrustScore] = useState(78.5);
  const [predictions, setPredictions] = useState<SocialPrediction[]>(SEED_PREDICTIONS);
  const [market, setMarket] = useState<MarketData>(SEED_MARKET);

  // Veritabanı & oturum
  const [dbState, setDbState] = useState<DbState>(isSupabaseConfigured() ? 'loading' : 'local');
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPass, setAuthPass] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState('');

  // İşlem ekleme formu
  const [txSymbol, setTxSymbol] = useState('');
  const [txType, setTxType] = useState<'ALIS' | 'SATIS' | 'TEMETTU'>('ALIS');
  const [txQty, setTxQty] = useState('');
  const [txPrice, setTxPrice] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [txError, setTxError] = useState('');

  // Tahmin doğrulama
  const [verifyId, setVerifyId] = useState<string | null>(null);
  const [verifyPct, setVerifyPct] = useState('');

  /* ----------------- Canlı Piyasa Verisi (60sn) ------------------- */
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/market')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d && d.indices) setMarket(d); })
        .catch(() => { /* seed veride kalır */ });
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  /* ------------------- Supabase Oturum İzleme --------------------- */
  useEffect(() => {
    if (!isSupabaseConfigured()) { setDbState('local'); return; }
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  /* ------------- Veritabanı Yükleme + İlk Kurulum Aktarımı --------- */
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!isSupabaseConfigured() || hydratedRef.current) return;
    if (!userEmail) { setDbState('auth_required'); return; }
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      const bundle = await loadAll();
      if (cancelled) return;
      if (!bundle) { setDbState('connected'); return; } // tablo/RLS sorunu → yerel modda devam et

      // İlk kurulum: DB boşsa yerleşik portföyü aktar
      if (bundle.positions.length === 0) SEED_POSITIONS.forEach((p) => upsertPosition(p));
      if (bundle.decisions.length === 0) SEED_DECISIONS.forEach((d) => upsertDecision(d));
      if (bundle.cashBalance == null) {
        setInitialCapital(678000);
        insertCashMovement({ id: 'seed-cash', movement_type: 'BASLANGIC', amount: 257706, balance_after: 257706, description: 'Mevcut Kullanılabilir Serbest Nakit', category: 'BASLANGIC', created_at: new Date().toISOString() });
      }

      if (bundle.positions.length > 0) setPositions(bundle.positions);
      if (bundle.decisions.length > 0) setDecisions(bundle.decisions);
      setTransactions(bundle.transactions);
      setCashMovements(bundle.cashMovements);
      if (bundle.predictions.length > 0) setPredictions(bundle.predictions);
      if (bundle.cashBalance != null) setCashBalance(bundle.cashBalance);
      if (bundle.initialCapital != null) setInitialCapitalState(bundle.initialCapital);
      setDbState('connected');
    })();
    return () => { cancelled = true; };
  }, [userEmail]);

  /* ------------------- Türetilmiş Değerler ------------------------ */
  // Portföy pozisyonlarını canlı fiyatlarla birleştir
  const livePositions: Position[] = positions.map((pos) => {
    const q = market.positions?.[pos.symbol];
    if (q && typeof q.price === 'number' && q.price > 0 && pos.quantity > 0) {
      return { ...pos, current_price: q.price, daily_change_pct: q.changePct };
    }
    return pos;
  });

  const totalStockAndFundValue = livePositions.reduce((acc, pos) => acc + (pos.quantity * (pos.current_price || pos.unit_cost)), 0);
  const totalPortfolioValue = totalStockAndFundValue + cashBalance;
  const totalCost = livePositions.reduce((acc, pos) => acc + (pos.quantity * pos.unit_cost), 0);
  const totalUnrealizedPnL = totalStockAndFundValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalUnrealizedPnL / totalCost) * 100 : 0;
  const totalNetYieldAgainstCapital = initialCapital > 0 ? ((totalPortfolioValue - initialCapital) / initialCapital) * 100 : 0;

  // Dinamik alarmlar: stop kırılımı / stopa yakınlık / hedefe ulaşma / sert düşüş
  const alerts: AlertItem[] = useMemo(() => {
    const list: AlertItem[] = [];
    for (const p of livePositions) {
      if (!p.current_price || p.quantity <= 0) continue;
      const cp = p.current_price;
      if (p.stop_price && cp <= p.stop_price) {
        list.push({ code: p.symbol, level: 'DANGER', title: `STOP KIRILDI: ${p.symbol}`, detail: `Fiyat ${cp.toLocaleString('tr-TR')} ≤ stop ${p.stop_price.toLocaleString('tr-TR')}. Strateji: ${p.current_action}.` });
      } else if (p.stop_price && cp <= p.stop_price * 1.03) {
        list.push({ code: p.symbol, level: 'WARN', title: `STOPA YAKIN: ${p.symbol}`, detail: `Fiyat ${cp.toLocaleString('tr-TR')}, stop ${p.stop_price.toLocaleString('tr-TR')} (mesafe %${(((p.stop_price - cp) / cp) * 100).toFixed(1)}).` });
      }
      if (p.target_price && cp >= p.target_price) {
        list.push({ code: p.symbol, level: 'INFO', title: `HEDEFE ULAŞTI: ${p.symbol}`, detail: `Fiyat ${cp.toLocaleString('tr-TR')} ≥ hedef ${p.target_price.toLocaleString('tr-TR')}. Kâr alma kademelerini gözden geçirin.` });
      }
      if ((p.daily_change_pct ?? 0) <= -5) {
        list.push({ code: p.symbol, level: 'WARN', title: `GÜNLÜK SERT DÜŞÜŞ: ${p.symbol}`, detail: `Günlük değişim %${(p.daily_change_pct as number).toLocaleString('tr-TR')}.` });
      }
    }
    return list;
  }, [livePositions]);

  const dangerCount = alerts.filter((a) => a.level === 'DANGER').length;
  const warnCount = alerts.filter((a) => a.level === 'WARN').length;

  // Grafik verileri
  const allocData = useMemo(() => {
    const rows = livePositions.filter((p) => p.quantity > 0).map((p, i) => ({
      name: p.symbol,
      value: Number((p.quantity * (p.current_price || p.unit_cost)).toFixed(2)),
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    rows.push({ name: 'NAKİT', value: Number(cashBalance.toFixed(2)), color: '#10b981' });
    return rows;
  }, [livePositions, cashBalance]);

  const pnlData = useMemo(
    () => livePositions.filter((p) => p.quantity > 0).map((p) => ({
      name: p.symbol,
      pnl: Number((p.quantity * (p.current_price || p.unit_cost) - p.quantity * p.unit_cost).toFixed(0)),
    })),
    [livePositions]
  );

  // Günlük değişim rozeti
  const fmtChange = (pct: number | null | undefined) => {
    if (pct === null || pct === undefined) return <span className="text-slate-500">—</span>;
    const up = pct >= 0;
    return (
      <span className={`flex items-center ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {up ? '+' : ''}{pct.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%
      </span>
    );
  };

  const fmtTl = (v: number, digits = 0) => v.toLocaleString('tr-TR', { maximumFractionDigits: digits });

  /* ----------------------- Aksiyonlar ----------------------------- */

  // Karar Uygulama — artık gerçek iş yapar: statü + pozisyon stop/hedef + kasa defteri kaydı
  const handleApplyDecision = (id: string) => {
    const dec = decisions.find((d) => d.id === id);
    if (!dec) return;
    const updated: Decision = { ...dec, status: 'uygulandi' };
    setDecisions((prev) => prev.map((d) => (d.id === id ? updated : d)));

    // Kararın stop/hedef seviyeleri ilgili pozisyona işlenir
    if (dec.symbol !== 'PORTFOY' && dec.symbol !== 'NAKIT' && (dec.stop_price || dec.target_price)) {
      setPositions((prev) =>
        prev.map((p) =>
          p.symbol === dec.symbol
            ? { ...p, stop_price: dec.stop_price ?? p.stop_price, target_price: dec.target_price ?? p.target_price }
            : p
        )
      );
    }

    const mov: CashMovement = {
      id: Date.now().toString(),
      movement_type: 'KARAR',
      amount: 0,
      balance_after: cashBalance,
      description: `Karar ${dec.id} uygulandı: ${dec.symbol} — ${dec.action_type}`,
      category: 'KARAR',
      created_at: new Date().toISOString(),
    };
    setCashMovements((prev) => [mov, ...prev]);

    upsertDecision(updated);
    insertCashMovement(mov);
    if (dec.symbol !== 'PORTFOY' && dec.symbol !== 'NAKIT') {
      const pos = positions.find((p) => p.symbol === dec.symbol);
      if (pos) upsertPosition({ ...pos, stop_price: dec.stop_price ?? pos.stop_price, target_price: dec.target_price ?? pos.target_price });
    }
  };

  // İşlem Ekleme — alım/satış/temettü; stopaj + gerçekleşen K/Z + kasa + pozisyon günceller
  const handleAddTransaction = () => {
    const symbol = txSymbol.trim().toUpperCase();
    const qty = parseFloat(txQty.replace(',', '.'));
    const price = parseFloat(txPrice.replace(',', '.'));
    if (!symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) {
      setTxError('Kod, adet ve fiyat geçerli olmalıdır.');
      return;
    }
    const ts = new Date().toISOString();
    const total = Number((qty * price).toFixed(4));
    let cashDelta = 0;
    let realizedPnl = 0;
    let tax = 0;
    let nextPositions: Position[] = positions;
    let msg = '';

    if (txType === 'SATIS') {
      const pos = positions.find((p) => p.symbol === symbol);
      if (!pos) { setTxError('Bu kod portföyde yok — önce ALIŞ ile ekleyin.'); return; }
      if (qty > pos.quantity + 1e-9) { setTxError(`Satılabilir maksimum: ${fmtTl(pos.quantity, 4)} pay`); return; }
      const totalCost = pos.quantity * pos.unit_cost;
      const soldCost = (qty / pos.quantity) * totalCost;
      const t = calculateTax(pos.asset_type, symbol, soldCost, total);
      tax = t.taxAmount;
      realizedPnl = total - soldCost - tax;
      cashDelta = total - tax;
      const newQty = Number((pos.quantity - qty).toFixed(4));
      nextPositions = positions.map((p) =>
        p.symbol === symbol ? { ...p, quantity: newQty, current_action: newQty <= 1e-9 ? 'KAPANDI' : p.current_action } : p
      );
      msg = `${symbol} SATIŞ ${fmtTl(qty, 4)} × ${fmtTl(price, 4)} TL` + (tax > 0 ? ` — stopaj ${fmtTl(tax, 2)} TL kesildi` : '');
    } else if (txType === 'ALIS') {
      if (total > cashBalance) { setTxError(`Yetersiz nakit: kasada ${fmtTl(cashBalance)} TL var.`); return; }
      cashDelta = -total;
      const pos = positions.find((p) => p.symbol === symbol);
      if (pos) {
        const oldCost = pos.quantity * pos.unit_cost;
        const newQty = Number((pos.quantity + qty).toFixed(4));
        const newUnitCost = Number((((oldCost + total) / newQty) * 10000).toFixed(0)) / 10000;
        nextPositions = positions.map((p) => (p.symbol === symbol ? { ...p, quantity: newQty, unit_cost: newUnitCost, current_action: 'TUT' } : p));
      } else {
        nextPositions = [
          ...positions,
          {
            id: Date.now().toString(), symbol, asset_name: symbol, asset_type: 'BIST_HISSE',
            quantity: qty, unit_cost: price, current_price: market.positions?.[symbol]?.price ?? price,
            risk_score: 5, current_action: 'TUT', rationale: 'Terminal üzerinden açılan pozisyon.', is_active: true,
          },
        ];
      }
      msg = `${symbol} ALIŞ ${fmtTl(qty, 4)} × ${fmtTl(price, 4)} TL`;
    } else {
      cashDelta = total;
      msg = `${symbol} TEMETTU +${fmtTl(total, 2)} TL`;
    }

    const newCash = Number((cashBalance + cashDelta).toFixed(2));
    const txn: Transaction = {
      id: Date.now().toString(), symbol, transaction_type: txType,
      quantity: qty, unit_price: price, total_amount: total,
      withholding_tax: tax, net_amount: total - tax, realized_pnl: Number(realizedPnl.toFixed(2)),
      notes: txNotes.trim() || undefined, created_at: ts,
    };
    const mov: CashMovement = {
      id: Date.now().toString() + '-m', movement_type: txType, amount: Number(cashDelta.toFixed(2)),
      balance_after: newCash, description: msg, category: 'ISLEM', created_at: ts,
    };

    setPositions(nextPositions);
    setCashBalance(newCash);
    setTransactions((prev) => [txn, ...prev]);
    setCashMovements((prev) => [mov, ...prev]);
    setTxSymbol(''); setTxQty(''); setTxPrice(''); setTxNotes(''); setTxError('');

    const updatedPos = nextPositions.find((p) => p.symbol === symbol);
    if (updatedPos) upsertPosition(updatedPos);
    insertTransaction(txn);
    insertCashMovement(mov);
  };

  // Sosyal Metin Ayrıştırma — /api/social-parse üzerinden (server-side regex)
  const handleParseTweet = async () => {
    if (!tweetInput.trim() || parsing) return;
    setParsing(true);
    try {
      const res = await fetch('/api/social-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tweetInput }),
      });
      const data = await res.json();
      if (data.success && data.parsed) {
        const p = data.parsed;
        const newPred: SocialPrediction = {
          id: Date.now().toString(),
          predictor_handle: p.predictorHandle,
          fund_code: p.fundCode,
          predicted_return_pct: p.predictedReturnPct,
          prediction_category: p.category,
          raw_text: tweetInput,
          prediction_date: new Date().toISOString().split('T')[0],
          status: 'BEKLIYOR',
        };
        setPredictions((prev) => [newPred, ...prev]);
        insertPrediction(newPred);
        setTweetInput('');
      } else {
        setTweetInput('');
      }
    } catch {
      /* ağ hatası — metin kutusunda kalsın */
    } finally {
      setParsing(false);
    }
  };

  // Tahmin Doğrulama — gerçekleşen getiriyi gir → isabet puanı + güven skoru güncelle
  const handleVerifyPrediction = () => {
    if (!verifyId) return;
    const actual = parseFloat(verifyPct.replace(',', '.'));
    if (!Number.isFinite(actual)) return;
    const pred = predictions.find((p) => p.id === verifyId);
    if (!pred) return;
    const acc = calculateAccuracyScore(pred.predicted_return_pct, actual);
    const newTrust = updateTrustScore(trustScore, acc);
    const updated: SocialPrediction = { ...pred, actual_return_pct: actual, accuracy_score: acc, status: 'DOGRULANDI' };
    setPredictions((prev) => prev.map((p) => (p.id === verifyId ? updated : p)));
    setTrustScore(newTrust);
    updatePrediction(updated);
    setVerifyId(null);
    setVerifyPct('');
  };

  // Supabase Auth
  const handleAuth = async (mode: 'in' | 'up') => {
    if (!authEmail.trim() || !authPass) return;
    setAuthBusy(true);
    setAuthMsg('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPass });
        if (error) setAuthMsg(`Giriş hatası: ${error.message}`);
        else setAuthMsg('Oturum açıldı — veriler yükleniyor…');
      } else {
        const { data, error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPass });
        if (error) setAuthMsg(`Kayıt hatası: ${error.message}`);
        else if (data.session) setAuthMsg('Hesap oluşturuldu ve oturum açıldı.');
        else setAuthMsg('Hesap oluşturuldu. E-posta onayı isteniyorsa kutunuzu kontrol edin (Supabase → Authentication → "Confirm email"i kapatabilirsiniz).');
      }
    } catch (e: any) {
      setAuthMsg(`Hata: ${e?.message ?? 'bilinmiyor'}`);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setDbState('auth_required');
    setAuthMsg('Oturum kapatıldı. Yerel modda devam ediliyor.');
  };

  // Günlük portföy snapshot (DB bağlıyken bir kez)
  const snapshotSavedRef = useRef(false);
  useEffect(() => {
    if (dbState !== 'connected' || snapshotSavedRef.current) return;
    snapshotSavedRef.current = true;
    const breakdown: Record<string, number> = {};
    livePositions.forEach((p) => { breakdown[p.symbol] = Number((p.quantity * (p.current_price || p.unit_cost)).toFixed(2)); });
    breakdown['NAKİT'] = Number(cashBalance.toFixed(2));
    saveDailySnapshot(new Date().toISOString().split('T')[0], Number(totalPortfolioValue.toFixed(2)), cashBalance, breakdown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbState]);

  const dbChip =
    dbState === 'connected' ? { txt: '☁️ DB KALICI', cls: 'bg-sky-950 text-sky-300 border-sky-800' } :
    dbState === 'loading' ? { txt: '⏳ DB…', cls: 'bg-slate-800 text-slate-300 border-slate-700' } :
    dbState === 'auth_required' ? { txt: '🔒 OTURUM GEREKLİ', cls: 'bg-amber-950 text-amber-300 border-amber-800' } :
    { txt: '📍 YEREL MOD', cls: 'bg-slate-800 text-slate-400 border-slate-700' };

  /* --------------------------- RENDER ----------------------------- */
  return (
    <div className="flex flex-col min-h-screen bg-[#0a0d14] text-slate-100">

      {/* 🔴 CANLI TICKER BAR */}
      <header className="border-b border-slate-800 bg-[#0d121f] px-4 py-2.5 flex items-center justify-between text-xs font-mono overflow-x-auto gap-6 sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-sky-400 shrink-0">
          <Activity className={`w-4 h-4 ${market.source === 'live' ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
          <span>YATIRIM TERMİNALİ v3.1</span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
            market.source === 'live'
              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
              : 'bg-amber-950 text-amber-400 border-amber-800'
          }`}>
            {market.source === 'live' ? 'CANLI' : `SON VERİ ${market.dataDate}`}
          </span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${dbChip.cls}`}>{dbChip.txt}</span>
        </div>

        <div className="flex items-center gap-6 whitespace-nowrap">
          <div className="flex items-center gap-1.5" title={market.indices.xu100.asOf ?? ''}>
            <span className="text-slate-400">BIST 100:</span>
            <span className="font-semibold text-slate-200">{market.indices.xu100.price.toLocaleString('tr-TR')}</span>
            {fmtChange(market.indices.xu100.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.usdtry.asOf ?? ''}>
            <span className="text-slate-400">USD/TRY:</span>
            <span className="font-semibold text-slate-200">{market.indices.usdtry.price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL</span>
            {fmtChange(market.indices.usdtry.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.gramGold.asOf ?? ''}>
            <span className="text-slate-400">Gram Altın:</span>
            <span className="font-semibold text-amber-300">{market.indices.gramGold.price.toLocaleString('tr-TR')} TL</span>
            {fmtChange(market.indices.gramGold.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.ounceSilver.asOf ?? ''}>
            <span className="text-slate-400">Ons Gümüş:</span>
            <span className="font-semibold text-slate-200">{market.indices.ounceSilver.price.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} $</span>
            {fmtChange(market.indices.ounceSilver.changePct)}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700" title={market.indices.goldSilverRatio.interpretation}>
            <span className="text-amber-400">Altın/Gümüş Rasyosu:</span>
            <span className="font-bold text-amber-200">{market.indices.goldSilverRatio.value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}</span>
            <span className="text-amber-400 text-[10px]">
              ({market.indices.goldSilverRatio.status === 'GUMUS_PAHALI' ? 'Gümüş Pahalı' : market.indices.goldSilverRatio.status === 'GUMUS_UCUZ' ? 'Gümüş Ucuz' : 'Dengede'})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">TCMB Politika:</span>
            <span className="font-semibold text-sky-300">%{market.indices.interestRate.value.toLocaleString('tr-TR')}</span>
            <span className="text-slate-400 text-[10px]">(TÜFE %{market.indices.interestRate.inflation.toLocaleString('tr-TR')})</span>
          </div>

          <span className="text-[10px] text-slate-500" title="Fiyatların ait olduğu iş günü ve veri çekim zamanı">
            📅 {market.dataDate} • {new Date(market.timestamp).toLocaleTimeString('tr-TR')}
          </span>
        </div>
      </header>

      {/* 🧭 8 SEKMELİ NAVİGASYON BAR */}
      <nav className="bg-[#101726] border-b border-slate-800 px-4 flex items-center gap-1 overflow-x-auto">
        {[
          { id: 'dashboard', label: '📊 Ana Panel' },
          { id: 'analysis', label: '🔍 Analiz Merkezi' },
          { id: 'portfolio', label: '💼 Portföy' },
          { id: 'decisions', label: '📋 Kararlar (Hub)' },
          { id: 'ledger', label: '📜 İşlem Günlüğü' },
          { id: 'cash', label: '🏦 Kasa' },
          { id: 'social', label: '📱 Sosyal Doğrulama' },
          { id: 'settings', label: '⚙️ Ayarlar & DB' }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-sky-400 text-sky-300 bg-sky-950/30'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* 📋 ANA İÇERİK ALANI */}
      <main className="flex-1 p-5 max-w-7xl mx-auto w-full space-y-6">

        {/* 1. 📊 ANA PANEL */}
        {activeTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>TOPLAM PORTFÖY DEĞERİ</span>
                  <PieChart className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold text-slate-100 mt-2 font-mono">
                  {fmtTl(totalPortfolioValue)} TL
                </div>
                <div className={`text-xs mt-1 font-mono flex items-center gap-1 ${totalNetYieldAgainstCapital >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <TrendingUp className="w-3.5 h-3.5" /> Ana Paraya Göre Net: {totalNetYieldAgainstCapital >= 0 ? '+' : ''}{totalNetYieldAgainstCapital.toFixed(1)}%
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>SERBEST KASA NAKDİ</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-emerald-300 mt-2 font-mono">
                  {fmtTl(cashBalance)} TL
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  Portföyün %{((cashBalance / totalPortfolioValue) * 100).toFixed(1)}'i Likit
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>VARLIK KÂR / ZARAR</span>
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                </div>
                <div className={`text-2xl font-bold mt-2 font-mono ${totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {totalUnrealizedPnL >= 0 ? '+' : ''}{fmtTl(totalUnrealizedPnL)} TL
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  Maliyet Üzeri: %{totalPnLPct.toFixed(1)}
                </div>
              </div>

              <div className={`bg-[#111726] border rounded-lg p-4 ${dangerCount > 0 ? 'border-rose-800' : warnCount > 0 ? 'border-amber-800' : 'border-emerald-900'}`}>
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>AKTİF ALARMLAR</span>
                  <ShieldAlert className={`w-4 h-4 ${dangerCount > 0 ? 'text-rose-400' : warnCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
                </div>
                <div className={`text-2xl font-bold mt-2 font-mono ${dangerCount > 0 ? 'text-rose-400' : warnCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {dangerCount + warnCount} {dangerCount > 0 ? 'KRİTİK' : warnCount > 0 ? 'DİKKAT' : 'TEMİZ ✓'}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  {dangerCount > 0 ? `${dangerCount} stop ihlali` : warnCount > 0 ? `${warnCount} uyarı seviyesi` : 'Tüm stoplar korumada'}
                </div>
              </div>
            </div>

            {/* 📈 Grafikler: Varlık Dağılımı + Pozisyon K/Z */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <h3 className="text-xs font-mono font-bold text-slate-300 mb-2">VARLIK DAĞILIMI (DEĞERE GÖRE)</h3>
                <div className="flex items-center">
                  <ResponsiveContainer width="55%" height={210}>
                    <RPieChart>
                      <Pie data={allocData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2} stroke="none">
                        {allocData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <RTooltip formatter={(v: any) => fmtTl(Number(v)) + ' TL'} contentStyle={CHART_TOOLTIP_STYLE} />
                    </RPieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5 text-[11px] font-mono">
                    {allocData.map((d) => (
                      <div key={d.name} className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: d.color }} />{d.name}
                        </span>
                        <span className="text-slate-400">%{((d.value / totalPortfolioValue) * 100).toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <h3 className="text-xs font-mono font-bold text-slate-300 mb-2">POZİSYON K/Z (TL, MALİYET ÜZERİ)</h3>
                <ResponsiveContainer width="100%" height={210}>
                  <BarChart data={pnlData} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }} axisLine={{ stroke: '#1e293b' }} tickLine={false} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'monospace' }} axisLine={false} tickLine={false} />
                    <ReferenceLine y={0} stroke="#334155" />
                    <RTooltip formatter={(v: any) => fmtTl(Number(v)) + ' TL'} contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'rgba(51,65,85,0.2)' }} />
                    <Bar dataKey="pnl" name="K/Z" radius={[3, 3, 0, 0]}>
                      {pnlData.map((d) => <Cell key={d.name} fill={d.pnl >= 0 ? '#34d399' : '#f87171'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 🚨 Dinamik Alarmlar Şeridi */}
            <div className={`border rounded-lg p-4 text-xs font-mono space-y-2 ${alerts.length > 0 ? 'bg-rose-950/30 border-rose-800/60' : 'bg-emerald-950/20 border-emerald-900/60'}`}>
              <div className={`flex items-center gap-2 font-bold ${alerts.length > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                <AlertTriangle className={`w-4 h-4 ${alerts.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`} />
                <span>{alerts.length > 0 ? 'AKTİF ALARMLAR (CANLI FİYATLA HESAPLANDI)' : 'STOP KONTROLÜ: TÜM POZİSYONLAR GÜVENLİ BÖLGEDE'}</span>
              </div>
              {alerts.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300">
                  {alerts.map((a, i) => (
                    <div key={i} className={`p-2.5 rounded border ${
                      a.level === 'DANGER' ? 'bg-rose-900/25 border-rose-800/50' :
                      a.level === 'WARN' ? 'bg-amber-900/20 border-amber-800/40' : 'bg-sky-900/20 border-sky-800/40'
                    }`}>
                      <span className={`font-bold ${a.level === 'DANGER' ? 'text-rose-200' : a.level === 'WARN' ? 'text-amber-200' : 'text-sky-200'}`}>{a.title}:</span> {a.detail}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-400 pt-1 border-t border-slate-800/50">
                <div className="p-2 rounded">
                  <span className="font-bold text-slate-300">📌 Stratejik Not — TLY Yoğunlaşma:</span> Fon portföyünün %34.27'si tek başına OZATD hissesindedir. 2/3 çıkış kararı onaylı; kalan 1/3 için 7.250 TL stop-loss aktiftir.
                </div>
                <div className="p-2 rounded">
                  <span className="font-bold text-slate-300">📌 Stratejik Not — Zarar Hisseleri:</span> Zarar eden şirketlerde F/K anlamsızdır. BURCE PD/DD 2.45 bölgesinde; merdivenli satış ile ağırlık %5'e çekilmeli.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. 🔍 ANALİZ MERKEZİ */}
        {activeTab === 'analysis' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-sky-400 font-mono">STRATEJİK ANALİZ MERKEZİ (5 BÖLÜMLÜ DEDEKTİF RAPORU)</h2>
                <p className="text-xs text-slate-400 mt-1">Canlı piyasa verileri, bilanço rasyoları ve @sevketozhan benchmark entegrasyonu</p>
              </div>
              <button
                onClick={() => fetch('/api/market').then((r) => r.json()).then((d) => d && d.indices && setMarket(d))}
                className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold px-4 py-2 rounded flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> CANLI ANALİZİ GÜNCELLE
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs leading-relaxed">
              <div className="bg-slate-900/90 border-l-4 border-rose-500 p-4 rounded-r">
                <h3 className="text-rose-400 font-bold text-sm mb-1">BÖLÜM 1: NET KARAR (SERT VE TAVİZSİZ)</h3>
                <p className="text-slate-300">
                  <strong>TLY:</strong> 2/3 Kâr alımı UYGULANMALIDIR. Stop 7.250 TL. <br />
                  <strong>BURCE:</strong> Alınmaz, merdivenli satılır (36.5-38 / 40.96 / 46.0). Hedef %5 portföy ağırlığı. <br />
                  <strong>KGM:</strong> 25.000 payda TUT. Altın/Gümüş oranı {market.indices.goldSilverRatio.value.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} seviyesinde olduğundan ilave gümüş alımı yapılmaz. Stop: 2.60 TL.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-sky-500 p-4 rounded-r">
                <h3 className="text-sky-400 font-bold text-sm mb-1">BÖLÜM 2: TEMEL ANALİZ (BİLANÇO DEDEKTİFİ)</h3>
                <p className="text-slate-300">
                  Zarar eden şirketlerde F/K negatiftir ve yanıltıcıdır. BURCE (Net kâr -27.1M TL, PD/DD 2.57) pahalı bölgededir. MASFN (F/K ~10.3, PD/DD 2.30, USD fonksiyonel para) güçlü rasyolara sahiptir.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-amber-500 p-4 rounded-r">
                <h3 className="text-amber-400 font-bold text-sm mb-1">BÖLÜM 3: SOSYAL MEDYA FİLTRESİ & TAHMİN ENTEGRASYONU</h3>
                <p className="text-slate-300">
                  @sevketozhan Güven Skoru: <strong>%{trustScore.toLocaleString('tr-TR')}</strong> ({trustScore >= 80 ? 'Yüksek Güvenilirlik' : trustScore >= 60 ? 'Orta Güvenilirlik' : 'Düşük Güvenilirlik'}). Formül: (Kendi Analiz × 0.6) + (@sevketozhan × 0.4). Doğrulama: Sosyal Doğrulama sekmesinden gerçekleşen getiriyi girin.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-emerald-500 p-4 rounded-r">
                <h3 className="text-emerald-400 font-bold text-sm mb-1">BÖLÜM 4: FON VE EMTİA STRATEJİSİ</h3>
                <p className="text-slate-300">
                  Serbest fonlarda %17.5 stopaj çıkışta kârdan kesilir (İşlem Günlüğü'ndeki satışlarda otomatik hesaplanır). TP2 para piyasası fonu %37 politika faizi ortamında aylık %3+ risksiz reel getiri tamponu olarak tutulmalıdır.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-indigo-500 p-4 rounded-r">
                <h3 className="text-indigo-400 font-bold text-sm mb-1">BÖLÜM 5: AKADEMİ NOTU</h3>
                <p className="text-slate-300">
                  <strong>Yoğunlaşma Riski:</strong> Çeşitlendirme getiriyi maksimize etmek için değil; tek bir hissenin/tahminin çökmesi durumunda anaparayı korumak için yapılır. Tek bir varlık toplam portföyün %20'sini aşmamalıdır.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 3. 💼 PORTFÖY TABLOSU */}
        {activeTab === 'portfolio' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h2 className="font-mono text-sm font-bold text-slate-200">AKTİF POZİSYONLAR VE VARLIK TABLOSU</h2>
              <span className="text-xs font-mono text-slate-400">{livePositions.filter(p => p.quantity > 0).length} Varlık | Toplam Değer: {fmtTl(totalPortfolioValue)} TL</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#0d121f] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3">KOD</th>
                    <th className="p-3">VARLIK ADI</th>
                    <th className="p-3">TÜR</th>
                    <th className="p-3 text-right">ADET</th>
                    <th className="p-3 text-right">MALİYET</th>
                    <th className="p-3 text-right">GÜNCEL FİYAT</th>
                    <th className="p-3 text-right">GÜNLÜK %</th>
                    <th className="p-3 text-right">TOPLAM DEĞER</th>
                    <th className="p-3 text-right">K/Z (TL)</th>
                    <th className="p-3 text-center">STOP</th>
                    <th className="p-3 text-center">KARAR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {livePositions.map((pos) => {
                    const value = pos.quantity * (pos.current_price || pos.unit_cost);
                    const pnl = value - (pos.quantity * pos.unit_cost);
                    const asOf = market.positions?.[pos.symbol]?.asOf;
                    const stopBreached = pos.stop_price && pos.current_price != null && pos.current_price <= pos.stop_price;
                    return (
                      <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="p-3 font-bold text-sky-400" title={asOf ? `Son fiyat tarihi: ${asOf}` : undefined}>{pos.symbol}</td>
                        <td className="p-3 text-slate-300">{pos.asset_name}</td>
                        <td className="p-3 text-slate-400 text-[10px]">{pos.asset_type}</td>
                        <td className="p-3 text-right text-slate-200">{pos.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}</td>
                        <td className="p-3 text-right text-slate-300">{pos.unit_cost.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL</td>
                        <td className="p-3 text-right font-bold text-slate-100">{(pos.current_price || pos.unit_cost).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} TL</td>
                        <td className={`p-3 text-right font-bold ${
                          pos.daily_change_pct === null || pos.daily_change_pct === undefined
                            ? 'text-slate-500'
                            : pos.daily_change_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}>
                          {pos.daily_change_pct === null || pos.daily_change_pct === undefined
                            ? '—'
                            : `${pos.daily_change_pct >= 0 ? '+' : ''}${pos.daily_change_pct.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}%`}
                        </td>
                        <td className="p-3 text-right font-bold text-slate-200">{value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL</td>
                        <td className={`p-3 text-right font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                        </td>
                        <td className={`p-3 text-center font-bold ${stopBreached ? 'text-rose-400' : 'text-rose-400/70'}`}>
                          {pos.stop_price ? `${pos.stop_price.toLocaleString('tr-TR')} TL${stopBreached ? ' ⛔' : ''}` : '—'}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.current_action.includes('SAT') || pos.current_action.includes('ÇIKIŞ') || pos.current_action === 'KAPANDI'
                              ? 'bg-rose-950 text-rose-300 border border-rose-800'
                              : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          }`}>
                            {pos.current_action}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. 📋 KARARLAR (EXECUTION HUB) */}
        {activeTab === 'decisions' && (
          <div className="space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200">STRATEJİK KARARLAR & EXECUTION MERKEZİ</h2>
              <span className="text-slate-400">{decisions.filter(d => d.status === 'onaylandi').length} Onaylı Karar Bekliyor</span>
            </div>
            <p className="text-[11px] text-slate-500">🚀 UYGULA: Kararı "uygulandı"ya geçirir, stop/hedef seviyelerini ilgili pozisyona işler ve kasa defterine kayıt atar{dbState === 'connected' ? ' (Supabase veritabanına kalıcı yazılır)' : ''}.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {decisions.map((dec) => (
                <div key={dec.id} className="bg-[#111726] border border-slate-800 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="bg-sky-950 text-sky-300 px-2 py-0.5 rounded font-bold border border-sky-800">{dec.id}</span>
                      <span className="font-bold text-slate-200">{dec.symbol}</span>
                      <span className="text-slate-400">— {dec.action_type}</span>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      dec.status === 'onaylandi' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                      dec.status === 'uygulandi' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                      dec.status === 'reddedildi' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {dec.status}
                    </span>
                  </div>

                  <p className="text-slate-300 leading-relaxed">{dec.details}</p>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-slate-400 text-[11px]">
                      Risk: <span className="text-rose-400 font-bold">{dec.risk_score}/10</span>
                      {dec.stop_price && <span className="ml-2">Stop: <span className="text-rose-400 font-bold">{dec.stop_price.toLocaleString('tr-TR')} TL</span></span>}
                    </div>

                    {dec.status === 'onaylandi' && (
                      <button
                        onClick={() => handleApplyDecision(dec.id)}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded flex items-center gap-1.5 transition-colors"
                      >
                        <Play className="w-3 h-3" /> 🚀 UYGULA
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. 📜 İŞLEM GÜNLÜĞÜ (MASTER LEDGER) */}
        {activeTab === 'ledger' && (
          <div className="space-y-6">
            <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">MASTER LEDGER & SERMAYE PERFORMANSI</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">BAŞLANGIÇ ANA PARA:</span>
                  <div className="text-base font-bold text-slate-200 mt-1">{fmtTl(initialCapital)} TL</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">GÜNCEL TOPLAM PORTFÖY:</span>
                  <div className="text-base font-bold text-emerald-400 mt-1">{fmtTl(totalPortfolioValue)} TL</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">TOPLAM NET GETİRİ (TL & %):</span>
                  <div className={`text-base font-bold mt-1 ${totalPortfolioValue - initialCapital >= 0 ? 'text-sky-400' : 'text-rose-400'}`}>
                    {totalPortfolioValue - initialCapital >= 0 ? '+' : ''}{fmtTl(totalPortfolioValue - initialCapital)} TL (%{totalNetYieldAgainstCapital.toFixed(1)})
                  </div>
                </div>
              </div>
            </div>

            {/* ➕ İşlem Ekleme */}
            <div className="bg-[#111726] border border-slate-800 rounded-lg p-5 font-mono text-xs space-y-3">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2"><PlusCircle className="w-4 h-4 text-sky-400" /> İŞLEM EKLE (ALIŞ / SATIŞ / TEMETTU)</h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <input list="tx-symbols" value={txSymbol} onChange={(e) => setTxSymbol(e.target.value)} placeholder="KOD (BURCE)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500 uppercase" />
                <datalist id="tx-symbols">
                  {positions.filter((p) => p.quantity > 0).map((p) => <option key={p.symbol} value={p.symbol}>{p.asset_name}</option>)}
                </datalist>
                <select value={txType} onChange={(e) => setTxType(e.target.value as any)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500">
                  <option value="ALIS">ALIŞ</option>
                  <option value="SATIS">SATIŞ</option>
                  <option value="TEMETTU">TEMETTU</option>
                </select>
                <input value={txQty} onChange={(e) => setTxQty(e.target.value)} placeholder="ADET" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
                <input value={txPrice} onChange={(e) => setTxPrice(e.target.value)} placeholder={txType === 'TEMETTU' ? 'PAY BAŞI TL' : 'FİYAT TL'} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
                <input value={txNotes} onChange={(e) => setTxNotes(e.target.value)} placeholder="NOT (opsiyonel)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
                <button onClick={handleAddTransaction} className="bg-sky-600 hover:bg-sky-500 text-white font-bold px-4 py-2 rounded col-span-2 md:col-span-1">KAYDET</button>
              </div>
              {txError && <div className="text-rose-400 text-[11px]">⚠️ {txError}</div>}
              <p className="text-[10px] text-slate-500">
                SATIŞ'ta TEFAS fonları için %17.5 stopaj otomatik hesaplanır; gerçekleşen K/Z ve kasa hareketi deftere işlenir.
                YENİ kod yazarsanız ALIŞ ile otomatik pozisyon açılır.
              </p>
            </div>

            {/* İşlem Tablosu */}
            <div className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h3 className="font-mono text-sm font-bold text-slate-200">İŞLEM GÜNLÜĞÜ</h3>
                <span className="text-xs font-mono text-slate-400">{transactions.length} kayıt</span>
              </div>
              {transactions.length === 0 ? (
                <div className="p-6 text-center text-slate-500 text-xs font-mono">
                  Henüz işlem yok. Yukarıdan ilk alım/satışınızı ekleyin.
                  <div className="mt-3 text-[10px] text-slate-600 space-y-1">
                    <div>• Tarihsel not: METEN 13.08'de 20.40 TL'den satıldı (+%2.0) — sisteme öncesi.</div>
                    <div>• Tarihsel not: KGM 58.717 paydan 25.000 paya indirildi — sisteme öncesi.</div>
                    <div>• Tarihsel not: IJC stop tetiklendi, disiplinli zararla kapatıldı — sisteme öncesi.</div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#0d121f] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">TARİH</th>
                        <th className="p-3">KOD</th>
                        <th className="p-3">TÜR</th>
                        <th className="p-3 text-right">ADET</th>
                        <th className="p-3 text-right">FİYAT</th>
                        <th className="p-3 text-right">TUTAR</th>
                        <th className="p-3 text-right">STOPAJ</th>
                        <th className="p-3 text-right">NET</th>
                        <th className="p-3 text-right">GERÇEKLEŞEN K/Z</th>
                        <th className="p-3">NOT</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {transactions.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-800/30">
                          <td className="p-3 text-slate-400">{new Date(t.created_at).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="p-3 font-bold text-sky-400">{t.symbol}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              t.transaction_type === 'SATIS' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                              t.transaction_type === 'ALIS' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                              'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}>{t.transaction_type}</span>
                          </td>
                          <td className="p-3 text-right text-slate-200">{t.quantity.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}</td>
                          <td className="p-3 text-right text-slate-300">{t.unit_price.toLocaleString('tr-TR', { maximumFractionDigits: 4 })}</td>
                          <td className="p-3 text-right text-slate-200">{fmtTl(t.total_amount, 2)}</td>
                          <td className={`p-3 text-right ${t.withholding_tax > 0 ? 'text-amber-400' : 'text-slate-600'}`}>{t.withholding_tax > 0 ? fmtTl(t.withholding_tax, 2) : '—'}</td>
                          <td className="p-3 text-right text-slate-200">{fmtTl(t.net_amount, 2)}</td>
                          <td className={`p-3 text-right font-bold ${t.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{t.realized_pnl !== 0 ? `${t.realized_pnl >= 0 ? '+' : ''}${fmtTl(t.realized_pnl, 2)}` : '—'}</td>
                          <td className="p-3 text-slate-500 text-[10px] max-w-[180px] truncate" title={t.notes}>{t.notes ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Kasa Hareketleri */}
            <div className="bg-[#111726] border border-slate-800 rounded-lg p-5 font-mono text-xs">
              <h3 className="text-sm font-bold text-slate-200 mb-3">SON KASA HAREKETLERİ</h3>
              {cashMovements.length === 0 ? (
                <div className="text-slate-500">Henüz kasa hareketi kaydı yok.</div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {cashMovements.slice(0, 20).map((m) => (
                    <div key={m.id} className="flex items-center justify-between bg-slate-900/60 border border-slate-800/60 rounded px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">{new Date(m.created_at).toLocaleDateString('tr-TR')}</span>
                        <span className="text-slate-300 text-[11px]">{m.description}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${m.amount > 0 ? 'text-emerald-400' : m.amount < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                          {m.amount > 0 ? '+' : ''}{fmtTl(m.amount, 2)}
                        </span>
                        <span className="text-slate-400 text-[10px]">= {fmtTl(m.balance_after)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 6. 🏦 KASA */}
        {activeTab === 'cash' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">KASA & NAKİT REZERV YÖNETİMİ</h2>
            <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800 p-4 rounded-lg">
              <div>
                <span className="text-slate-400">MEVCUT KULLANILABİLİR SERBEST NAKİT:</span>
                <div className="text-3xl font-bold text-emerald-400 mt-1 font-mono">{fmtTl(cashBalance)} TL</div>
              </div>
              <div className="text-right text-slate-400">
                <div>Politika Faizi: <span className="text-sky-300 font-bold">%{market.indices.interestRate.value.toLocaleString('tr-TR')}</span></div>
                <div>Aylık PPF Getiri Potansiyeli: <span className="text-emerald-400 font-bold">~{fmtTl((cashBalance * (market.indices.interestRate.value / 100) / 12))} TL</span></div>
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
              <span className="text-slate-400 text-[11px]">Kasa hareketleri (işlem günlüğü ile senkron):</span>
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {cashMovements.length === 0 ? (
                  <div className="text-slate-500">Kayıt yok — bir işlem yaptığınızda burada görünür.</div>
                ) : cashMovements.slice(0, 15).map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 truncate pr-3">{m.description}</span>
                    <span className={`font-bold ${m.amount > 0 ? 'text-emerald-400' : m.amount < 0 ? 'text-rose-400' : 'text-slate-500'}`}>{m.amount > 0 ? '+' : ''}{fmtTl(m.amount, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 7. 📱 SOSYAL DOĞRULAMA MOTORU */}
        {activeTab === 'social' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-sky-400">SOSYAL MEDYA TAHMİN AYRIŞTIRICI & DOĞRULAMA MOTORU</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Benchmark: @sevketozhan | 7 Adımlı Güven Skoru Algoritması | Ayrıştırma: server-side /api/social-parse</p>
              </div>
              <div className="bg-sky-950 border border-sky-800 px-3 py-1.5 rounded text-sky-300">
                Güven Skoru: <span className={`font-bold text-base ${trustScore >= 80 ? 'text-emerald-400' : trustScore >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>%{trustScore.toLocaleString('tr-TR')}</span>
              </div>
            </div>

            {/* Tweet Yapıştırma Kutusu */}
            <div className="space-y-2">
              <label className="text-slate-300 font-bold">Yeni Tahmin Metni / Tweet Yapıştır:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tweetInput}
                  onChange={(e) => setTweetInput(e.target.value)}
                  placeholder="Örn: @sevketozhan: TLY bugün %0.45 civarı getiri yazabilir..."
                  className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
                <button
                  onClick={handleParseTweet}
                  disabled={parsing}
                  className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> {parsing ? 'ÇÖZÜLÜYOR…' : 'ÇÖZÜMLE & KAYDET'}
                </button>
              </div>
            </div>

            {/* Tahmin Geçmişi */}
            <div className="space-y-2">
              <h3 className="font-bold text-slate-300">KAYITLI TAHMİNLER VE İSABET SKORLARI:</h3>
              <div className="space-y-2">
                {predictions.map((pred) => (
                  <div key={pred.id} className="bg-slate-900 border border-slate-800 p-3 rounded">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sky-400">{pred.predictor_handle}</span>
                        <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-amber-300 font-bold">{pred.fund_code}</span>
                        <span className="text-slate-400 text-[10px] bg-slate-800/60 px-1.5 py-0.5 rounded">{pred.prediction_category}</span>
                        <span className="text-slate-400 text-[10px]">{pred.prediction_date}</span>
                        <span className="text-slate-300">Tahmin: %{pred.predicted_return_pct.toLocaleString('tr-TR')}</span>
                        {pred.actual_return_pct !== undefined && (
                          <span className="text-emerald-400 font-bold">Gerçekleşen: %{pred.actual_return_pct.toLocaleString('tr-TR')}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {pred.accuracy_score !== undefined ? (
                          <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-1 rounded text-[10px] font-bold">
                            İsabet: {pred.accuracy_score} Puan
                          </span>
                        ) : (
                          <>
                            <span className="bg-amber-950 text-amber-300 border border-amber-800 px-2 py-1 rounded text-[10px] font-bold">BEKLİYOR</span>
                            {verifyId === pred.id ? (
                              <span className="flex items-center gap-1">
                                <input
                                  value={verifyPct}
                                  onChange={(e) => setVerifyPct(e.target.value)}
                                  placeholder="Gerç. %"
                                  className="w-20 bg-slate-950 border border-sky-700 rounded px-2 py-1 text-slate-100 focus:outline-none"
                                />
                                <button onClick={handleVerifyPrediction} className="bg-emerald-700 hover:bg-emerald-600 text-white font-bold px-2 py-1 rounded">TAMAM</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => { setVerifyId(pred.id); setVerifyPct(''); }}
                                className="bg-sky-900 hover:bg-sky-800 text-sky-200 px-2 py-1 rounded text-[10px] font-bold border border-sky-800"
                              >
                                İSABETİ DOĞRULA
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-slate-400 mt-1.5 text-[11px]">"{pred.raw_text}"</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                Doğrulama formülü: fark &lt;0.05 → 100 puan, &lt;0.10 → 80, &lt;0.20 → 60, &lt;0.50 → 30, sonrası 0.
                Güven skoru = 0.7 × eski + 0.3 × isabet.
              </p>
            </div>
          </div>
        )}

        {/* 8. ⚙️ AYARLAR & VERİTABANI */}
        {activeTab === 'settings' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-6">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">SİSTEM DURUMU, VERİ KAYNAKLARI & SUPABASE BAĞLANTISI</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Piyasa Verisi (Yahoo Finance):</span>
                  <span className={`font-bold flex items-center gap-1 ${market.source === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {market.source === 'live' ? '🟢 CANLI BAĞLANTI' : '🟡 SON VERİ (25.08.2026)'}
                  </span>
                </div>
                <p className="text-slate-500 text-[10px]">
                  BIST 100, USD/TRY, ons altın & gümüş, BIST hisseleri — 60 sn'de bir çekilir.
                  Kaynağa ulaşılamayan ortamlarda (ör. bu kumanda kutusu) gerçek 25.08.2026 snapshot'ı kullanılır.
                  Vercel'e deploy edilince otomatik CANLI olur.
                  Son çekim: {new Date(market.timestamp).toLocaleString('tr-TR')}.
                </p>
              </div>

              <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">TEFAS Fon Fiyatları (fonaly.com):</span>
                  <span className={`font-bold flex items-center gap-1 ${market.source === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {market.source === 'live' ? '🟢 ENTEGRE' : '🟡 SON VERİ'}
                  </span>
                </div>
                <p className="text-slate-500 text-[10px]">
                  TLY, DFI, KGM, TP2 birim pay fiyatları sunucu tarafında çekilir.
                  TEFAS NAV'lar T+1 yayınlandığından fon fiyatları önceki iş gününe ait olabilir
                  {market.positions?.TLY?.asOf ? ` (TLY: ${market.positions.TLY.asOf})` : ''}.
                </p>
              </div>

              <div className={`bg-slate-900 p-4 rounded border space-y-2 ${dbState === 'connected' ? 'border-sky-800' : 'border-slate-800'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Supabase DB:</span>
                  <span className={`font-bold flex items-center gap-1 ${dbState === 'connected' ? 'text-sky-400' : 'text-slate-500'}`}>
                    {dbState === 'connected' ? '🟢 KALICI (AUTH)' : dbState === 'auth_required' ? '🔒 OTURUM GEREKLİ' : dbState === 'loading' ? '⏳ BAĞLANIYOR' : '⚪ YEREL MOD'}
                  </span>
                </div>
                <p className="text-slate-500 text-[10px]">
                  {dbState === 'connected'
                    ? `Oturum: ${userEmail}. Portföy, kasa, kararlar, işlemler ve tahminler veritabanında kalıcı; RLS yalnızca sizin hesabınıza izin verir.`
                    : dbState === 'auth_required'
                    ? 'Supabase yapılandırıldı ama oturum yok. Aşağıdan giriş yapın veya hesap oluşturun.'
                    : 'NEXT_PUBLIC_SUPABASE_URL / ANON_KEY tanımlı değil — tüm veri bellek içi (refresh ile sıfırlanır). .env dosyası ekleyip yeniden başlatın.'}
                </p>
              </div>
            </div>

            {/* Supabase Auth Paneli */}
            {isSupabaseConfigured() && (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-3">
                <h3 className="font-bold text-slate-300 flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-sky-400" /> VERİTABANI OTURUMU
                </h3>
                {dbState === 'connected' ? (
                  <div className="flex items-center justify-between">
                    <span className="text-emerald-400">🟢 {userEmail} — veriler kalıcı olarak saklanıyor.</span>
                    <button onClick={handleSignOut} className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded flex items-center gap-1.5 border border-slate-700">
                      <LogOut className="w-3 h-3" /> ÇIKIŞ
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} type="email" placeholder="E-posta" className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500" />
                      <input value={authPass} onChange={(e) => setAuthPass(e.target.value)} type="password" placeholder="Şifre (min 6)" className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 focus:outline-none focus:border-sky-500" />
                    </div>
                    <div className="flex gap-2 flex-wrap items-center">
                      <button onClick={() => handleAuth('in')} disabled={authBusy} className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded flex items-center gap-1.5">
                        <LogIn className="w-3.5 h-3.5" /> GİRİŞ YAP
                      </button>
                      <button onClick={() => handleAuth('up')} disabled={authBusy} className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold px-4 py-2 rounded border border-slate-700">
                        HEPSAP OLUŞTUR
                      </button>
                      {authMsg && <span className="text-[11px] text-amber-300">{authMsg}</span>}
                    </div>
                    <p className="text-[10px] text-slate-500">
                      İlk girişte yerleşik portföyünüz otomatik olarak Supabase'e aktarılır. Şema: supabase/supabase_schema.sql (v2 — auth tabanlı RLS).
                    </p>
                  </>
                )}
              </div>
            )}

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-300">VERİTABANI YEDEKLEME (JSON EXPORT):</h3>
                <p className="text-slate-500 text-[10px] mt-0.5">Tüm portföy, işlem günlüğü, kararlar ve tahminleri tek dosya olarak indir.</p>
              </div>
              <button
                onClick={() => {
                  const data = JSON.stringify({ exportedAt: new Date().toISOString(), initialCapital, cashBalance, positions, decisions, transactions, cashMovements, predictions, trustScore }, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `yatirim-terminali-yedek-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2 rounded flex items-center gap-2 border border-slate-700"
              >
                <Download className="w-3.5 h-3.5" /> JSON YEDEK İNDİR
              </button>
            </div>
          </div>
        )}

      </main>

      {/* 🦶 FOOTER */}
      <footer className="border-t border-slate-800/80 bg-[#0d121f] px-6 py-3 text-center text-[10px] font-mono text-slate-500">
        Yatırım Terminali v3.1 — *Bu sistemdeki analizler ve algoritmik modeller kişisel karar destek amaçlıdır, resmi yatırım tavsiyesi niteliğinde değildir.*
      </footer>
    </div>
  );
}
