'use client';

import React, { useMemo, useState } from 'react';
import { Layers, Pencil, PlusCircle, Save, Trash2, MessageCircle, TrendingUp, CheckCircle, XCircle, Camera, FileText, Upload, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { FundHoldingRow, SocialPrediction } from '@/lib/types';
import type { HoldingPrice, FundPrediction } from '@/lib/fundHoldings';
import { computeFundPrediction, summarizeHoldingRows } from '@/lib/fundHoldings';
import { formatPublic } from '@/lib/mask';
import { TÜR_LABEL } from '@/lib/assetMeta';
import { shouldAutoResearchFund } from '@/lib/fundCodes';
import type { FundHoldingProposal } from '@/lib/repo';

export interface FundHoldingDraft {
  fund_code: string;
  ticker: string;
  company_name?: string | null;
  weight_pct: number;
  as_of_date: string;
  notes?: string | null;
}

interface Props {
  rows: FundHoldingRow[];
  prices: Record<string, HoldingPrice | null>;
  predictions?: SocialPrediction[];
  proposals?: FundHoldingProposal[];
  portfolioFundCodes?: string[];
  masked: boolean;
  /** Veritabanı hazır değilse form devre dışı (yazma denemesi yapılmaz). */
  canWrite: boolean;
  onUpsert: (draft: FundHoldingDraft) => Promise<void>;
  onUpsertKapPdf?: (draft: FundHoldingDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onApproveProposal?: (p: FundHoldingProposal) => Promise<void>;
  onRejectProposal?: (id: string) => Promise<void>;
}

// Portföy kodu İÇERMEZ: bu bileşen herkese açık bundle'da yer alır.
const EMPTY_FORM = {
  fund_code: '',
  ticker: '',
  company_name: '',
  weight_pct: '',
  as_of_date: new Date().toISOString().slice(0, 10),
  notes: '',
};

/**
 * P3 — FON İÇERİĞİ SEKMESİ + v3.4 OCR onay kutusu
 *
 * Fon başına tablo: hisse / resmî ad / ağırlık % / hissenin günlük değişim % /
 * fona etki (pp). Üstte as_of_date + source + dışlanan düşük etkili satır sayısı.
 * Manuel override formu source='manual' yazar; otomatik sync job'u bu satırları
 * ASLA ezmez (koruma scripts/fund_holdings/sync.ts içinde).
 *
 * v3.4: @sevketozhan günlük etki fotoğrafındaki tahmini ağırlıklar OCR ile
 * fund_holding_proposals tablosuna pending olarak yazılır. Burada onay kutucuğu
 * gösterilir: "twitterdan @sevketozhan hesabının günlük etki paylaşımından
 * #TICKER ağırlığı %X olarak değişti bilgisi çekildi onaylarsanız hisse
 * içeriği değiştirilecek" [ONAYLA][REDDET]. Onay → fund_holdings upsert
 * source=manual + notes=twitter-photo, proposal approved. Red → rejected.
 * Otomatik fund_holdings yazımı YOK — sadece manuel onay ile.
 */
export default function FundContentTab({ rows, prices, predictions = [], proposals = [], portfolioFundCodes = [], masked, canWrite, onUpsert, onUpsertKapPdf, onDelete, onApproveProposal, onRejectProposal }: Props) {
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  // KAP PDF yükleme (TLY aylık raporu)
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfFundCode, setPdfFundCode] = useState('TLY');
  const [pdfParsing, setPdfParsing] = useState(false);
  const [pdfResult, setPdfResult] = useState<any>(null);
  const [pdfError, setPdfError] = useState('');
  const [pdfSaving, setPdfSaving] = useState(false);

  const summaries = useMemo(() => summarizeHoldingRows(rows), [rows]);

  const byFund = useMemo(() => {
    const map = new Map<string, FundHoldingRow[]>();
    for (const r of rows) {
      const list = map.get(r.fund_code) ?? [];
      list.push(r);
      map.set(r.fund_code, list);
    }
    map.forEach((list) => list.sort((a, b) => b.weight_pct - a.weight_pct));
    return map;
  }, [rows]);

  const proposalsByFund = useMemo(() => {
    const map = new Map<string, FundHoldingProposal[]>();
    for (const p of proposals) {
      const code = p.fund_code.toUpperCase();
      const list = map.get(code) ?? [];
      list.push(p);
      map.set(code, list);
    }
    map.forEach((list) => list.sort((a, b) => b.weight_pct - a.weight_pct));
    return map;
  }, [proposals]);

  const predictionsMap = useMemo(() => {
    const out: Record<string, FundPrediction> = {};
    byFund.forEach((list, code) => {
      out[code] = computeFundPrediction(
        code,
        list.map((r) => ({ ticker: r.ticker, name: r.company_name, weightPct: r.weight_pct, prevWeightPct: null })),
        prices
      );
    });
    return out;
  }, [byFund, prices]);

  // Sosyal tahminler — fon bazında grupla
  const socialByFund = useMemo(() => {
    const map = new Map<string, SocialPrediction[]>();
    for (const p of predictions) {
      const code = p.fund_code.toUpperCase();
      const list = map.get(code) ?? [];
      list.push(p);
      map.set(code, list);
    }
    map.forEach((list) => list.sort((a, b) => b.prediction_date.localeCompare(a.prediction_date)));
    return map;
  }, [predictions]);

  // Keep old name for compatibility inside render
  const predictionsLocal = predictionsMap;

  const submit = async () => {
    const ticker = form.ticker.trim().toUpperCase();
    const weight = parseFloat(form.weight_pct.replace(',', '.'));
    const code = form.fund_code.trim().toUpperCase();
    if (!code || !ticker) { setFormError('Fon kodu ve hisse kodu zorunlu.'); return; }
    if (!/^[A-Z0-9]{2,10}$/.test(ticker)) { setFormError('Hisse kodu 2-10 karakter (A-Z, 0-9) olmalı.'); return; }
    if (!Number.isFinite(weight) || weight <= 0 || weight > 100) { setFormError('Ağırlık 0-100 arasında bir sayı olmalı.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.as_of_date)) { setFormError('Rapor dönemi GG.AA.YYYY biçiminde olmalı (YYYY-AA-GG).'); return; }

    setBusy(true);
    setFormError('');
    await onUpsert({
      fund_code: code,
      ticker,
      company_name: form.company_name.trim() || null,
      weight_pct: Number(weight.toFixed(4)),
      as_of_date: form.as_of_date,
      notes: form.notes.trim() || 'manuel override (UI)',
    });
    setBusy(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const startEdit = (r: FundHoldingRow) => {
    setEditingId(r.id);
    setForm({
      fund_code: r.fund_code,
      ticker: r.ticker,
      company_name: r.company_name ?? '',
      weight_pct: String(r.weight_pct),
      as_of_date: r.as_of_date,
      notes: r.notes ?? '',
    });
  };


  const handlePdfParse = async () => {
    if (!pdfFile) { setPdfError('PDF dosyası seçin'); return; }
    setPdfParsing(true);
    setPdfError('');
    setPdfResult(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) { setPdfError('Oturum token yok — tekrar giriş yapın'); return; }
      const fd = new FormData();
      fd.append('file', pdfFile);
      fd.append('fund_code', pdfFundCode.trim().toUpperCase() || 'TLY');
      const res = await fetch('/api/fund-holdings/parse-pdf', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setPdfError(json.error || json.reason || 'PDF parse edilemedi');
        if (json.previewText) console.log('PDF preview', json.previewText);
        return;
      }
      setPdfResult(json);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : String(e));
    } finally {
      setPdfParsing(false);
    }
  };

  const handlePdfSaveAll = async () => {
    if (!pdfResult?.holdings?.length) return;
    setPdfSaving(true);
    try {
      const saver = onUpsertKapPdf ?? onUpsert;
      for (const h of pdfResult.holdings) {
        await saver({
          fund_code: h.fund_code,
          ticker: h.ticker,
          company_name: h.company_name ?? null,
          weight_pct: h.weight_pct,
          as_of_date: h.as_of_date,
          notes: h.notes ?? `${pdfResult.reportLabel} | KAP PDF (ana kaynak, ham veri)`,
        });
      }
      setPdfResult(null);
      setPdfFile(null);
    } finally {
      setPdfSaving(false);
    }
  };

  return (
    <div className="space-y-6 font-mono text-xs">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Layers className="w-4 h-4 text-sky-400" /> FON İÇERİĞİ (HİSSE DAĞILIMI)
          </h2>
          <p className="text-[10px] text-slate-500 mt-1">
            Kaynak: aylık KAP portföy dağılım raporları (otomatik job) + manuel override.
            Fona etkisi %0,01&apos;in altındaki hisseler hesaplamaya alınmaz.
            Twitter foto OCR önerileri onay kutusu ile manuel yazılır.
          </p>
        </div>
        <span className="text-[10px] text-slate-400 bg-slate-900 border border-slate-800 px-2 py-1 rounded">
          {rows.length} satır • {summaries.length} fon • {proposals.length} öneri
        </span>
      </div>

      {/* v3.4 — Onay bekleyen Twitter foto OCR önerileri (global) */}
      {proposals.length > 0 && (
        <div className="bg-amber-950/20 border border-amber-800 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-bold text-amber-300 flex items-center gap-2">
            <Camera className="w-4 h-4" /> TWITTER FOTO OCR — ONAY BEKLEYEN ÖNERİLER ({proposals.length})
          </h3>
          <p className="text-[10px] text-amber-200/70">
            @sevketozhan günlük etki fotoğrafından tahmini ağırlıklar OCR ile çekildi. Onaylarsanız fund_holdings
            tablosuna source=manual olarak yazılacak (otomatik yazım YOK, resmi KAP raporu öncelikli).
          </p>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {proposals.map((pr) => (
              <div key={pr.id} className="bg-slate-900 border border-amber-900/50 rounded p-3 flex items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sky-300">{pr.fund_code}</span>
                    <span className="font-bold text-amber-300">#{pr.ticker}</span>
                    <span className="text-slate-200">ağırlığı %{formatPublic(pr.weight_pct, { digits: 2 })} olarak değişti</span>
                    {pr.prev_weight_pct != null && (
                      <span className="text-slate-400">(önceki %{formatPublic(pr.prev_weight_pct, { digits: 2 })} → %{formatPublic(pr.weight_pct, { digits: 2 })})</span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    twitterdan {pr.predictor_handle ?? '@sevketozhan'} hesabının günlük etki paylaşımından #{pr.ticker} ağırlığı %{formatPublic(pr.weight_pct, { digits: 2 })} olarak değişti bilgisi çekildi
                    {pr.source_tweet_id ? ` (kaynak: ${pr.source_tweet_id})` : ''} — onaylarsanız hisse içeriği değiştirilecek
                  </div>
                  {pr.raw_text && <div className="text-[9px] text-slate-500 mt-1 truncate">{pr.raw_text.slice(0, 200)}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onApproveProposal?.(pr)}
                    disabled={!canWrite}
                    className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold px-3 py-1.5 rounded flex items-center gap-1"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> ONAYLA
                  </button>
                  <button
                    onClick={() => onRejectProposal?.(pr.id)}
                    disabled={!canWrite}
                    className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 font-bold px-3 py-1.5 rounded flex items-center gap-1"
                  >
                    <XCircle className="w-3.5 h-3.5" /> REDDET
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <div className="bg-[#111726] border border-slate-800 rounded-lg p-6 text-slate-400">
          Fon içeriği kaydı yok. Aşağıdaki formdan elle ekleyin ya da
          <span className="text-slate-300"> fund-holdings-sync </span>
          işini çalıştırın (GitHub Actions → fund-holdings-sync → Run workflow).
          Tablo yoksa önce <span className="text-slate-300">supabase/supabase_fund_holdings_migration.sql</span> çalıştırılmalı.
        </div>
      )}

      {/* Portföyde olup içeriği henüz çekilmemiş fonlar (THF dahil) — otomatik araştırma bekliyor */}
      {portfolioFundCodes.length > 0 && (() => {
        const existing = new Set(rows.map((r) => r.fund_code.toUpperCase()));
        const missing = portfolioFundCodes.filter((c) => !existing.has(c.toUpperCase()) && shouldAutoResearchFund(c));
        if (missing.length === 0) return null;
        return (
          <div className="bg-sky-950/20 border border-sky-800 rounded-lg p-4 space-y-2">
            <h3 className="text-sm font-bold text-sky-300">PORTFÖYDEKİ FONLAR — İÇERİK OTOMATİK ARAŞTIRILIYOR ({missing.length})</h3>
            <p className="text-[10px] text-slate-400">Bu fonlar portföyünüzde var ama fund_holdings tablosunda kaydı yok. Otomatik araştırma fintables üzerinden çekiyor (THF dahil). Birkaç saniye içinde tabloya eklenecek.</p>
            <div className="flex flex-wrap gap-2">
              {missing.map((code) => (
                <span key={code} className="px-2 py-1 rounded bg-slate-900 border border-sky-800 text-sky-300 text-[11px] font-bold">{code} — araştırılıyor...</span>
              ))}
            </div>
          </div>
        );
      })()}

      {summaries.map((s) => {
        const list = byFund.get(s.fundCode) ?? [];
        const pred = predictionsLocal[s.fundCode];
        const socialList = socialByFund.get(s.fundCode) ?? [];
        const validSocial = socialList.filter((p) => p.predicted_return_pct != null && p.status !== 'VERI_EKSİK');
        const avgSocial = validSocial.length > 0 ? validSocial.reduce((sum, p) => sum + (p.predicted_return_pct as number), 0) / validSocial.length : null;
        const blended = pred && pred.predictedPct != null && avgSocial != null ? pred.predictedPct * 0.6 + avgSocial * 0.4 : null;
        const fundProposals = proposalsByFund.get(s.fundCode) ?? [];
        return (
          <div key={s.fundCode} className="bg-[#111726] border border-slate-800 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sky-300 text-sm">{s.fundCode}</h3>
                <div className="text-[10px] text-slate-500 mt-1 space-x-3">
                  <span>📅 Rapor dönemi: <span className="text-slate-300">{s.asOfDate ?? '—'}</span></span>
                  <span>📦 Kaynak: <span className="text-slate-300">{s.sources.join(' + ') || '—'}</span></span>
                  <span>🔢 Satır: <span className="text-slate-300">{s.rowCount}</span></span>
                  <span>
                    ⚖️ Toplam ağırlık: <span className="text-slate-300">%{formatPublic(s.totalWeightPct, { digits: 2 })}</span>
                  </span>
                  <span>
                    🚫 Dışlanan (&lt;%0,01):{' '}
                    <span className="text-slate-300">
                      {s.excludedCount != null ? s.excludedCount : 'VERİ EKSİK'}
                    </span>
                  </span>
                  {s.manualCount > 0 && (
                    <span className="text-amber-300">✍️ {s.manualCount} manuel satır (sync ezmez)</span>
                  )}
                  {fundProposals.length > 0 && (
                    <span className="text-amber-300">📷 {fundProposals.length} OCR öneri bekliyor</span>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500">GÜNLÜK TAHMİN (ağırlıklı)</div>
                <div className={`text-lg font-bold ${pred && (pred.predictedPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pred && pred.predictedPct != null
                    ? `${pred.predictedPct >= 0 ? '+' : ''}${formatPublic(pred.predictedPct, { digits: 2 })}%`
                    : '—'}
                </div>
                <div className="text-[10px] text-slate-500">
                  Kaplama: %{pred ? formatPublic(pred.coveredPct, { digits: 2 }) : '—'}
                  {pred && pred.missingTickers.length > 0 && (
                    <span className="text-amber-300"> • fiyatı eksik: {pred.missingTickers.join(', ')}</span>
                  )}
                </div>
                {/* Sosyal tahmin beslemesi */}
                {socialList.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-800/50 space-y-1">
                    <div className="flex items-center gap-1 text-[10px] text-sky-300 font-bold">
                      <MessageCircle className="w-3 h-3" /> SOSYAL TAHMİN ({socialList.length}) {avgSocial != null && <span className="text-slate-300">• Ort: {avgSocial >= 0 ? '+' : ''}{formatPublic(avgSocial, { digits: 2 })}%</span>}
                      {blended != null && <span className="text-amber-300 flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Birleştirilmiş: {blended >= 0 ? '+' : ''}{formatPublic(blended, { digits: 2 })}% (Model %60 + Sosyal %40)</span>}
                    </div>
                    <div className="space-y-0.5 max-h-20 overflow-y-auto">
                      {socialList.slice(0, 3).map((sp) => (
                        <div key={sp.id} className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span className="text-sky-400">{sp.predictor_handle}</span>
                          <span className={`${(sp.predicted_return_pct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{sp.predicted_return_pct != null ? `${sp.predicted_return_pct >= 0 ? '+' : ''}${formatPublic(sp.predicted_return_pct, { digits: 2 })}%` : 'VERİ EKSİK'}</span>
                          <span>{sp.prediction_date}</span>
                          <span className={`px-1 rounded border text-[9px] ${sp.status === 'DOGRULANDI' ? 'bg-emerald-950 border-emerald-800 text-emerald-300' : sp.status === 'VERI_EKSİK' ? 'bg-amber-950 border-amber-800 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-300'}`}>{sp.status}</span>
                          {sp.accuracy_score != null && <span className="text-slate-500">isabet %{formatPublic(sp.accuracy_score, { digits: 0 })}</span>}
                        </div>
                      ))}
                      {socialList.length > 3 && <div className="text-[9px] text-slate-500">+{socialList.length - 3} daha → Sosyal Doğrulama sekmesinde</div>}
                    </div>
                  </div>
                )}
                {/* DFI özel uyarı — fintables secondary eksik veri */}
                {s.fundCode === 'DFI' && s.totalWeightPct < 50 && (
                  <div className="mt-2 text-[9px] text-amber-300 bg-amber-950/30 border border-amber-800 rounded px-2 py-1">
                    ⚠️ DFI içeriği fintables secondary kaynaktan (free tier sadece 3 hisse gösteriyor, resmi hisse oranı %53.32). Resmi KAP PDF ile doğrulama için Faz 4 bekleniyor.
                  </div>
                )}
              </div>
            </div>

            {/* Fon bazında OCR önerileri (inline) */}
            {fundProposals.length > 0 && (
              <div className="bg-amber-950/10 border-b border-amber-900/30 p-3 space-y-2">
                <div className="text-[11px] font-bold text-amber-300 flex items-center gap-1"><Camera className="w-3 h-3" /> {s.fundCode} için {fundProposals.length} OCR önerisi — onay bekliyor</div>
                {fundProposals.map((pr) => (
                  <div key={pr.id} className="flex items-center justify-between gap-2 bg-slate-900/60 border border-amber-900/20 rounded px-3 py-2">
                    <span className="text-[11px] text-slate-200">
                      twitterdan {pr.predictor_handle ?? '@sevketozhan'} hesabının günlük etki paylaşımından #{pr.ticker} ağırlığı %{formatPublic(pr.weight_pct, { digits: 2 })} olarak değişti bilgisi çekildi onaylarsanız hisse içeriği değiştirilecek
                      {pr.prev_weight_pct != null ? ` (önceki %${formatPublic(pr.prev_weight_pct, { digits: 2 })} → %${formatPublic(pr.weight_pct, { digits: 2 })})` : ''}
                    </span>
                    <span className="flex gap-1 shrink-0">
                      <button onClick={() => onApproveProposal?.(pr)} disabled={!canWrite} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold px-2 py-1 rounded text-[10px] flex items-center gap-1"><CheckCircle className="w-3 h-3" /> ONAYLA</button>
                      <button onClick={() => onRejectProposal?.(pr.id)} disabled={!canWrite} className="bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 font-bold px-2 py-1 rounded text-[10px] flex items-center gap-1"><XCircle className="w-3 h-3" /> REDDET</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0d121f] text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="p-3">VARLIK</th>
                    <th className="p-3">RESMÎ AD</th>
                    <th className="p-3 text-right">AĞIRLIK %</th>
                    <th className="p-3 text-right">GÜNLÜK %</th>
                    <th className="p-3 text-right">FONA ETKİ (pp)</th>
                    <th className="p-3 text-center">KAYNAK</th>
                    <th className="p-3 text-center">İŞLEM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {list.map((r) => {
                    const price = prices[r.ticker] ?? null;
                    const impact = price && Number.isFinite(price.changePct)
                      ? (r.weight_pct * price.changePct) / 100
                      : null;
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/30">
                        <td className="p-3">
                          <span className="font-bold text-sky-400">{r.ticker}</span>
                          {r.asset_type === 'TEFAS_FON' && (
                            <span
                              title="Fonun alt fonu - fiyat TEFAS NAV'dan (fonaly.com), gunde bir yenilenir"
                              className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-950 text-violet-300 border border-violet-800"
                            >
                              {TÜR_LABEL.TEFAS_FON}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-slate-300">{r.company_name ?? '—'}</td>
                        <td className="p-3 text-right text-slate-100 font-bold">
                          %{formatPublic(r.weight_pct, { digits: 2 })}
                        </td>
                        <td className={`p-3 text-right ${price == null ? 'text-amber-300' : price.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {price == null ? 'VERİ EKSİK' : `${price.changePct >= 0 ? '+' : ''}${formatPublic(price.changePct, { digits: 2 })}%`}
                        </td>
                        <td className={`p-3 text-right font-bold ${impact == null ? 'text-slate-500' : impact >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {impact == null ? '—' : `${impact >= 0 ? '+' : ''}${formatPublic(impact, { digits: 3 })}`}
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            r.source === 'manual'
                              ? 'bg-amber-950 text-amber-300 border-amber-800'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}>{r.source}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className="inline-flex gap-1.5">
                            <button
                              onClick={() => startEdit(r)}
                              disabled={!canWrite}
                              title="Düzenle (source=manual olur)"
                              className="text-slate-400 hover:text-sky-300 disabled:opacity-40"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => onDelete(r.id)}
                              disabled={!canWrite}
                              title="Sil"
                              className="text-slate-400 hover:text-rose-300 disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* KAP PDF Yükleme — TLY aylık dağılım raporu */}
      <div className="bg-[#111726] border border-sky-800 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-bold text-sky-300 flex items-center gap-2">
          <FileText className="w-4 h-4" /> KAP PDF YÜKLE — AYLIK PORTFÖY DAĞILIM RAPORU (TLY)
        </h3>
        <p className="text-[10px] text-slate-400">
          KAP'tan indirdiğin TLY_2026.xx.pdf gibi aylık raporu yükle. Sistem hisse kodlarını ve GRUP (%) ağırlıklarını otomatik çıkarır,
          aynı ticker birden fazla lot ise toplar, %0,01 altı atar. Önizleme sonrası onayla → fund_holdings tablosuna source='kap-pdf' + manual override olarak yazar (sync ezmez).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input value={pdfFundCode} onChange={(e) => setPdfFundCode(e.target.value.toUpperCase())} placeholder="FON KODU (TLY)" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 uppercase focus:outline-none focus:border-sky-500" />
          <input type="file" accept=".pdf,application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-300 file:mr-2 file:bg-sky-800 file:text-white file:border-0 file:rounded file:px-2 file:py-1 file:text-[11px]" />
          <button onClick={handlePdfParse} disabled={pdfParsing || !pdfFile || !canWrite} className="bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white font-bold px-4 py-2 rounded flex items-center gap-2 justify-center">
            {pdfParsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} {pdfParsing ? 'PARSE EDİLİYOR...' : 'PDF\'İ PARSE ET'}
          </button>
          <div className="text-[10px] text-slate-500 flex items-center">{pdfFile ? `${pdfFile.name} (${(pdfFile.size/1024).toFixed(0)} KB)` : 'PDF seçilmedi'}</div>
        </div>
        {pdfError && <div className="text-rose-400 text-[11px] bg-rose-950/30 border border-rose-800 rounded p-2">⚠️ {pdfError}</div>}
        {pdfResult && (
          <div className="space-y-3 bg-slate-900 border border-slate-800 rounded p-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-[11px]">
                <span className="text-sky-300 font-bold">{pdfResult.code}</span>
                <span className="text-slate-400 ml-2">📅 {pdfResult.asOfDate ?? '—'} — {pdfResult.reportLabel}</span>
                <span className="text-slate-300 ml-2">🔢 {pdfResult.rowCount} hisse</span>
                <span className="text-slate-300 ml-2">⚖️ Toplam %{formatPublic(pdfResult.totalWeight, { digits: 2 })}</span>
                {pdfResult.excludedCount > 0 && <span className="text-slate-500 ml-2">🚫 {pdfResult.excludedCount} dışlandı (&lt;%0,01)</span>}
              </div>
              <button onClick={handlePdfSaveAll} disabled={pdfSaving || !canWrite} className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-bold px-4 py-2 rounded flex items-center gap-2">
                {pdfSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} {pdfSaving ? 'KAYDEDİLİYOR...' : `TÜMÜNÜ KAYDET (${pdfResult.rowCount})`}
              </button>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-800 rounded">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-[#0d121f] text-slate-400 sticky top-0">
                  <tr><th className="p-2">HİSSE</th><th className="p-2">AD</th><th className="p-2 text-right">AĞIRLIK %</th><th className="p-2">TARİH</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {pdfResult.holdings.map((h: any) => (
                    <tr key={h.ticker} className="hover:bg-slate-800/30">
                      <td className="p-2 font-bold text-sky-400">{h.ticker}</td>
                      <td className="p-2 text-slate-300">{h.company_name ?? '—'}</td>
                      <td className="p-2 text-right text-slate-100">%{formatPublic(h.weight_pct, { digits: 2 })}</td>
                      <td className="p-2 text-slate-400">{h.as_of_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-500">Kaydedince her satır source='manual' (kap-pdf notu ile) olur, otomatik sync ezmez. Önceki TLY kayıtları aynı ticker için güncellenir, raporda olmayan auto satırlar daha sonra fund-holdings-sync tarafından temizlenebilir (manuel korunur).</p>
          </div>
        )}
      </div>

      {/* Manuel override formu */}
      <div className="bg-[#111726] border border-slate-800 rounded-lg p-5 space-y-3">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
          {editingId ? <Pencil className="w-4 h-4 text-amber-400" /> : <PlusCircle className="w-4 h-4 text-sky-400" />}
          {editingId ? 'SATIRI DÜZENLE' : 'MANUEL SATIR EKLE (override)'}
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <input value={form.fund_code} onChange={(e) => setForm({ ...form, fund_code: e.target.value })} placeholder="FON KODU" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 uppercase focus:outline-none focus:border-sky-500" />
          <input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} placeholder="HİSSE KODU" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 uppercase focus:outline-none focus:border-sky-500" />
          <input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="RESMÎ AD" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
          <input value={form.weight_pct} onChange={(e) => setForm({ ...form, weight_pct: e.target.value })} placeholder="AĞIRLIK %" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
          <input value={form.as_of_date} onChange={(e) => setForm({ ...form, as_of_date: e.target.value })} placeholder="YYYY-AA-GG" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="NOT" className="bg-slate-900 border border-slate-700 rounded px-3 py-2 focus:outline-none focus:border-sky-500" />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={submit}
            disabled={busy || !canWrite}
            className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded flex items-center gap-2"
          >
            <Save className="w-3.5 h-3.5" /> {editingId ? 'GÜNCELLE' : 'KAYDET'}
          </button>
          {editingId && (
            <button
              onClick={() => { setEditingId(null); setForm({ ...EMPTY_FORM }); setFormError(''); }}
              className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-4 py-2 rounded border border-slate-700"
            >
              VAZGEÇ
            </button>
          )}
          {formError && <span className="text-rose-400 text-[11px]">⚠️ {formError}</span>}
          {!canWrite && <span className="text-amber-300 text-[11px]">Yazma için veritabanı bağlantısı ve oturum gerekli.</span>}
        </div>
        <p className="text-[10px] text-slate-500">
          Kaydedilen satır <span className="text-amber-300">source=&apos;manual&apos;</span> olur; otomatik
          fund-holdings-sync işi manuel satırları asla ezmez ve silmez. Ağırlık toplamı 100&apos;ü aşmamalı.
          Twitter foto OCR önerileri yalnızca onay ile yazılır — otomatik yazım yok.
        </p>
      </div>
    </div>
  );
}
