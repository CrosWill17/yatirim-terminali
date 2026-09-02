'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  TrendingUp, DollarSign, PieChart, ShieldAlert,
  AlertTriangle, ArrowUpRight, ArrowDownRight,
  RefreshCw, Activity, Download, Play, Send, PlusCircle,
} from 'lucide-react';
import {
  ResponsiveContainer, PieChart as RPieChart, Pie, Cell, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, ReferenceLine,
} from 'recharts';
import { calculateTax, calculateAccuracyScore, updateTrustScore } from '@/lib/calculations';
import {
  Position, Decision, CashMovement, SocialPrediction, Transaction,
  FundHoldingRow, WriteResult,
} from '@/lib/types';
import type { MarketData } from '@/lib/marketData';
import { PUBLIC_SEED_MARKET } from '@/lib/marketSeedPublic';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { TÜR_LABEL } from '@/lib/assetMeta';
import {
  loadAll, upsertPosition, upsertDecision, insertTransaction,
  insertCashMovement, insertPrediction, updatePrediction,
  setInitialCapital, saveDailySnapshot, upsertFundHolding, upsertFundHoldingAuto, deleteFundHolding,
  approveProposal, rejectProposal,
} from '@/lib/repo';
import type { FundHoldingProposal } from '@/lib/repo';
import { computeFundPrediction, displayablePrediction, FundPrediction, HoldingPrice } from '@/lib/fundHoldings';
import { formatSensitive, formatPublic, maskText, readMaskPreference, writeMaskPreference, MASK } from '@/lib/mask';
import { GUEST_TABS, USER_TABS, TabId } from '@/lib/tabs';
import ErrorBanner from '@/components/ErrorBanner';
import PrivacyToggle from '@/components/PrivacyToggle';
import LoginPanel from '@/components/LoginPanel';
import GuestMarketView from '@/components/GuestMarketView';
import FundContentTab, { FundHoldingDraft } from '@/components/FundContentTab';

/* ------------------------------------------------------------------ */
/* Not: Yerleşik portföy verisi (adet/maliyet/stop/karar metinleri) bu  */
/* dosyada YOKTUR — site herkese açık olduğu için client bundle'a       */
/* gömülürdü. Seed lib/serverSeed.ts içinde sunucu-özel durur ve ilk    */
/* girişte /api/seed üzerinden (oturum doğrulanarak) çekilir.          */
/* ------------------------------------------------------------------ */

interface AlertItem { code: string; level: 'DANGER' | 'WARN' | 'INFO'; title: string; detail: string; }

/**
 * P0: 'local' (YEREL MOD) durumu kaldırıldı.
 *  setup_error : env tanımlı değil → açık "Kurulum hatası" ekranı
 *  db_error    : okuma/yazma başarısız → kırmızı rozet + banner
 */
type DbState = 'setup_error' | 'loading' | 'auth_required' | 'connected' | 'db_error';

const CHART_COLORS = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#4ade80', '#f87171', '#e2e8f0'];

const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#0d121f', border: '1px solid #1e293b', borderRadius: 8,
  color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
};

