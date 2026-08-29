'use client';

import React, { useEffect, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Lock, RefreshCw } from 'lucide-react';
import type { PublicMarketData } from '@/lib/marketData';
import { formatPublic } from '@/lib/mask';

interface Props {
  onLoginClick: () => void;
}

const REFRESH_MS = 60_000;

/** Değişim rozeti — kamu verisi, maskelenmez. */
function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) {
    return <span className="text-slate-500">—</span>;
  }
  const up = pct >= 0;
  return (
    <span className={`flex items-center justify-end gap-1 ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {formatPublic(pct, { signed: true, digits: 2 })}%
    </span>
  );
}

/**
 * P1 — MİSAFİR GÖRÜNÜMÜ (herkese açık, salt okunur)
 *
 * Yalnızca kamuya açık piyasa verisi: endeksler + standart izleme listesi +
 * altın/gümüş enstrümanları. PORTFÖYE AİT HİÇBİR SAYI BU EKRANDA YOKTUR.
 * Veri kaynağı: /api/market/public (sunucu tarafı; oturum gerektirmez).
 */
export default function GuestMarketView({ onLoginClick }: Props) {
  const [data, setData] = useState<PublicMarketData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch('/api/market/public')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (cancelled) return;
          if (d && d.instruments) { setData(d); setError(null); }
          else setError('Piyasa verisi alınamadı.');
        })
        .catch(() => { if (!cancelled) setError('Piyasa verisi alınamadı.'); });
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const idx = data?.indices;
  const stocks = data?.instruments.filter((i) => i.kind === 'HISSE') ?? [];
  const precious = data?.instruments.filter((i) => i.kind !== 'HISSE') ?? [];
  const groups = Array.from(new Set(stocks.map((s) => s.group)));

  return (
    <div className="space-y-6">
      {/* CTA */}
      <div className="bg-gradient-to-r from-sky-950/70 to-[#111726] border border-sky-800 rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-sky-300 font-mono flex items-center gap-2">
            <Lock className="w-4 h-4" /> YATIRIM TERMİNALİ — HALKA AÇIK PİYASA EKRANI
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-mono">
            Portföy, kasa, kararlar ve tahminler yalnızca oturum açan kullanıcıya gösterilir.
          </p>
        </div>
        <button
          onClick={onLoginClick}
          className="bg-sky-600 hover:bg-sky-500 text-white font-mono font-bold text-xs px-5 py-2.5 rounded flex items-center gap-2"
        >
          <Lock className="w-3.5 h-3.5" /> PORTFÖYÜNÜZÜ GÖRMEK İÇİN GİRİŞ YAPIN
        </button>
      </div>

      {error && (
        <div className="border border-amber-800 bg-amber-950/40 text-amber-200 rounded-lg px-4 py-3 text-xs font-mono">
          ⚠️ {error}
        </div>
      )}

      {/* Endeksler */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'BIST 100', q: idx?.xu100, digits: 0, suffix: '' },
          { label: 'USD/TRY', q: idx?.usdtry, digits: 4, suffix: ' TL' },
          { label: 'GRAM ALTIN', q: idx?.gramGold, digits: 0, suffix: ' TL' },
          { label: 'ONS GÜMÜŞ', q: idx?.ounceSilver, digits: 2, suffix: ' $' },
        ].map((c) => (
          <div key={c.label} className="bg-[#111726] border border-slate-800 rounded-lg p-4">
            <div className="text-slate-400 text-[10px] font-mono">{c.label}</div>
            <div className="text-xl font-bold text-slate-100 mt-1 font-mono">
              {c.q ? formatPublic(c.q.price, { digits: c.digits }) + c.suffix : '—'}
            </div>
            <div className="text-xs font-mono mt-1 flex justify-end">
              <ChangeBadge pct={c.q?.changePct ?? null} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span className="flex items-center gap-2">
          <Activity className={`w-3.5 h-3.5 ${data?.source === 'live' ? 'text-emerald-400 animate-pulse' : 'text-amber-400'}`} />
          {data?.source === 'live' ? 'CANLI VERİ' : 'SON VERİ'} {data ? `• ${data.dataDate}` : ''}
          {idx ? ` • Altın/Gümüş rasyosu ${formatPublic(idx.goldSilverRatio.value, { digits: 1 })}` : ''}
          {idx ? ` • TCMB politika %${formatPublic(idx.interestRate.value, { digits: 2 })}` : ''}
        </span>
        <button
          onClick={() => fetch('/api/market/public').then((r) => r.json()).then((d) => d?.instruments && setData(d))}
          className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200"
        >
          <RefreshCw className="w-3 h-3" /> YENİLE
        </button>
      </div>

      {/* Standart hisseler */}
      <div className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-mono text-sm font-bold text-slate-200">BIST 100 — STANDART İZLEME LİSTESİ</h2>
          <p className="text-[10px] text-slate-500 font-mono mt-1">
            Kamuya açık fiyat verisi (Yahoo Finance). Liste tek dosyadan yönetilir: lib/publicWatchlist.ts
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0d121f] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">KOD</th>
                <th className="p-3">ŞİRKET</th>
                <th className="p-3 text-right">FİYAT (TL)</th>
                <th className="p-3 text-right">GÜNLÜK %</th>
                <th className="p-3 text-right">VERİ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {groups.map((g) => (
                <React.Fragment key={g}>
                  <tr className="bg-sky-950/30">
                    <td colSpan={5} className="px-3 py-1.5 text-[10px] font-bold text-sky-300 tracking-wider">{g}</td>
                  </tr>
                  {stocks.filter((s) => s.group === g).map((s) => (
                    <tr key={s.symbol} className="hover:bg-slate-800/30">
                      <td className="p-3 font-bold text-sky-400">{s.symbol}</td>
                      <td className="p-3 text-slate-300">{s.name}</td>
                      <td className="p-3 text-right text-slate-100 font-bold">
                        {s.price != null ? formatPublic(s.price, { digits: 2 }) : 'VERİ EKSİK'}
                      </td>
                      <td className="p-3 text-right"><ChangeBadge pct={s.changePct} /></td>
                      <td className="p-3 text-right text-[10px] text-slate-500">
                        {s.price == null
                          ? (s.verified ? 'kaynak yanıt vermedi' : 'ticker doğrulanmadı')
                          : s.asOf ?? ''}
                      </td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Altın / gümüş */}
      <div className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h2 className="font-mono text-sm font-bold text-slate-200">ALTIN & GÜMÜŞ</h2>
          <p className="text-[10px] text-slate-500 font-mono mt-1">
            Spot fiyatlar canlı; fon/BYF satırlarında fiyat çözülemezse &quot;VERİ EKSİK&quot; yazılır (uydurma değer yok).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#0d121f] text-slate-400 border-b border-slate-800">
              <tr>
                <th className="p-3">KOD</th>
                <th className="p-3">ENSTRÜMAN</th>
                <th className="p-3 text-right">FİYAT</th>
                <th className="p-3 text-right">GÜNLÜK %</th>
                <th className="p-3 text-right">VERİ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {precious.map((s) => (
                <tr key={s.symbol} className="hover:bg-slate-800/30">
                  <td className="p-3 font-bold text-amber-300">{s.symbol}</td>
                  <td className="p-3 text-slate-300">{s.name}</td>
                  <td className="p-3 text-right text-slate-100 font-bold">
                    {s.price != null ? formatPublic(s.price, { digits: s.kind === 'GUMUS' ? 2 : 0 }) : 'VERİ EKSİK'}
                  </td>
                  <td className="p-3 text-right"><ChangeBadge pct={s.changePct} /></td>
                  <td className="p-3 text-right text-[10px] text-slate-500">
                    {s.price == null ? (s.verified ? 'kaynak yanıt vermedi' : 'ticker doğrulanmadı') : s.asOf ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
