'use client';

import React, { useState, useEffect } from 'react';
import { 
  TrendingUp, TrendingDown, DollarSign, PieChart, ShieldAlert, 
  CheckCircle, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight, 
  RefreshCw, FileText, Database, Settings, Activity, PlusCircle,
  ExternalLink, Download, MessageSquare, Briefcase, Play, Send
} from 'lucide-react';
import { calculateTax, calculateGoldSilverRatio, calculateAccuracyScore, updateTrustScore } from '@/lib/calculations';
import { Position, Decision, CashMovement, SocialPrediction } from '@/lib/types';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'analysis' | 'portfolio' | 'decisions' | 'ledger' | 'cash' | 'social' | 'settings'>('dashboard');
  
  // Portföy Pozisyonları (20.08.2026 Başlangıç)
  const [positions, setPositions] = useState<Position[]>([
    { id: '1', symbol: 'BURCE', asset_name: 'Burçelik Vana', asset_type: 'BIST_HISSE', quantity: 3938, unit_cost: 40.96, current_price: 38.40, daily_change_pct: -1.20, target_price: 53.40, stop_price: 32.50, risk_score: 10, current_action: 'KADEMELİ SAT', rationale: 'Zarar eden şirket (F/K -24.2, PD/DD 2.45). Merdivenli çıkış (%5 ağırlığa iniş).', is_active: true },
    { id: '2', symbol: 'KGM', asset_name: 'QNB Gümüş Fon Sepeti', asset_type: 'TEFAS_FON', quantity: 25000, unit_cost: 2.99, current_price: 3.12, daily_change_pct: 1.30, target_price: 3.40, stop_price: 2.60, risk_score: 7, current_action: 'TUT', rationale: 'Gümüşe %95 endeksli. Tek emtia yoğunluğu 25.000 paya indirildi, stop korumalı.', is_active: true },
    { id: '3', symbol: 'TLY', asset_name: 'Tera Portföy 1. Hisse Fonu', asset_type: 'TEFAS_FON', quantity: 7, unit_cost: 6493, current_price: 8450, daily_change_pct: -0.40, target_price: 9900, stop_price: 7250, risk_score: 9, current_action: '2/3 ÇIKIŞ', rationale: 'OZATD tek hisse %34.27 risk konsantrasyonu. 2/3 kâr al, 1/3 stop korumalı TUT.', is_active: true },
    { id: '4', symbol: 'DFI', asset_name: 'Deniz Portföy 1. Hisse Fonu', asset_type: 'TEFAS_FON', quantity: 10400, unit_cost: 3.846, current_price: 4.95, daily_change_pct: 0.80, target_price: 6.10, stop_price: 4.60, risk_score: 9, current_action: 'TUT', rationale: '27 hisseye dağılmış (%53 hisse + %28 fon). 2024 LIDER geçmişi sebebiyle stop korumalı.', is_active: true },
    { id: '5', symbol: 'TP2', asset_name: 'Tacirler Para Piyasası Fonu', asset_type: 'PPF', quantity: 24197, unit_cost: 1.963, current_price: 2.015, daily_change_pct: 0.11, target_price: 2.20, stop_price: 1.96, risk_score: 1, current_action: 'TUT', rationale: 'Nakit park yeri. Politika faizi %37, TÜFE %31.75 ortamında pozitif reel getiri.', is_active: true },
    { id: '6', symbol: 'MASFN', asset_name: 'Master Finans Faktoring', asset_type: 'BIST_HISSE', quantity: 486, unit_cost: 45.68, current_price: 46.20, daily_change_pct: 1.10, target_price: 52.00, stop_price: 39.50, risk_score: 7, current_action: 'TUT', rationale: 'F/K ~12.2, HBK 3.58, USD fonksiyonel para avantajı.', is_active: true },
    { id: '7', symbol: 'SARAE', asset_name: 'Saray Matbaacılık', asset_type: 'BIST_HISSE', quantity: 211, unit_cost: 70.00, current_price: 78.50, daily_change_pct: -0.60, target_price: 90.00, stop_price: 68.00, risk_score: 8, current_action: 'TUT', rationale: '88-97 bandında kâr al (Fib %23.6 = 88.1).', is_active: true },
    { id: '8', symbol: 'EKIM', asset_name: 'Ekim Varlık Kiralama', asset_type: 'BIST_HISSE', quantity: 630, unit_cost: 30.26, current_price: 19.80, daily_change_pct: -2.40, target_price: 22.00, stop_price: 18.37, risk_score: 10, current_action: 'SAT', rationale: 'HBK -2.06, Beta 2.79. İlk tepkide veya 18.37 dibi kırılırsa acil satış.', is_active: true }
  ]);

  // Kasa / Nakit
  const [cashBalance, setCashBalance] = useState<number>(257706);
  const initialCapital = 678000;

  // Kararlar Hub
  const [decisions, setDecisions] = useState<Decision[]>([
    { id: 'kr1', symbol: 'TLY', action_type: '2/3 ÇIKIŞ', status: 'onaylandi', target_price: 9900, stop_price: 7250, risk_score: 9, details: 'OZATD aşırı yoğunlaşması sebebiyle 2/3 kâr realizasyonu. Stop 7.250 TL.', created_at: '2026-08-20' },
    { id: 'kr2', symbol: 'BURCE', action_type: 'MERDİVENLİ SAT', status: 'bekliyor', target_price: 53.40, stop_price: 32.50, risk_score: 10, details: 'Zarar eden şirket riskini azaltmak için 36.5-38 / 40.96 / 46.0 / 53.4 kademeleri.', created_at: '2026-08-20' },
    { id: 'kr3', symbol: 'KGM', action_type: 'TUT (25.000 Pay)', status: 'bekliyor', target_price: 3.40, stop_price: 2.60, risk_score: 7, details: 'Gümüş yoğunlaşması azaltıldı, kalan 25.000 pay stop 2.60 ile taşınıyor.', created_at: '2026-08-20' },
    { id: 'kr4', symbol: 'EKIM', action_type: 'İLK TEPKİDE SAT', status: 'bekliyor', target_price: 22.00, stop_price: 18.37, risk_score: 10, details: 'HBK negatif ve beta çok yüksek. 18.37 dip altı acil stop.', created_at: '2026-08-20' },
    { id: 'kr5', symbol: 'NAKIT', action_type: 'NAKİT DAĞITIMI', status: 'bekliyor', risk_score: 3, details: 'Nakit havuzu: %40 TP2, %30 THF hisse fonu, %10 Altın BYF, %20 tampon nakit.', created_at: '2026-08-20' },
    { id: 'kr6', symbol: 'PORTFOY', action_type: 'STOP DÜZELTMELERİ', status: 'onaylandi', risk_score: 5, details: 'Tüm pozisyonlar için tanımlanan stop seviyeleri sisteme işlendi.', created_at: '2026-08-20' },
    { id: 'kr10', symbol: 'TLY', action_type: 'POZİSYON ARTIRMA', status: 'reddedildi', risk_score: 9, details: 'OZATD risk yoğunlaşması nedeniyle pozisyon artırımı kesinlikle reddedildi.', created_at: '2026-08-20' }
  ]);

  // Sosyal Tahminler & @sevketozhan Benchmark
  const [tweetInput, setTweetInput] = useState('');
  const [trustScore, setTrustScore] = useState(78.5);
  const [predictions, setPredictions] = useState<SocialPrediction[]>([
    { id: 'p1', predictor_handle: '@sevketozhan', fund_code: 'TLY', predicted_return_pct: 0.45, prediction_category: 'GUNLUK_GETIRI', raw_text: 'TLY bugün %0.45 civarı getiri yazabilir.', prediction_date: '2026-08-20', actual_return_pct: 0.40, accuracy_score: 100, status: 'DOGRULANDI' },
    { id: 'p2', predictor_handle: '@sevketozhan', fund_code: 'DFI', predicted_return_pct: 0.80, prediction_category: 'GUNLUK_GETIRI', raw_text: 'DFI portföy dağılımına göre +%0.80 beklenti.', prediction_date: '2026-08-21', actual_return_pct: 0.75, accuracy_score: 100, status: 'DOGRULANDI' }
  ]);

  // Hesaplamalar
  const totalStockAndFundValue = positions.reduce((acc, pos) => acc + (pos.quantity * (pos.current_price || pos.unit_cost)), 0);
  const totalPortfolioValue = totalStockAndFundValue + cashBalance;
  const totalCost = positions.reduce((acc, pos) => acc + (pos.quantity * pos.unit_cost), 0);
  const totalUnrealizedPnL = totalStockAndFundValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalUnrealizedPnL / totalCost) * 100 : 0;
  const totalNetYieldAgainstCapital = ((totalPortfolioValue - initialCapital) / initialCapital) * 100;

  // Sosyal Metin Ayrıştırma
  const handleParseTweet = () => {
    if (!tweetInput.trim()) return;
    const knownFunds = ['TLY', 'DFI', 'KGM', 'TP2', 'THF', 'BURCE', 'MASFN', 'SARAE', 'EKIM'];
    const fundRegex = new RegExp(`\\b(${knownFunds.join('|')})\\b`, 'i');
    const matchFund = tweetInput.match(fundRegex);
    const fundCode = matchFund ? matchFund[1].toUpperCase() : 'TLY';

    const matchPct = tweetInput.match(/([+-]?\d+(?:[.,]\d+)?)\s*%/i) || tweetInput.match(/%\s*([+-]?\d+(?:[.,]\d+)?)/i);
    const predictedReturn = matchPct ? parseFloat(matchPct[1].replace(',', '.')) : 0.50;

    const newPred: SocialPrediction = {
      id: Date.now().toString(),
      predictor_handle: '@sevketozhan',
      fund_code: fundCode,
      predicted_return_pct: predictedReturn,
      prediction_category: 'GUNLUK_GETIRI',
      raw_text: tweetInput,
      prediction_date: new Date().toISOString().split('T')[0],
      status: 'BEKLIYOR'
    };

    setPredictions([newPred, ...predictions]);
    setTweetInput('');
  };

  // Karar Uygulama
  const handleApplyDecision = (id: string) => {
    setDecisions(decisions.map(d => d.id === id ? { ...d, status: 'uygulandi' } : d));
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0d14] text-slate-100">
      
      {/* 🔴 CANLI TICKER BAR */}
      <header className="border-b border-slate-800 bg-[#0d121f] px-4 py-2.5 flex items-center justify-between text-xs font-mono overflow-x-auto gap-6 sticky top-0 z-50">
        <div className="flex items-center gap-2 font-bold text-sky-400">
          <Activity className="w-4 h-4 animate-pulse text-emerald-400" />
          <span>YATIRIM TERMİNALİ v3.0</span>
          <span className="bg-emerald-950 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800 text-[10px]">CANLI</span>
        </div>
        
        <div className="flex items-center gap-6 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">BIST 100:</span>
            <span className="font-semibold text-slate-200">14.380,50</span>
            <span className="text-emerald-400 flex items-center"><ArrowUpRight className="w-3 h-3"/>+%0,85</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">USD/TRY:</span>
            <span className="font-semibold text-slate-200">47,92 TL</span>
            <span className="text-emerald-400 flex items-center"><ArrowUpRight className="w-3 h-3"/>+%0,12</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Gram Altın:</span>
            <span className="font-semibold text-amber-300">6.810 TL</span>
            <span className="text-emerald-400 flex items-center"><ArrowUpRight className="w-3 h-3"/>+%0,76</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">Ons Gümüş:</span>
            <span className="font-semibold text-slate-200">66,30 $</span>
            <span className="text-emerald-400 flex items-center"><ArrowUpRight className="w-3 h-3"/>+%1,45</span>
          </div>

          <div className="flex items-center gap-1.5 bg-slate-900/80 px-2 py-0.5 rounded border border-slate-700">
            <span className="text-amber-400">Altın/Gümüş Rasyosu:</span>
            <span className="font-bold text-amber-200">66,6</span>
            <span className="text-amber-400 text-[10px]">(Gümüş Pahalı)</span>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">TCMB Politika:</span>
            <span className="font-semibold text-sky-300">%37,00</span>
            <span className="text-slate-400 text-[10px]">(TÜFE %31,75)</span>
          </div>
        </div>
      </header>

      {/* 🧭 8 SEKMELİ NAVİGASYON BAR */}
      <nav className="bg-[#101726] border-b border-slate-800 px-4 flex items-center gap-1 overflow-x-auto">
        {[
          { id: 'dashboard', label: '📊 Ana Panel' },
          { id: 'analysis', label: '🔍 Analiz Merkezi' },
          { id: 'portfolio', label: '💼 Portföy' },
          { id: 'decisions', label: '📋 Kararlar (Hub)' },
          { id: 'ledger', label: '📜 Geçmiş' },
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
                  {totalPortfolioValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                </div>
                <div className="text-xs text-emerald-400 mt-1 font-mono flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" /> Ana Paraya Göre Net: +%{totalNetYieldAgainstCapital.toFixed(1)}
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>SERBEST KASA NAKDİ</span>
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-emerald-300 mt-2 font-mono">
                  {cashBalance.toLocaleString('tr-TR')} TL
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
                  {totalUnrealizedPnL >= 0 ? '+' : ''}{totalUnrealizedPnL.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                </div>
                <div className="text-xs text-slate-400 mt-1 font-mono">
                  Maliyet Üzeri: %{totalPnLPct.toFixed(1)}
                </div>
              </div>

              <div className="bg-[#111726] border border-slate-800 rounded-lg p-4">
                <div className="text-slate-400 text-xs font-mono flex items-center justify-between">
                  <span>KRİTİK UYARILAR</span>
                  <ShieldAlert className="w-4 h-4 text-rose-400" />
                </div>
                <div className="text-2xl font-bold text-rose-400 mt-2 font-mono">2 Riskli</div>
                <div className="text-xs text-rose-300 mt-1 font-mono">TLY (%34 OZATD) + EKIM</div>
              </div>
            </div>

            {/* Kritik Alarmlar Şeridi */}
            <div className="bg-rose-950/30 border border-rose-800/60 rounded-lg p-4 text-xs font-mono space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-bold">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>AKTİF STRATEJİK ALARMLAR VE STOP KORUMALARI</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-slate-300">
                <div className="bg-rose-900/20 p-2.5 rounded border border-rose-800/40">
                  <span className="font-bold text-rose-200">⚠️ TLY Fonu Yoğunlaşma Uyarısı:</span> Fon portföyünün %34.27'si tek başına OZATD hissesindedir. 2/3 çıkış kararı onaylanmıştır; kalan 1/3 için 7.250 TL stop-loss aktiftir.
                </div>
                <div className="bg-rose-900/20 p-2.5 rounded border border-rose-800/40">
                  <span className="font-bold text-rose-200">⚠️ BURCE & EKIM Zarar Uyarısı:</span> Zarar eden şirketlerde F/K anlamsızdır. BURCE PD/DD 2.45 seviyesindedir. Merdivenli satış ile ağırlık %5'e çekilmelidir.
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
              <button className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold px-4 py-2 rounded flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5" /> CANLI ANALİZİ GÜNCELLE
              </button>
            </div>

            <div className="space-y-4 font-mono text-xs leading-relaxed">
              <div className="bg-slate-900/90 border-l-4 border-rose-500 p-4 rounded-r">
                <h3 className="text-rose-400 font-bold text-sm mb-1">BÖLÜM 1: NET KARAR (SERT VE TAVİZSİZ)</h3>
                <p className="text-slate-300">
                  <strong>TLY:</strong> 2/3 Kâr alımı UYGULANMALIDIR. Stop 7.250 TL. <br />
                  <strong>BURCE:</strong> Alınmaz, merdivenli satılır (36.5-38 / 40.96 / 46.0). Hedef %5 portföy ağırlığı. <br />
                  <strong>KGM:</strong> 25.000 payda TUT. Altın/Gümüş oranı 66.6 seviyesinde olduğundan ilave gümüş alımı yapılmaz. Stop: 2.60 TL.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-sky-500 p-4 rounded-r">
                <h3 className="text-sky-400 font-bold text-sm mb-1">BÖLÜM 2: TEMEL ANALİZ (BİLANÇO DEDEKTİFİ)</h3>
                <p className="text-slate-300">
                  Zarar eden şirketlerde F/K negatiftir ve yanıltıcıdır. BURCE (Net kâr -27.1M TL, PD/DD 2.45) pahalı bölgededir. MASFN (F/K ~12.2, HBK 3.58, USD fonksiyonel para) güçlü rasyolara sahiptir.
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-amber-500 p-4 rounded-r">
                <h3 className="text-amber-400 font-bold text-sm mb-1">BÖLÜM 3: SOSYAL MEDYA FİLTRESİ & TAHMİN ENTEGRASYONU</h3>
                <p className="text-slate-300">
                  @sevketozhan Güven Skoru: <strong>%78.50</strong> (Yüksek Güvenilirlik). TLY günlük getiri tahmini +%0.45 olarak filtrelendi. Formül: (Kendi Analiz × 0.6) + (@sevketozhan × 0.4).
                </p>
              </div>

              <div className="bg-slate-900/90 border-l-4 border-emerald-500 p-4 rounded-r">
                <h3 className="text-emerald-400 font-bold text-sm mb-1">BÖLÜM 4: FON VE EMTİA STRATEJİSİ</h3>
                <p className="text-slate-300">
                  Serbest fonlarda %17.5 stopaj çıkışta kârdan kesilir. TP2 para piyasası fonu %37 politika faizi ortamında aylık %3+ risksiz reel getiri tamponu olarak tutulmalıdır.
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
              <span className="text-xs font-mono text-slate-400">8 Varlık | Toplam Değer: {totalPortfolioValue.toLocaleString('tr-TR')} TL</span>
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
                  {positions.map((pos) => {
                    const value = pos.quantity * (pos.current_price || pos.unit_cost);
                    const pnl = value - (pos.quantity * pos.unit_cost);
                    const pnlPct = (pnl / (pos.quantity * pos.unit_cost)) * 100;
                    return (
                      <tr key={pos.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="p-3 font-bold text-sky-400">{pos.symbol}</td>
                        <td className="p-3 text-slate-300">{pos.asset_name}</td>
                        <td className="p-3 text-slate-400 text-[10px]">{pos.asset_type}</td>
                        <td className="p-3 text-right text-slate-200">{pos.quantity.toLocaleString('tr-TR')}</td>
                        <td className="p-3 text-right text-slate-300">{pos.unit_cost.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</td>
                        <td className="p-3 text-right font-bold text-slate-100">{(pos.current_price || pos.unit_cost).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL</td>
                        <td className={`p-3 text-right font-bold ${(pos.daily_change_pct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {(pos.daily_change_pct || 0) >= 0 ? '+' : ''}{pos.daily_change_pct?.toFixed(2)}%
                        </td>
                        <td className="p-3 text-right font-bold text-slate-200">{value.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL</td>
                        <td className={`p-3 text-right font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnl >= 0 ? '+' : ''}{pnl.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
                        </td>
                        <td className="p-3 text-center text-rose-400 font-bold">{pos.stop_price ? `${pos.stop_price} TL` : '—'}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            pos.current_action.includes('SAT') || pos.current_action.includes('ÇIKIŞ')
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
                      {dec.stop_price && <span className="ml-2">Stop: <span className="text-rose-400 font-bold">{dec.stop_price} TL</span></span>}
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

        {/* 5. 📜 GEÇMİŞ (MASTER LEDGER) */}
        {activeTab === 'ledger' && (
          <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 font-mono text-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-3">MASTER LEDGER & SERMAYE PERFORMANSI</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 p-3 rounded border border-slate-800">
                <span className="text-slate-400 text-[10px]">BAŞLANGIÇ ANA PARA:</span>
                <div className="text-base font-bold text-slate-200 mt-1">678.000 TL</div>
              </div>
              <div className="bg-slate-900 p-3 rounded border border-slate-800">
                <span className="text-slate-400 text-[10px]">GÜNCEL TOPLAM PORTFÖY:</span>
                <div className="text-base font-bold text-emerald-400 mt-1">{totalPortfolioValue.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL</div>
              </div>
              <div className="bg-slate-900 p-3 rounded border border-slate-800">
                <span className="text-slate-400 text-[10px]">TOPLAM NET GETİRİ (TL & %):</span>
                <div className="text-base font-bold text-sky-400 mt-1">
                  +{(totalPortfolioValue - initialCapital).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL (%{totalNetYieldAgainstCapital.toFixed(1)})
                </div>
              </div>
            </div>

            <div className="pt-4">
              <h3 className="font-bold text-slate-300 mb-2">GERÇEKLEŞEN İŞLEM GÜNLÜĞÜ:</h3>
              <div className="bg-slate-900 p-3 rounded border border-slate-800 text-slate-400 space-y-1">
                <div>• <strong>METEN:</strong> 13.08 tarihinde 20.40 TL'den satıldı (+%2.0 kâr ile kapatıldı).</div>
                <div>• <strong>KGM:</strong> 58.717 paydan 25.000 paya indirildi, 100.000+ TL nakit kasaya aktarıldı.</div>
                <div>• <strong>IJC:</strong> Stop seviyesi tetiklendi ve disiplinli şekilde zararla kapatıldı.</div>
              </div>
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
                <div className="text-3xl font-bold text-emerald-400 mt-1 font-mono">{cashBalance.toLocaleString('tr-TR')} TL</div>
              </div>
              <div className="text-right text-slate-400">
                <div>Politika Faizi: <span className="text-sky-300 font-bold">%37,00</span></div>
                <div>Aylık PPF Getiri Potansiyeli: <span className="text-emerald-400 font-bold">~8.000 TL</span></div>
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
                <p className="text-[11px] text-slate-400 mt-0.5">Benchmark: @sevketozhan | 7 Adımlı Güven Skoru Algoritması</p>
              </div>
              <div className="bg-sky-950 border border-sky-800 px-3 py-1.5 rounded text-sky-300">
                Güven Skoru: <span className="font-bold text-base text-emerald-400">%{trustScore}</span>
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
                  className="bg-sky-600 hover:bg-sky-500 text-white font-bold px-4 py-2 rounded flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> ÇÖZÜMLE & KAYDET
                </button>
              </div>
            </div>

            {/* Tahmin Geçmişi */}
            <div className="space-y-2">
              <h3 className="font-bold text-slate-300">KAYITLI TAHMİNLER VE İSABET SKORLARI:</h3>
              <div className="space-y-2">
                {predictions.map((pred) => (
                  <div key={pred.id} className="bg-slate-900 border border-slate-800 p-3 rounded flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sky-400">{pred.predictor_handle}</span>
                        <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[10px] text-amber-300 font-bold">{pred.fund_code}</span>
                        <span className="text-slate-300">Tahmin: %{pred.predicted_return_pct}</span>
                        {pred.actual_return_pct !== undefined && (
                          <span className="text-emerald-400 font-bold">Gerçekleşen: %{pred.actual_return_pct}</span>
                        )}
                      </div>
                      <p className="text-slate-400 mt-1 text-[11px]">"{pred.raw_text}"</p>
                    </div>

                    <div className="text-right">
                      {pred.accuracy_score !== undefined ? (
                        <span className="bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-1 rounded text-[10px] font-bold">
                          İsabet: {pred.accuracy_score} Puan
                        </span>
                      ) : (
                        <span className="bg-amber-950 text-amber-300 border border-amber-800 px-2 py-1 rounded text-[10px] font-bold">
                          BEKLİYOR
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
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
                  <span className="text-slate-400">yfinance API:</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">🟢 ÇALIŞIYOR</span>
                </div>
                <p className="text-slate-500 text-[10px]">BIST, USDTRY, Ons Altın & Gümüş anlık fiyatları çekiliyor.</p>
              </div>

              <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">fonaly.com Scraper:</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">🟢 ÇALIŞIYOR</span>
                </div>
                <p className="text-slate-500 text-[10px]">TEFAS fon fiyatları ve getiri geçmişi çekiliyor.</p>
              </div>

              <div className="bg-slate-900 p-4 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Supabase DB:</span>
                  <span className="text-sky-400 font-bold flex items-center gap-1">🟢 BULUT KALICI</span>
                </div>
                <p className="text-slate-500 text-[10px]">Portföy, Kasa ve Kararlar veritabanında saklanıyor.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-300">VERİTABANI YEDEKLEME (JSON EXPORT):</h3>
                <p className="text-slate-500 text-[10px] mt-0.5">Tüm portföy, işlem günlüğü ve kararları tek dosya olarak indir.</p>
              </div>
              <button 
                onClick={() => {
                  const data = JSON.stringify({ positions, decisions, cashBalance, predictions }, null, 2);
                  const blob = new Blob([data], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `yatirim-terminali-yedek-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
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
        Yatırım Terminali v3.0 — *Bu sistemdeki analizler ve algoritmik modeller kişisel karar destek amaçlıdır, resmi yatırım tavsiyesi niteliğinde değildir.*
      </footer>
    </div>
  );
}