export default function Home() {
  const configured = isSupabaseConfigured();
  const [activeTab, setActiveTab] = useState<TabId>('market');

  /* ------------------------- Durum (State) ------------------------- */
  // Portföy verisi başlangıçta BOŞ: hiçbir kişisel sayı DB'den gelmeden render edilmez.
  const [positions, setPositions] = useState<Position[]>([]);
  const [cashBalance, setCashBalance] = useState<number>(0);
  const [initialCapital, setInitialCapitalState] = useState<number>(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cashMovements, setCashMovements] = useState<CashMovement[]>([]);
  const [predictions, setPredictions] = useState<SocialPrediction[]>([]);
  const [fundHoldings, setFundHoldings] = useState<FundHoldingRow[]>([]);
  const [proposals, setProposals] = useState<FundHoldingProposal[]>([]);
  // Kanonik ad/tür eşlemesi SUNUCUDAN gelir (portföyü ele verdiği için bundle'da durmaz)
  const [assetMeta, setAssetMeta] = useState<Record<string, { name: string; type: Position['asset_type'] }>>({});
  const [holdingPrices, setHoldingPrices] = useState<Record<string, HoldingPrice | null>>({});
  const [tweetInput, setTweetInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [trustScore, setTrustScore] = useState(78.5);
  const [market, setMarket] = useState<MarketData>(PUBLIC_SEED_MARKET);

  // Veritabanı & oturum
  const [dbState, setDbState] = useState<DbState>(configured ? 'loading' : 'setup_error');
  const [dbError, setDbError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // Oturum token'ı: /api/asset-meta, /api/seed ve /api/market gibi sunucu
  // uçlarına Authorization: Bearer <token> göndermek için kullanılır.
  const [accessToken, setAccessToken] = useState<string | null>(null);

  // P0 — yazma hataları ve son başarılı kayıt zamanı
  const [writeErrors, setWriteErrors] = useState<Record<string, string>>({});
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  // P2 — gizlilik maskesi (localStorage'da kalıcı, varsayılan KAPALI)
  const [masked, setMasked] = useState(false);
  useEffect(() => { setMasked(readMaskPreference()); }, []);
  const toggleMask = () => setMasked((m) => { writeMaskPreference(!m); return !m; });

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

  /* --------------- Biçimlendirme yardımcıları (P2) ---------------- */
  /** HASSAS: TL tutarı. */
  const fmtTl = (v: number, digits = 0) => formatSensitive(v, masked, { digits, suffix: ' TL' });
  /** HASSAS: adet. */
  const fmtQty = (v: number, digits = 4) => formatSensitive(v, masked, { digits });
  /** HASSAS: TL, imzalı (K/Z). */
  const fmtTlSigned = (v: number, digits = 0) => formatSensitive(v, masked, { digits, suffix: ' TL', signed: true });
  /** HASSAS: yüzde (maliyet üstü getiri gibi kişisel oranlar). */
  const fmtPctSensitive = (v: number, digits = 1) => (masked ? MASK : `%${formatPublic(v, { digits })}`);
  /** KAMU: yüzde/fiyat — asla maskelenmez. */
  const fmtPub = (v: number, digits = 2) => formatPublic(v, { digits });

  /* ------------------- Supabase Oturum İzleme --------------------- */
  useEffect(() => {
    if (!configured) { setDbState('setup_error'); return; }
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user?.email ?? null);
      setAccessToken(data.session?.access_token ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserEmail(session?.user?.email ?? null);
      setAccessToken(session?.access_token ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  const isGuest = !userEmail;

  /* ------ Kanonik varlık adları: /api/asset-meta (oturum gerekli) --- */
  useEffect(() => {
    if (!configured || isGuest) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/asset-meta', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled && json?.assetMeta) setAssetMeta(json.assetMeta);
      } catch {
        /* ad eşlemesi yoksa DB'deki adlar kullanılır */
      }
    })();
    return () => { cancelled = true; };
  }, [configured, isGuest]);

  /* THF ve diğer fonlar için kanonik tür senkronu — assetMeta değiştiğinde pozisyonları düzelt */
  useEffect(() => {
    if (Object.keys(assetMeta).length === 0 || positions.length === 0) return;
    const toFix = positions.filter((pos) => {
      const m = assetMeta[pos.symbol];
      return m && (pos.asset_name !== m.name || pos.asset_type !== m.type);
    });
    if (toFix.length === 0) return;
    // Local state'i hemen düzelt
    setPositions((prev) => prev.map((p) => {
      const m = assetMeta[p.symbol];
      return m ? { ...p, asset_name: m.name, asset_type: m.type } : p;
    }));
    // DB'yi de düzelt (sessiz, hata banner'ı yok)
    toFix.forEach((pos) => {
      const m = assetMeta[pos.symbol];
      if (m) {
        void upsertPosition({ ...pos, asset_name: m.name, asset_type: m.type });
      }
    });
  }, [assetMeta]);

  /* ------- Canlı piyasa verisi: girişli kullanıcı (60 sn) --------- */
  useEffect(() => {
    if (!configured || isGuest) return; // misafir /api/market'i ÇAĞIRMAZ (P1)
    let cancelled = false;
    const load = () => {
      if (!accessToken) return;
      fetch('/api/market', { headers: { Authorization: `Bearer ${accessToken}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d && d.indices) setMarket(d); })
        .catch(() => { /* son bilinen veride kalır */ });
    };
    load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [configured, isGuest, accessToken]);

  /* ------- Dinamik pozisyon fiyatları: yeni eklenen hisse/fon otomatik fiyat --------- */
  useEffect(() => {
    if (!configured || isGuest || positions.length === 0) return;
    // market.positions'da olmayan semboller (yeni eklenenler)
    const missing = Array.from(new Set(positions.map((p) => p.symbol))).filter((sym) => !market.positions?.[sym]);
    if (missing.length === 0) return;
    let cancelled = false;
    // Fon + hisse karışık — /api/market/quotes artık fonaly + Yahoo deniyor
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(missing.join(','))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.quotes) return;
        setMarket((prev) => {
          const newPositions = { ...prev.positions };
          let added = 0;
          for (const [code, q] of Object.entries(d.quotes as Record<string, any>)) {
            if (q && Number.isFinite(q.price) && q.price > 0) {
              newPositions[code] = {
                price: Number(q.price),
                changePct: q.changePct != null && Number.isFinite(q.changePct) ? Number(q.changePct) : null,
                asOf: new Date().toLocaleDateString('tr-TR'),
              };
              added++;
            }
          }
          if (added === 0) return prev;
          return {
            ...prev,
            positions: newPositions,
            source: 'live' as const,
            timestamp: new Date().toISOString(),
            dataDate: new Date().toLocaleDateString('tr-TR'),
          };
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [positions, market.positions, configured, isGuest]);

  /* ------------------- Yazma takibi (P0) -------------------------- */
  const pendingRef = useRef(0);
  /**
   * Her yazma bu sarmalayıcıdan geçer:
   *  - başarılıysa "Son kayıt" zaman damgası güncellenir
   *  - başarısızsa hata banner'da GÖRÜNÜR olur (sessiz yutma yok)
   */
  async function track(label: string, p: Promise<WriteResult>): Promise<boolean> {
    pendingRef.current += 1;
    try {
      const res = await p;
      setWriteErrors((prev) => {
        const next = { ...prev };
        if (res.ok) delete next[label];
        else next[label] = res.error.message;
        return next;
      });
      if (res.ok) {
        setLastSavedAt(new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        return true;
      }
      return false;
    } finally {
      pendingRef.current -= 1;
    }
  }

  /* --------- Seed'i sunucudan çek (P0 — bundle'da durmaz) --------- */
  async function fetchSeed(): Promise<{
    positions: Position[]; decisions: Decision[]; initialCapital: number; cashBalance: number;
  } | null> {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return null;
      const res = await fetch('/api/seed', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.ok ? json : null;
    } catch {
      return null;
    }
  }

  /* ------------- Veritabanı Yükleme + İlk Kurulum Aktarımı --------- */
  const hydratedRef = useRef(false);
  const assetMetaRef = useRef(assetMeta);
  assetMetaRef.current = assetMeta;
  useEffect(() => {
    if (!configured) { setDbState('setup_error'); return; }
    if (!userEmail) { setDbState('auth_required'); hydratedRef.current = false; return; }
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;
    (async () => {
      setDbState('loading');
      const result = await loadAll();
      if (cancelled) return;

      // P0: okuma başarısızsa sahte "connected" YOK → db_error + kırmızı banner
      if (!result.ok) {
        setDbState('db_error');
        setDbError(result.error.message);
        return;
      }
      const bundle = result.bundle;

      // İlk kurulum: DB boşsa yerleşik portföy SUNUCUDAN çekilip aktarılır
      if (bundle.positions.length === 0 || bundle.decisions.length === 0 || bundle.cashBalance == null) {
        const seed = await fetchSeed();
        if (!cancelled && seed) {
          if (bundle.positions.length === 0) {
            await Promise.all(seed.positions.map((p) => upsertPosition(p)));
          }
          if (bundle.decisions.length === 0) {
            await Promise.all(seed.decisions.map((d) => upsertDecision(d)));
          }
          if (bundle.cashBalance == null) {
            await setInitialCapital(seed.initialCapital);
            await insertCashMovement({
              id: 'seed-cash', movement_type: 'BASLANGIC', amount: seed.cashBalance,
              balance_after: seed.cashBalance, description: 'Mevcut Kullanılabilir Serbest Nakit',
              category: 'BASLANGIC', created_at: new Date().toISOString(),
            });
          }
        }
      }

      if (cancelled) return;

      // Kanonik ad/tür senkronu (eski kayıtlar resmî adlarla güncellenir)
      const meta = assetMetaRef.current;
      const renames = bundle.positions.filter((p) => {
        const m = meta[p.symbol];
        return m && (p.asset_name !== m.name || p.asset_type !== m.type);
      });
      if (renames.length > 0) {
        await Promise.all(renames.map((p) => {
          const m = meta[p.symbol];
          return upsertPosition({ ...p, asset_name: m.name, asset_type: m.type });
        }));
      }

      if (cancelled) return;
      setPositions(bundle.positions.map((p) => {
        const m = meta[p.symbol];
        return m ? { ...p, asset_name: m.name, asset_type: m.type } : p;
      }));
      setDecisions(bundle.decisions);
      setTransactions(bundle.transactions);
      setCashMovements(bundle.cashMovements);
      setPredictions(bundle.predictions);
      setFundHoldings(bundle.fundHoldings);
      setProposals((bundle as any).proposals ?? []);
      setCashBalance(bundle.cashBalance ?? 0);
      setInitialCapitalState(bundle.initialCapital ?? 0);
      setDbState('connected');
      setDbError(null);
    })();
    return () => { cancelled = true; };
  }, [userEmail, configured]);

  /* --------- Fon hisse fiyatları (P3 — günlük tahmin/etki) -------- */
  useEffect(() => {
    if (isGuest || fundHoldings.length === 0) { setHoldingPrices({}); return; }
    const codes = Array.from(new Set(fundHoldings.map((h) => h.ticker)));
    let cancelled = false;
    fetch(`/api/market/quotes?symbols=${encodeURIComponent(codes.join(','))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.quotes) return;
        const map: Record<string, HoldingPrice | null> = {};
        for (const code of Object.keys(d.quotes)) {
          const q = d.quotes[code];
          map[code] = q && Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.changePct)
            ? { price: Number(q.price), changePct: Number(q.changePct) }
            : null;
        }
        setHoldingPrices(map);
      })
      .catch(() => { /* fiyatı eksik hisse → katkı 0 (VERİ EKSİK) */ });
    return () => { cancelled = true; };
  }, [fundHoldings, isGuest]);

  /* --------- Yeni fonlar için içerik otomatik araştırma (P3 genişletme) -------- */
  const researchingRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isGuest || positions.length === 0) return;
    // TEFAS fonu olup fund_holdings'de hiç kaydı olmayan fonlar — THF dahil
    // asset_type kontrolü + bilinen fon kodları (TLY, DFI, THF, GUM vb.) için fallback
    const KNOWN_FUND_CODES = ['TLY','DFI','THF','GUM','YZG','MJG','DMG','GMC','AK2','KGM','TP2'];
    const fundCodesInPortfolio = Array.from(
      new Set(
        positions
          .filter((p) => p.asset_type === 'TEFAS_FON' || p.asset_type === 'PPF' || KNOWN_FUND_CODES.includes(p.symbol.toUpperCase()))
          .map((p) => p.symbol.toUpperCase())
      )
    );
    const existingFundCodes = new Set(fundHoldings.map((h) => h.fund_code.toUpperCase()));
    const toResearch = fundCodesInPortfolio.filter((c) => !existingFundCodes.has(c) && !researchingRef.current.has(c) && !['KGM','TP2'].includes(c));
    if (toResearch.length === 0) return;

    toResearch.forEach((code) => researchingRef.current.add(code));

    (async () => {
      for (const code of toResearch) {
        try {
          if (!accessToken) continue;
          const res = await fetch(`/api/fund-holdings/fetch?code=${encodeURIComponent(code)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok) continue;
          const data = await res.json();
          if (!data?.ok || !Array.isArray(data.holdings) || data.holdings.length === 0) continue;

          // Otomatik olarak fund_holdings'e yaz (source=auto, sync ezebilir)
          for (const h of data.holdings) {
            await track(`Fon içeriği otomatik ${code}`, upsertFundHoldingAuto({
              fund_code: h.fund_code,
              ticker: h.ticker,
              company_name: h.company_name ?? null,
              weight_pct: h.weight_pct,
              as_of_date: h.as_of_date,
              notes: h.notes ?? `${data.reportLabel ?? data.source} (otomatik)`,
              source: data.source ?? 'auto',
            } as any));
          }

          // Local state'e ekle (DB'den tekrar çekmeden anında görünsün)
          setFundHoldings((prev) => {
            const filtered = prev.filter((r) => r.fund_code.toUpperCase() !== code.toUpperCase());
            const newRows = (data.holdings as any[]).map((h: any, idx: number) => ({
              id: `auto-${code}-${h.ticker}-${idx}`,
              fund_code: h.fund_code,
              ticker: h.ticker,
              company_name: h.company_name ?? null,
              weight_pct: h.weight_pct,
              as_of_date: h.as_of_date,
              source: (data.source ?? 'auto') as any,
              notes: h.notes ?? null,
            }));
            return [...filtered, ...newRows];
          });
        } catch {
          // sessiz: bir sonraki turda tekrar denenecek
        } finally {
          researchingRef.current.delete(code);
        }
      }
    })();
  }, [positions, fundHoldings, isGuest, accessToken]);

  /* ------------------- Türetilmiş Değerler ------------------------ */
  const livePositions: Position[] = positions.map((pos) => {
    const meta = assetMeta[pos.symbol];
    const q = market.positions?.[pos.symbol];
    const base: Position = { ...pos, asset_name: meta?.name ?? pos.asset_name, asset_type: meta?.type ?? pos.asset_type };
    if (q && typeof q.price === 'number' && q.price > 0 && pos.quantity > 0) {
      return { ...base, current_price: q.price, daily_change_pct: q.changePct };
    }
    return base;
  });

  const posValue = (p: Position) => p.quantity * (p.current_price || p.unit_cost);
  const stockRows = livePositions.filter((p) => p.asset_type === 'BIST_HISSE').sort((a, b) => posValue(b) - posValue(a));
  const fundRows = livePositions.filter((p) => p.asset_type !== 'BIST_HISSE').sort((a, b) => posValue(b) - posValue(a));
  const stockTotal = stockRows.reduce((s, p) => s + posValue(p), 0);
  const fundTotal = fundRows.reduce((s, p) => s + posValue(p), 0);
  const stockPnl = stockRows.reduce((s, p) => s + posValue(p) - p.quantity * p.unit_cost, 0);
  const fundPnl = fundRows.reduce((s, p) => s + posValue(p) - p.quantity * p.unit_cost, 0);

  const totalStockAndFundValue = livePositions.reduce((acc, pos) => acc + posValue(pos), 0);
  const totalPortfolioValue = totalStockAndFundValue + cashBalance;
  const totalCost = livePositions.reduce((acc, pos) => acc + pos.quantity * pos.unit_cost, 0);
  const totalUnrealizedPnL = totalStockAndFundValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalUnrealizedPnL / totalCost) * 100 : 0;
  const totalNetYieldAgainstCapital = initialCapital > 0 ? ((totalPortfolioValue - initialCapital) / initialCapital) * 100 : 0;

  /* P3 — fon bazlı günlük tahmin (fon içeriği × canlı hisse değişimi) */
  const fundPredictions = useMemo(() => {
    const out: Record<string, FundPrediction> = {};
    for (const code of Array.from(new Set(fundHoldings.map((h) => h.fund_code)))) {
      const holdings = fundHoldings
        .filter((h) => h.fund_code === code)
        .map((h) => ({ ticker: h.ticker, name: h.company_name, weightPct: h.weight_pct, prevWeightPct: null }));
      out[code] = computeFundPrediction(code, holdings, holdingPrices);
    }
    return out;
  }, [fundHoldings, holdingPrices]);

  // Dinamik alarmlar (TL değerleri maske duyarlı)
  const alerts: AlertItem[] = useMemo(() => {
    const list: AlertItem[] = [];
    for (const p of livePositions) {
      if (!p.current_price || p.quantity <= 0) continue;
      const cp = p.current_price;
      if (p.stop_price && cp <= p.stop_price) {
        list.push({ code: p.symbol, level: 'DANGER', title: `STOP KIRILDI: ${p.symbol}`, detail: `Fiyat ${fmtTl(cp, 2)} ≤ stop ${fmtTl(p.stop_price, 2)}. Strateji: ${p.current_action}.` });
      } else if (p.stop_price && cp <= p.stop_price * 1.03) {
        list.push({ code: p.symbol, level: 'WARN', title: `STOPA YAKIN: ${p.symbol}`, detail: `Fiyat ${fmtTl(cp, 2)}, stop ${fmtTl(p.stop_price, 2)} (mesafe %${(((p.stop_price - cp) / cp) * 100).toFixed(1)}).` });
      }
      if (p.target_price && cp >= p.target_price) {
        list.push({ code: p.symbol, level: 'INFO', title: `HEDEFE ULAŞTI: ${p.symbol}`, detail: `Fiyat ${fmtTl(cp, 2)} ≥ hedef ${fmtTl(p.target_price, 2)}. Kâr alma kademelerini gözden geçirin.` });
      }
      if ((p.daily_change_pct ?? 0) <= -5) {
        list.push({ code: p.symbol, level: 'WARN', title: `GÜNLÜK SERT DÜŞÜŞ: ${p.symbol}`, detail: `Günlük değişim %${(p.daily_change_pct as number).toLocaleString('tr-TR')}.` });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePositions, masked]);

  const dangerCount = alerts.filter((a) => a.level === 'DANGER').length;
  const warnCount = alerts.filter((a) => a.level === 'WARN').length;

  const orderedPositions = useMemo(
    () => [...stockRows, ...fundRows].filter((p) => p.quantity > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [livePositions]
  );

  const allocData = useMemo(() => {
    const rows = orderedPositions.map((p, i) => ({
      name: p.symbol,
      value: Number(posValue(p).toFixed(2)),
      color: CHART_COLORS[i % CHART_COLORS.length],
    }));
    rows.push({ name: 'NAKİT', value: Number(cashBalance.toFixed(2)), color: '#10b981' });
    return rows;
  }, [orderedPositions, cashBalance]);

  const pnlData = useMemo(
    () => orderedPositions.map((p) => ({
      name: p.symbol,
      pnl: Number((posValue(p) - p.quantity * p.unit_cost).toFixed(0)),
    })),
    [orderedPositions]
  );

  const fmtChange = (p: number | null | undefined) => {
    if (p === null || p === undefined) return <span className="text-slate-500">—</span>;
    const up = p >= 0;
    return (
      <span className={`flex items-center ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
        {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
        {up ? '+' : ''}{formatPublic(p)}%
      </span>
    );
  };

  // Portföy tablosu satırı (hisse ve fon gruplarında ortak)
  const renderPosRow = (pos: Position) => {
    const value = posValue(pos);
    const pnl = value - pos.quantity * pos.unit_cost;
    const asOf = market.positions?.[pos.symbol]?.asOf;
    const stopBreached = pos.stop_price && pos.current_price != null && pos.current_price <= pos.stop_price;
    // P3: yalnızca fon içeriği KAYDI OLAN fonlarda tahmin gösterilir; içeriği olmayan fon → "—"
    const pred = displayablePrediction(fundPredictions[pos.symbol]);
    return (
      <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
        <td className="p-3 font-bold text-sky-400" title={asOf ? `Son fiyat tarihi: ${asOf}` : undefined}>{pos.symbol}</td>
        <td className="p-3 text-slate-300" title={pos.rationale}>{pos.asset_name}</td>
        <td className="p-3 text-slate-400 text-[10px]">{TÜR_LABEL[pos.asset_type] ?? pos.asset_type}</td>
        <td className="p-3 text-right text-slate-200">{fmtQty(pos.quantity)}</td>
        <td className="p-3 text-right text-slate-300">{formatSensitive(pos.unit_cost, masked, { digits: 4, minDigits: 2, suffix: ' TL' })}</td>
        <td className="p-3 text-right font-bold text-slate-100">
          {formatPublic(pos.current_price || pos.unit_cost, { digits: 4 })} TL
        </td>
        <td className={`p-3 text-right font-bold ${
          pos.daily_change_pct === null || pos.daily_change_pct === undefined
            ? 'text-slate-500'
            : pos.daily_change_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
        }`}>
          {pos.daily_change_pct === null || pos.daily_change_pct === undefined
            ? '—'
            : `${pos.daily_change_pct >= 0 ? '+' : ''}${formatPublic(pos.daily_change_pct)}%`}
        </td>
        <td className="p-3 text-right font-bold text-slate-200">{fmtTl(value)}</td>
        <td className={`p-3 text-right font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtTlSigned(pnl)}</td>
        <td className="p-3 text-right text-[11px]">
          {pred && pred.predictedPct != null ? (
            <span title={`Kaplanan hisse ağırlığı %${formatPublic(pred.coveredPct)}${pred.missingTickers.length ? ` • fiyatı eksik: ${pred.missingTickers.join(', ')}` : ''}`}>
              <span className={pred.predictedPct >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {pred.predictedPct >= 0 ? '+' : ''}{formatPublic(pred.predictedPct)}%
              </span>
              <span className="text-slate-500"> / %{formatPublic(pred.coveredPct, { digits: 0 })}</span>
            </span>
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </td>
        <td className={`p-3 text-center font-bold ${stopBreached ? 'text-rose-400' : 'text-rose-400/70'}`}>
          {pos.stop_price ? `${fmtTl(pos.stop_price)}${stopBreached ? ' ⛔' : ''}` : '—'}
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
  };

  /* ----------------------- Aksiyonlar ----------------------------- */

  const handleApplyDecision = async (id: string) => {
    const dec = decisions.find((d) => d.id === id);
    if (!dec) return;
    const updated: Decision = { ...dec, status: 'uygulandi' };
    setDecisions((prev) => prev.map((d) => (d.id === id ? updated : d)));

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

    await track('Karar güncelleme', upsertDecision(updated));
    await track('Kasa kaydı', insertCashMovement(mov));
    if (dec.symbol !== 'PORTFOY' && dec.symbol !== 'NAKIT') {
      const pos = positions.find((p) => p.symbol === dec.symbol);
      if (pos) {
        await track('Pozisyon kaydı', upsertPosition({
          ...pos, stop_price: dec.stop_price ?? pos.stop_price, target_price: dec.target_price ?? pos.target_price,
        }));
      }
    }
  };

  const handleAddTransaction = async () => {
    const symbol = txSymbol.trim().toUpperCase();
    const q = parseFloat(txQty.replace(',', '.'));
    const price = parseFloat(txPrice.replace(',', '.'));
    if (!symbol || !Number.isFinite(q) || q <= 0 || !Number.isFinite(price) || price < 0) {
      setTxError('Kod, adet ve fiyat geçerli olmalıdır.');
      return;
    }
    const ts = new Date().toISOString();
    const total = Number((q * price).toFixed(4));
    let cashDelta = 0;
    let realizedPnl = 0;
    let tax = 0;
    let nextPositions: Position[] = positions;
    let msg = '';

    if (txType === 'SATIS') {
      const pos = positions.find((p) => p.symbol === symbol);
      if (!pos) { setTxError('Bu kod portföyde yok — önce ALIŞ ile ekleyin.'); return; }
      if (q > pos.quantity + 1e-9) { setTxError(`Satılabilir maksimum: ${fmtQty(pos.quantity)} pay`); return; }
      const totalCost = pos.quantity * pos.unit_cost;
      const soldCost = (q / pos.quantity) * totalCost;
      const t = calculateTax(pos.asset_type, symbol, soldCost, total);
      tax = t.taxAmount;
      realizedPnl = total - soldCost - tax;
      cashDelta = total - tax;
      const newQty = Number((pos.quantity - q).toFixed(4));
      nextPositions = positions.map((p) =>
        p.symbol === symbol ? { ...p, quantity: newQty, current_action: newQty <= 1e-9 ? 'KAPANDI' : p.current_action } : p
      );
      msg = `${symbol} SATIŞ ${fmtQty(q)} × ${fmtPub(price, 4)} TL` + (tax > 0 ? ` — stopaj ${fmtTl(tax, 2)} kesildi` : '');
    } else if (txType === 'ALIS') {
      if (total > cashBalance) { setTxError(`Yetersiz nakit: kasada ${fmtTl(cashBalance)} var.`); return; }
      cashDelta = -total;
      const pos = positions.find((p) => p.symbol === symbol);
      if (pos) {
        const oldCost = pos.quantity * pos.unit_cost;
        const newQty = Number((pos.quantity + q).toFixed(4));
        const newUnitCost = Number((((oldCost + total) / newQty) * 10000).toFixed(0)) / 10000;
        nextPositions = positions.map((p) => (p.symbol === symbol ? { ...p, quantity: newQty, unit_cost: newUnitCost, current_action: 'TUT' } : p));
      } else {
        nextPositions = [
          ...positions,
          {
            id: Date.now().toString(), symbol, asset_name: assetMeta[symbol]?.name ?? symbol,
            asset_type: assetMeta[symbol]?.type ?? 'BIST_HISSE',
            quantity: q, unit_cost: price, current_price: market.positions?.[symbol]?.price ?? price,
            risk_score: 5, current_action: 'TUT', rationale: 'Terminal üzerinden açılan pozisyon.', is_active: true,
          },
        ];
      }
      msg = `${symbol} ALIŞ ${fmtQty(q)} × ${fmtPub(price, 4)} TL`;
    } else {
      cashDelta = total;
      msg = `${symbol} TEMETTU +${fmtTl(total, 2)}`;
    }

    const newCash = Number((cashBalance + cashDelta).toFixed(2));
    const txn: Transaction = {
      id: Date.now().toString(), symbol, transaction_type: txType,
      quantity: q, unit_price: price, total_amount: total,
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
    if (updatedPos) await track('Pozisyon kaydı', upsertPosition(updatedPos));
    await track('İşlem kaydı', insertTransaction(txn));
    await track('Kasa kaydı', insertCashMovement(mov));
  };

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
          status: p.predictedReturnPct == null ? 'VERI_EKSİK' : 'BEKLIYOR',
        };
        setPredictions((prev) => [newPred, ...prev]);
        await track('Tahmin kaydı', insertPrediction(newPred));
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

  const handleVerifyPrediction = async () => {
    if (!verifyId) return;
    const actual = parseFloat(verifyPct.replace(',', '.'));
    if (!Number.isFinite(actual)) return;
    const pred = predictions.find((p) => p.id === verifyId);
    if (!pred || pred.predicted_return_pct == null) return; // VERİ EKSİK satır doğrulanamaz
    const acc = calculateAccuracyScore(pred.predicted_return_pct, actual);
    const newTrust = updateTrustScore(trustScore, acc);
    const updated: SocialPrediction = { ...pred, actual_return_pct: actual, accuracy_score: acc, status: 'DOGRULANDI' };
    setPredictions((prev) => prev.map((p) => (p.id === verifyId ? updated : p)));
    setTrustScore(newTrust);
    await track('Tahmin doğrulama', updatePrediction(updated));
    setVerifyId(null);
    setVerifyPct('');
  };

  /* --------- Fon içeriği manuel override (P3, source='manual') ---- */
  const handleUpsertHolding = async (draft: FundHoldingDraft) => {
    const ok = await track('Fon içeriği kaydı', upsertFundHolding(draft));
    if (!ok) return;
    setFundHoldings((prev) => {
      const others = prev.filter((r) => !(r.fund_code === draft.fund_code && r.ticker === draft.ticker));
      const existing = prev.find((r) => r.fund_code === draft.fund_code && r.ticker === draft.ticker);
      return [
        ...others,
        {
          id: existing?.id ?? `manual-${Date.now()}`,
          fund_code: draft.fund_code,
          ticker: draft.ticker,
          company_name: draft.company_name ?? null,
          weight_pct: draft.weight_pct,
          as_of_date: draft.as_of_date,
          source: 'manual' as const,
          notes: draft.notes ?? 'manuel override (UI)',
        },
      ];
    });
  };

  const handleDeleteHolding = async (id: string) => {
    const ok = await track('Fon içeriği silme', deleteFundHolding(id));
    if (ok) setFundHoldings((prev) => prev.filter((r) => r.id !== id));
  };

  const handleApproveProposal = async (p: FundHoldingProposal) => {
    // Önce fund_holdings'e yaz (manual source, twitter-photo notu)
    const draft = {
      fund_code: p.fund_code,
      ticker: p.ticker,
      weight_pct: p.weight_pct,
      as_of_date: new Date().toISOString().slice(0, 10),
      notes: `twitterdan ${p.predictor_handle ?? '@sevketozhan'} hesabının günlük etki paylaşımından #${p.ticker} ağırlığı %${p.weight_pct} olarak değişti bilgisi çekildi (tweet ${p.source_tweet_id}) onaylandı`,
    };
    const ok1 = await track(`Fon içeriği onay ${p.fund_code} ${p.ticker}`, upsertFundHolding(draft as any));
    if (!ok1) return;
    // Proposal'ı approved yap
    const ok2 = await track('Öneri onay', approveProposal(p.id));
    if (ok2) {
      setProposals((prev) => prev.filter((x) => x.id !== p.id));
      setFundHoldings((prev) => {
        const others = prev.filter((r) => !(r.fund_code === p.fund_code && r.ticker === p.ticker));
        const existing = prev.find((r) => r.fund_code === p.fund_code && r.ticker === p.ticker);
        return [
          ...others,
          {
            id: existing?.id ?? `manual-${Date.now()}-${p.ticker}`,
            fund_code: p.fund_code,
            ticker: p.ticker,
            company_name: existing?.company_name ?? null,
            weight_pct: p.weight_pct,
            as_of_date: draft.as_of_date,
            source: 'manual' as const,
            notes: draft.notes,
          },
        ];
      });
    }
  };

  const handleRejectProposal = async (id: string) => {
    const ok = await track('Öneri reddet', rejectProposal(id));
    if (ok) setProposals((prev) => prev.filter((x) => x.id !== id));
  };

  const handleSignedOut = () => {
    // Oturum kapandı: kişisel veriler bellekten de silinir (misafir görünümü temiz).
    setPositions([]); setDecisions([]); setTransactions([]); setCashMovements([]);
    setPredictions([]); setFundHoldings([]); setProposals([]); setHoldingPrices({});
    setCashBalance(0); setInitialCapitalState(0);
    setWriteErrors({}); setLastSavedAt(null); setDbError(null);
    setAssetMeta({});
    setTrustScore(78.5);
    setMarket(PUBLIC_SEED_MARKET);
    setAccessToken(null);
    hydratedRef.current = false;
    setDbState('auth_required');
    setActiveTab('market');
  };

  // Günlük portföy snapshot (DB bağlıyken bir kez)
  const snapshotSavedRef = useRef(false);
  useEffect(() => {
    if (dbState !== 'connected' || snapshotSavedRef.current) return;
    snapshotSavedRef.current = true;
    const breakdown: Record<string, number> = {};
    livePositions.forEach((p) => { breakdown[p.symbol] = Number(posValue(p).toFixed(2)); });
    breakdown['NAKİT'] = Number(cashBalance.toFixed(2));
    void track('Günlük snapshot', saveDailySnapshot(
      new Date().toISOString().split('T')[0], Number(totalPortfolioValue.toFixed(2)), cashBalance, breakdown
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbState]);

  /* --------------------------- RENDER ----------------------------- */

  const dbChip =
    dbState === 'connected' ? { txt: '☁️ DB KALICI', cls: 'bg-sky-950 text-sky-300 border-sky-800' } :
    dbState === 'loading' ? { txt: '⏳ DB…', cls: 'bg-slate-800 text-slate-300 border-slate-700' } :
    dbState === 'auth_required' ? { txt: '🔒 OTURUM GEREKLİ', cls: 'bg-amber-950 text-amber-300 border-amber-800' } :
    dbState === 'db_error' ? { txt: '⚠️ DB ULAŞILAMADI', cls: 'bg-rose-950 text-rose-300 border-rose-700' } :
    { txt: '🔓 PUBLIC MOD', cls: 'bg-slate-900 text-slate-400 border-slate-700' };

  const tabs = isGuest ? GUEST_TABS : USER_TABS;
  const visibleTab: TabId = tabs.some((t) => t.id === activeTab) ? activeTab : (isGuest ? 'market' : 'dashboard');
  const errorLines = Object.entries(writeErrors).map(([label, msg]) => `${label}: ${msg}`);
  const bannerMsg =
    errorLines.length > 0 ? errorLines.join(' • ')
    : dbState === 'db_error' ? `Veritabanı okunamadı: ${dbError ?? 'bilinmeyen hata'}`
    : null;

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0d14] text-slate-100">

      {/* 🔴 CANLI TICKER BAR */}
      <header className="border-b border-slate-800 bg-[#0d121f] px-4 py-2.5 flex items-center justify-between text-xs font-mono overflow-x-auto gap-6 sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-sky-400 shrink-0">
          <Activity className={`w-4 h-4 ${market.source === 'live' ? 'animate-pulse text-emerald-400' : 'text-amber-400'}`} />
          <span>YATIRIM TERMİNALİ v3.4</span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${
            market.source === 'live'
              ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
              : 'bg-amber-950 text-amber-400 border-amber-800'
          }`}>
            {market.source === 'live' ? 'CANLI' : `SON VERİ ${market.dataDate}`}
          </span>
          <span className={`px-1.5 py-0.5 rounded border text-[10px] ${dbChip.cls}`} title={dbState === 'db_error' ? dbError ?? '' : undefined}>
            {dbChip.txt}
          </span>
          {lastSavedAt && (
            <span className="px-1.5 py-0.5 rounded border text-[10px] bg-slate-900 text-slate-400 border-slate-700" title="Son başarılı veritabanı yazması">
              💾 Son kayıt: {lastSavedAt}
            </span>
          )}
        </div>

        <div className="flex items-center gap-6 whitespace-nowrap">
          <div className="flex items-center gap-1.5" title={market.indices.xu100.asOf ?? ''}>
            <span className="text-slate-400">BIST 100:</span>
            <span className="font-semibold text-slate-200">{fmtPub(market.indices.xu100.price, 2)}</span>
            {fmtChange(market.indices.xu100.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.usdtry.asOf ?? ''}>
            <span className="text-slate-400">USD/TRY:</span>
            <span className="font-semibold text-slate-200">{fmtPub(market.indices.usdtry.price, 4)} TL</span>
            {fmtChange(market.indices.usdtry.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.gramGold.asOf ?? ''}>
            <span className="text-slate-400">Gram Altın:</span>
            <span className="font-semibold text-amber-300">{fmtPub(market.indices.gramGold.price, 2)} TL</span>
            {fmtChange(market.indices.gramGold.changePct)}
          </div>

          <div className="flex items-center gap-1.5" title={market.indices.ounceSilver.asOf ?? ''}>
            <span className="text-slate-400">Ons Gümüş:</span>
            <span className="font-semibold text-slate-200">{fmtPub(market.indices.ounceSilver.price)} $</span>
            {fmtChange(market.indices.ounceSilver.changePct)}
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700" title={market.indices.goldSilverRatio.interpretation}>
            <span className="text-amber-400">Altın/Gümüş Rasyosu:</span>
            <span className="font-bold text-amber-200">{fmtPub(market.indices.goldSilverRatio.value, 1)}</span>
            <span className="text-amber-400 text-[10px]">
              ({market.indices.goldSilverRatio.status === 'GUMUS_PAHALI' ? 'Gümüş Pahalı' : market.indices.goldSilverRatio.status === 'GUMUS_UCUZ' ? 'Gümüş Ucuz' : 'Dengede'})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">TCMB Politika:</span>
            <span className="font-semibold text-sky-300">%{fmtPub(market.indices.interestRate.value)}</span>
            <span className="text-slate-400 text-[10px]">(TÜFE %{fmtPub(market.indices.interestRate.inflation)})</span>
          </div>

          <span className="text-[10px] text-slate-500" title="Fiyatların ait olduğu iş günü ve veri çekim zamanı">
            📅 {market.dataDate} • {new Date(market.timestamp).toLocaleTimeString('tr-TR')}
          </span>

          <PrivacyToggle masked={masked} onToggle={toggleMask} />
        </div>
      </header>

      {/* 🧭 NAVİGASYON — misafir yalnızca Piyasa + Giriş görür (P1) */}
      <nav className="bg-[#101726] border-b border-slate-800 px-4 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 text-xs font-medium border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${
              visibleTab === tab.id
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

        {/* P0 — yazma/okuma hatası banner'ı */}
        <ErrorBanner message={bannerMsg} onDismiss={() => { setWriteErrors({}); setDbError(null); }} />

        {/* 🔓 MİSAFİR GÖRÜNÜMÜ (P1) */}
        {isGuest && visibleTab === 'market' && <GuestMarketView onLoginClick={() => setActiveTab('login')} />}

        {isGuest && visibleTab === 'login' && (
          <div className="max-w-xl mx-auto space-y-4">
            <div className="bg-[#111726] border border-sky-800 rounded-lg p-5 font-mono">
              <h2 className="text-sm font-bold text-sky-300">PORTFÖYÜNÜZÜ GÖRMEK İÇİN GİRİŞ YAPIN</h2>
              <p className="text-[11px] text-slate-400 mt-1">
                Pozisyonlar, kasa, kararlar, işlemler, tahminler ve fon içeriği yalnızca oturum açmış
                kullanıcıya gösterilir (Supabase RLS). Misafir görünümü salt okunurdur.
              </p>
            </div>
            {configured ? (
              <LoginPanel
                userEmail={null}
                onSignedIn={() => setActiveTab('dashboard')}
                onSignedOut={handleSignedOut}
              />
            ) : (
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-5 font-mono text-xs text-slate-400">
                Bu ortamda giriş bağlantısı etkin değil. Piyasa verileri herkese açıktır.
              </div>
            )}
          </div>
        )}

        {/* 1. 📊 ANA PANEL */}
        {!isGuest && visibleTab === 'dashboard' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>TOPLAM PORTFÖY DEĞERİ</span>
                  <PieChart className="w-4 h-4 text-sky-400" />
                </div>
                <div className="text-2xl font-bold text-slate-100 mt-2 font-mono">{fmtTl(totalPortfolioValue)}</div>
                <div className={`text-xs mt-1 font-mono flex items-center gap-1 ${totalNetYieldAgainstCapital >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  <TrendingUp className="w-3.5 h-3.5" /> Ana Paraya Göre Net: {masked ? MASK : `${totalNetYieldAgainstCapital >= 0 ? '+' : ''}${fmtPctSensitive(totalNetYieldAgainstCapital)}`}
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>SERBEST KASA NAKDİ</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-emerald-300 mt-2 font-mono">{fmtTl(cashBalance)}</div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  Portföyün {masked ? MASK : `%${((cashBalance / (totalPortfolioValue || 1)) * 100).toFixed(1)}`}&apos;i Likit
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>VARLIK KÂR / ZARAR</span>
                  <TrendingUp className="w-4 h-4 text-amber-400" />
                </div>
                <div className={`text-2xl font-bold mt-2 font-mono ${totalUnrealizedPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {fmtTlSigned(totalUnrealizedPnL)}
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  Maliyet Üzeri: {masked ? MASK : fmtPctSensitive(totalPnLPct)}
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

            {/* 📈 Grafikler — maske açıkken TL değerleri gizlenir */}
            {masked ? (
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs text-slate-400 text-center">
                🔒 Gizlilik maskesi açık — grafiklerdeki TL değerleri gizlendi.
                Görmek için header&apos;daki <span className="text-violet-300 font-bold">GİZLİ</span> butonuna basın.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                  <h3 className="text-xs font-mono font-bold text-slate-300 mb-2">VARLIK DAĞILIMI (DEĞERE GÖRE)</h3>
                  <div className="flex items-center">
                    <ResponsiveContainer width="55%" height={210}>
                      <RPieChart>
                        <Pie data={allocData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={2} stroke="none">
                          {allocData.map((d) => <Cell key={d.name} fill={d.color} />)}
                        </Pie>
                        <RTooltip formatter={(v: any) => fmtTl(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} />
                      </RPieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5 text-[11px] font-mono">
                      {allocData.map((d) => (
                        <div key={d.name} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-slate-300">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: d.color }} />{d.name}
                          </span>
                          <span className="text-slate-400">%{((d.value / (totalPortfolioValue || 1)) * 100).toFixed(1)}</span>
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
                      <RTooltip formatter={(v: any) => fmtTl(Number(v))} contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: 'rgba(51,65,85,0.2)' }} />
                      <Bar dataKey="pnl" name="K/Z" radius={[3, 3, 0, 0]}>
                        {pnlData.map((d) => <Cell key={d.name} fill={d.pnl >= 0 ? '#34d399' : '#f87171'} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

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
                  <span className="font-bold text-slate-300">📌 Stratejik Not — Yoğunlaşma:</span> Tek bir varlığın fon/portföy ağırlığı izlenir; aşırı yoğunlaşmada kademeli çıkış uygulanır.
                </div>
                <div className="p-2 rounded">
                  <span className="font-bold text-slate-300">📌 Stratejik Not — Zarar Hisseleri:</span> Zarar eden şirketlerde F/K anlamsızdır; PD/DD ve merdivenli satış kademeleri esas alınır.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 2. 🔍 ANALİZ MERKEZİ */}
        {!isGuest && visibleTab === 'analysis' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-sky-400 font-mono">STRATEJİK ANALİZ MERKEZİ (5 BÖLÜMLÜ DEDEKTİF RAPORU)</h2>
                <p className="text-xs text-slate-400 mt-1">Canlı piyasa verileri, bilanço rasyoları ve @sevketozhan benchmark entegrasyonu</p>
              </div>
                  <button
                    onClick={() => {
                      if (!accessToken) return;
                      fetch('/api/market', { headers: { Authorization: `Bearer ${accessToken}` } })
                        .then((r) => r.json())
                        .then((d) => { if (d && d.indices) setMarket(d); });
                    }}
                    className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold px-4 py-2 rounded flex items-center gap-2"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> CANLI ANALİZİ GÜNCELLE
                  </button>
            </div>

            <div className="space-y-4 font-mono text-xs leading-relaxed">
              <div className="bg-slate-900/90 border-l-4 border-rose-500 p-4 rounded-r">
                <h3 className="text-rose-400 font-bold text-sm mb-1">BÖLÜM 1: NET KARAR (SERT VE TAVİZSİZ)</h3>
                <p className="text-slate-300">
                  Kararlar sekmesindeki onaylı kararlar stop/hedef seviyeleriyle birlikte uygulanır.
                  Altın/Gümüş oranı {fmtPub(market.indices.goldSilverRatio.value, 1)} seviyesinde;
                  rasyo gümüş aleyhine pahalı bölgedeyken ilave gümüş alımı yapılmaz.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-sky-500 p-4 rounded-r">
                <h3 className="text-sky-400 font-bold text-sm mb-1">BÖLÜM 2: TEMEL ANALİZ (BİLANÇO DEDEKTİFİ)</h3>
                <p className="text-slate-300">
                  Zarar eden şirketlerde F/K negatiftir ve yanıltıcıdır; PD/DD esas alınır.
                  USD fonksiyonel paralı şirketlerde kur etkisi ayrıca değerlendirilir.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-amber-500 p-4 rounded-r">
                <h3 className="text-amber-400 font-bold text-sm mb-1">BÖLÜM 3: SOSYAL MEDYA FİLTRESİ & TAHMİN ENTEGRASYONU</h3>
                <p className="text-slate-300">
                  @sevketozhan Güven Skoru: <strong>%{fmtPub(trustScore, 1)}</strong> ({trustScore >= 80 ? 'Yüksek Güvenilirlik' : trustScore >= 60 ? 'Orta Güvenilirlik' : 'Düşük Güvenilirlik'}).
                  Formül: (Kendi Analiz × 0.6) + (@sevketozhan × 0.4). Doğrulama: Sosyal Doğrulama sekmesinden gerçekleşen getiriyi girin.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-emerald-500 p-4 rounded-r">
                <h3 className="text-emerald-400 font-bold text-sm mb-1">BÖLÜM 4: FON VE EMTİA STRATEJİSİ</h3>
                <p className="text-slate-300">
                  Serbest fonlarda %17,5 stopaj çıkışta kârdan kesilir (İşlem Günlüğü&apos;ndeki satışlarda otomatik hesaplanır).
                  Para piyasası fonu, %{fmtPub(market.indices.interestRate.value, 0)} politika faizi ortamında risksiz reel getiri tamponu olarak tutulur.
                  Fon içeriği sekmesi, fonun hisse dağılımından günlük tahmin üretir.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-indigo-500 p-4 rounded-r">
                <h3 className="text-indigo-400 font-bold text-sm mb-1">BÖLÜM 5: AKADEMİ NOTU</h3>
                <p className="text-slate-300">
                  <strong>Yoğunlaşma Riski:</strong> Çeşitlendirme getiriyi maksimize etmek için değil; tek bir hissenin/tahminin çökmesi durumunda anaparayı korumak için yapılır.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 3. 💼 PORTFÖY TABLOSU */}
        {!isGuest && visibleTab === 'portfolio' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-mono text-sm font-bold text-slate-200">AKTİF POZİSYONLAR VE VARLIK TABLOSU</h2>
              <span className="text-xs font-mono text-slate-400">
                {livePositions.filter((p) => p.quantity > 0).length} Varlık | Toplam Değer: {fmtTl(totalPortfolioValue)}
              </span>
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
                    <th className="p-3 text-right" title="Fon içeriğinden hesaplanan günlük tahmin / kaplama">GÜNLÜK TAHMİN</th>
                    <th className="p-3 text-center">STOP</th>
                    <th className="p-3 text-center">KARAR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  <tr className="bg-sky-950/40">
                    <td colSpan={12} className="px-3 py-2 text-[10px] font-bold text-sky-300 tracking-wider">
                      📈 BİST HİSSELERİ ({stockRows.length}) — Toplam: {fmtTl(stockTotal)} · K/Z: {fmtTlSigned(stockPnl)}
                    </td>
                  </tr>
                  {stockRows.map(renderPosRow)}
                  <tr className="bg-emerald-950/30">
                    <td colSpan={12} className="px-3 py-2 text-[10px] font-bold text-emerald-300 tracking-wider">
                      🏦 TEFAS FONLARI ({fundRows.length}) — Toplam: {fmtTl(fundTotal)} · K/Z: {fmtTlSigned(fundPnl)}
                    </td>
                  </tr>
                  {fundRows.map(renderPosRow)}
                </tbody>
              </table>
            </div>
            <p className="p-3 text-[10px] font-mono text-slate-500 border-t border-slate-800">
              GÜNLÜK TAHMİN sütunu: fon içeriği (fund_holdings) × canlı hisse değişimi. Yanındaki % = kaplama
              (hesaplanan hisselerin fon ağırlığı). Fon içeriği kaydı olmayan fonlarda &quot;—&quot; gösterilir; değer uydurulmaz.
            </p>
          </div>
        )}

        {/* 4. 🧬 FON İÇERİĞİ (P3 + Twitter beslemeli + OCR onay kutusu + THF otomatik) */}
        {!isGuest && visibleTab === 'funds' && (
          <FundContentTab
            rows={fundHoldings}
            prices={holdingPrices}
            predictions={predictions}
            proposals={proposals}
            portfolioFundCodes={Array.from(new Set(positions.filter((p) => p.asset_type === 'TEFAS_FON' || p.asset_type === 'PPF' || ['TLY','DFI','THF','GUM','YZG','MJG','DMG','GMC','AK2'].includes(p.symbol.toUpperCase())).map((p) => p.symbol.toUpperCase())))}
            masked={masked}
            canWrite={dbState === 'connected'}
            onUpsert={handleUpsertHolding}
            onDelete={handleDeleteHolding}
            onApproveProposal={handleApproveProposal}
            onRejectProposal={handleRejectProposal}
          />
        )}

        {/* 5. 📋 KARARLAR (EXECUTION HUB) */}
        {!isGuest && visibleTab === 'decisions' && (
          <div className="space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-200">STRATEJİK KARARLAR & EXECUTION MERKEZİ</h2>
              <span className="text-slate-400">{decisions.filter((d) => d.status === 'onaylandi').length} Onaylı Karar Bekliyor</span>
            </div>
            <p className="text-[11px] text-slate-500">
              🚀 UYGULA: Kararı &quot;uygulandı&quot;ya geçirir, stop/hedef seviyelerini ilgili pozisyona işler ve kasa defterine kayıt atar
              {dbState === 'connected' ? ' (Supabase veritabanına kalıcı yazılır)' : ''}.
            </p>

            {decisions.length === 0 && (
              <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 text-slate-500 text-center">
                Kayıtlı karar yok.
              </div>
            )}

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

                  <p className="text-slate-300 leading-relaxed">{maskText(dec.details, masked)}</p>

                  <div className="flex items-center justify-between pt-2">
                    <div className="text-slate-400 text-[11px]">
                      Risk: <span className="text-rose-400 font-bold">{dec.risk_score}/10</span>
                      {dec.stop_price != null && <span className="ml-2">Stop: <span className="text-rose-400 font-bold">{fmtTl(dec.stop_price)}</span></span>}
                      {dec.target_price != null && <span className="ml-2">Hedef: <span className="text-emerald-400 font-bold">{fmtTl(dec.target_price)}</span></span>}
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

        {/* 6. 📜 İŞLEM GÜNLÜĞÜ (MASTER LEDGER) */}
        {!isGuest && visibleTab === 'ledger' && (
          <div className="space-y-6">
            <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">MASTER LEDGER & SERMAYE PERFORMANSI</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">BAŞLANGIÇ ANA PARA:</span>
                  <div className="text-base font-bold text-slate-200 mt-1">{fmtTl(initialCapital)}</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">GÜNCEL TOPLAM PORTFÖY:</span>
                  <div className="text-base font-bold text-emerald-400 mt-1">{fmtTl(totalPortfolioValue)}</div>
                </div>
                <div className="bg-slate-900 p-3 rounded border border-slate-800">
                  <span className="text-slate-400 text-[10px]">TOPLAM NET GETİRİ (TL & %):</span>
                  <div className={`text-base font-bold mt-1 ${totalPortfolioValue - initialCapital >= 0 ? 'text-sky-400' : 'text-rose-400'}`}>
                    {fmtTlSigned(totalPortfolioValue - initialCapital)} ({masked ? MASK : fmtPctSensitive(totalNetYieldAgainstCapital)})
                  </div>
                </div>
              </div>
            </div>

            {/* ➕ İşlem Ekleme */}
            <div className="bg-[#111726] border border-slate-800 rounded-lg p-5 font-mono text-xs space-y-3">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2"><PlusCircle className="w-4 h-4 text-sky-400" /> İŞLEM EKLE (ALIŞ / SATIŞ / TEMETTU)</h3>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                <input list="tx-symbols" value={txSymbol} onChange={(e) => setTxSymbol(e.target.value)} placeholder="KOD" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500 uppercase" />
                <datalist id="tx-symbols">
                  {livePositions.filter((p) => p.quantity > 0).map((p) => <option key={p.symbol} value={p.symbol}>{p.asset_name}</option>)}
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
                SATIŞ&apos;ta TEFAS fonları için %17,5 stopaj otomatik hesaplanır; gerçekleşen K/Z ve kasa hareketi deftere işlenir.
                YENİ kod yazarsanız ALIŞ ile otomatik pozisyon açılır. Kayıt veritabanına yazılır; başarısız olursa üstte kırmızı uyarı çıkar.
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
                          <td className="p-3 text-right text-slate-200">{fmtQty(t.quantity)}</td>
                          <td className="p-3 text-right text-slate-300">{formatSensitive(t.unit_price, masked, { digits: 4 })}</td>
                          <td className="p-3 text-right text-slate-200">{formatSensitive(t.total_amount, masked, { digits: 2 })}</td>
                          <td className={`p-3 text-right ${t.withholding_tax > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                            {t.withholding_tax > 0 ? formatSensitive(t.withholding_tax, masked, { digits: 2 }) : '—'}
                          </td>
                          <td className="p-3 text-right text-slate-200">{formatSensitive(t.net_amount, masked, { digits: 2 })}</td>
                          <td className={`p-3 text-right font-bold ${t.realized_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t.realized_pnl !== 0 ? formatSensitive(t.realized_pnl, masked, { digits: 2, signed: true }) : '—'}
                          </td>
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
                        <span className="text-slate-300 text-[11px]">{maskText(m.description, masked)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${m.amount > 0 ? 'text-emerald-400' : m.amount < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                          {formatSensitive(m.amount, masked, { digits: 2, signed: true })}
                        </span>
                        <span className="text-slate-400 text-[10px]">= {formatSensitive(m.balance_after, masked, { digits: 0 })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 7. 🏦 KASA */}
        {!isGuest && visibleTab === 'cash' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">KASA & NAKİT REZERV YÖNETİMİ</h2>
            <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-800 p-4 rounded-lg">
              <div>
                <span className="text-slate-400">MEVCUT KULLANILABİLİR SERBEST NAKİT:</span>
                <div className="text-3xl font-bold text-emerald-400 mt-1 font-mono">{fmtTl(cashBalance)}</div>
              </div>
              <div className="text-right text-slate-400">
                <div>Politika Faizi: <span className="text-sky-300 font-bold">%{fmtPub(market.indices.interestRate.value)}</span></div>
                <div>Aylık PPF Getiri Potansiyeli: <span className="text-emerald-400 font-bold">~{fmtTl(cashBalance * (market.indices.interestRate.value / 100) / 12)}</span></div>
              </div>
            </div>
            <div className="bg-slate-900/70 border border-slate-800 rounded-lg p-4">
              <span className="text-slate-400 text-[11px]">Kasa hareketleri (işlem günlüğü ile senkron):</span>
              <div className="mt-2 space-y-1.5 max-h-56 overflow-y-auto">
                {cashMovements.length === 0 ? (
                  <div className="text-slate-500">Kayıt yok — bir işlem yaptığınızda burada görünür.</div>
                ) : cashMovements.slice(0, 15).map((m) => (
                  <div key={m.id} className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400 truncate pr-3">{maskText(m.description, masked)}</span>
                    <span className={`font-bold ${m.amount > 0 ? 'text-emerald-400' : m.amount < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
                      {formatSensitive(m.amount, masked, { digits: 2, signed: true })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 8. 📱 SOSYAL DOĞRULAMA MOTORU */}
        {!isGuest && visibleTab === 'social' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-sky-400">SOSYAL MEDYA TAHMİN AYRIŞTIRICI & DOĞRULAMA MOTORU</h2>
                <p className="text-[11px] text-slate-400 mt-0.5">Benchmark: @sevketozhan | 7 Adımlı Güven Skoru Algoritması | Ayrıştırma: server-side /api/social-parse</p>
              </div>
              <div className="bg-sky-950 border border-sky-800 px-3 py-1.5 rounded text-sky-300">
                Güven Skoru: <span className={`font-bold text-base ${trustScore >= 80 ? 'text-emerald-400' : trustScore >= 60 ? 'text-amber-400' : 'text-rose-400'}`}>%{fmtPub(trustScore, 1)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-slate-300 font-bold">Yeni Tahmin Metni / Tweet Yapıştır:</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tweetInput}
                  onChange={(e) => setTweetInput(e.target.value)}
                  placeholder="Örn: @sevketozhan: Fon bugün %0,45 civarı getiri yazabilir..."
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

            <div className="space-y-2">
              <h3 className="font-bold text-slate-300">KAYITLI TAHMİNLER VE İSABET SKORLARI:</h3>
              {predictions.length === 0 && <div className="text-slate-500">Kayıtlı tahmin yok.</div>}
              <div className="space-y-2">
                {predictions.map((pred) => (
                  <div key={pred.id} className="bg-slate-900 border border-slate-800 p-3 rounded">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sky-400">{pred.predictor_handle}</span>
                        <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-amber-300 font-bold">{pred.fund_code}</span>
                        <span className="text-slate-400 text-[10px] bg-slate-800/60 px-1.5 py-0.5 rounded">{pred.prediction_category}</span>
                        <span className="text-slate-400 text-[10px]">{pred.prediction_date}</span>
                        <span className="text-slate-300">
                          Tahmin: {pred.predicted_return_pct != null ? `%${formatPublic(pred.predicted_return_pct)}` : '— (VERİ EKSİK)'}
                        </span>
                        {pred.actual_return_pct != null && (
                          <span className="text-emerald-400 font-bold">Gerçekleşen: %{formatPublic(pred.actual_return_pct)}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        {pred.accuracy_score != null ? (
                          <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-1 rounded text-[10px] font-bold">
                            İsabet: {pred.accuracy_score} Puan
                          </span>
                        ) : (
                          <>
                            <span className={`px-2 py-1 rounded text-[10px] font-bold border ${
                              pred.status === 'VERI_EKSİK'
                                ? 'bg-slate-800 text-slate-400 border-slate-600'
                                : 'bg-amber-950 text-amber-300 border-amber-800'
                            }`}>{pred.status}</span>
                            {pred.predicted_return_pct != null && (verifyId === pred.id ? (
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
                            ))}
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-slate-400 mt-1.5 text-[11px]">&quot;{pred.raw_text}&quot;</p>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">
                Doğrulama formülü: fark &lt;0,05 → 100 puan, &lt;0,10 → 80, &lt;0,20 → 60, &lt;0,50 → 30, sonrası 0.
                Güven skoru = 0,7 × eski + 0,3 × isabet.
              </p>
            </div>
          </div>
        )}

        {/* 9. ⚙️ AYARLAR & VERİTABANI */}
        {!isGuest && visibleTab === 'settings' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-6">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">SİSTEM DURUMU, VERİ KAYNAKLARI & SUPABASE BAĞLANTISI</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Piyasa Verisi (BNG + Yahoo):</span>
                  <span className={`font-bold flex items-center gap-1 ${market.source === 'live' ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {market.source === 'live' ? '🟢 CANLI BAĞLANTI' : '🟡 SON VERİ'}
                  </span>
                </div>
                <p className="text-slate-500 text-[10px]">
                  BIST 100 &amp; gram altın: borsaningundemi.com piyasa ekranı. USD/TRY, ons altın/gümüş ve
                  BIST hisseleri: Yahoo Finance. 60 sn&apos;de bir çekilir; 42 saatten eski feed&apos;ler reddedilir.
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
                  Fon birim pay fiyatları sunucu tarafında çekilir. TEFAS NAV&apos;lar T+1 yayınlandığından
                  fon fiyatları önceki iş gününe ait olabilir.
                </p>
              </div>

              <div className={`bg-slate-900 p-4 rounded border space-y-2 ${
                dbState === 'connected' ? 'border-sky-800' : dbState === 'db_error' ? 'border-rose-800' : 'border-slate-800'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Supabase DB:</span>
                  <span className={`font-bold flex items-center gap-1 ${
                    dbState === 'connected' ? 'text-sky-400' : dbState === 'db_error' ? 'text-rose-400' : 'text-slate-500'
                  }`}>
                    {dbState === 'connected' ? '🟢 KALICI (AUTH)' :
                     dbState === 'db_error' ? '🔴 ULAŞILAMADI' :
                     dbState === 'auth_required' ? '🔒 OTURUM GEREKLİ' : '⏳ BAĞLANIYOR'}
                  </span>
                </div>
                <p className="text-slate-500 text-[10px]">
                  {dbState === 'connected'
                    ? `Oturum: ${userEmail}. Portföy, kasa, kararlar, işlemler, tahminler ve fon içeriği veritabanında kalıcı; RLS yalnızca sizin hesabınıza izin verir.${lastSavedAt ? ` Son kayıt: ${lastSavedAt}.` : ''}`
                    : dbState === 'db_error'
                    ? `Veritabanına ulaşılamadı: ${dbError ?? 'bilinmeyen hata'}. Şema ve migration&apos;ların çalıştırıldığından emin olun (supabase_schema.sql + fund_holdings + twitter).`
                    : dbState === 'auth_required'
                    ? 'Supabase yapılandırıldı ama oturum yok. Giriş yapın veya hesap oluşturun.'
                    : 'Yükleniyor…'}
                </p>
              </div>
            </div>

            <LoginPanel userEmail={userEmail} onSignedIn={() => { /* onAuthStateChange tetikler */ }} onSignedOut={handleSignedOut} />

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-300">VERİTABANI YEDEKLEME (JSON EXPORT):</h3>
                <p className="text-slate-500 text-[10px] mt-0.5">Tüm portföy, işlem günlüğü, kararlar, fon içeriği ve tahminleri tek dosya olarak indir.</p>
              </div>
              <button
                onClick={() => {
                  const data = JSON.stringify({
                    exportedAt: new Date().toISOString(), initialCapital, cashBalance, positions, decisions,
                    transactions, cashMovements, predictions, fundHoldings, trustScore,
                  }, null, 2);
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
        Yatırım Terminali v3.4 — *Bu sistemdeki analizler ve algoritmik modeller kişisel karar destek amaçlıdır, resmi yatırım tavsiyesi niteliğinde değildir.*
      </footer>
    </div>
  );
}
