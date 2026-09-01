/**
 * YATIRIM TERMİNALİ — twitter-sync / ADIM 2: Parse + Supabase YAZIMI
 *
 * data/tweets.json → lib/parseSocial.ts (tek parser) → Supabase.
 *
 * DEĞİŞTİRİLEMEZ KURALLAR (kodda uygulama):
 *  Rule 1) YALNIZCA `social_predictions` tablosuna yazılır (TABLO sabit;
 *          repo.ts / başka tablo YOK).
 *  Rule 2) Kimlik bilgisi log'a yazılmaz — yalnızca özet sayılar yazdırılır.
 *  Rule 3) raw_text AYNEN saklanır; "bence/tahminime göre" dili EKLENMEZ.
 *  Rule 4) Sayı çözülemezse value=null → status='VERI_EKSİK'; uydurma YOK.
 *
 * Davranış:
 *  - Format A  "#TLY 0,53"      → yeni tahmin satırı (BEKLIYOR)
 *  - Format B  "#TLY +0.8218%"  → aynı fon + aynı gün için TEK açık tahmin
 *    varsa otomatik doğrulama (accuracy: lib/calculations); yoksa/çokluysa
 *    ham veri satırı (yanlış eşleşme riski yok).
 *  - Idempotency: source_tweet_id (unique index) → tekrar çalıştırmada
 *    aynı tweet yeniden yazılmaz.
 *
 * Ortam değişkenleri:
 *  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (üretim; GitHub Secrets)
 *  DRY_RUN=1      → Supabase'e YAZMAZ, yazacakları stdout'a basar
 *  AUTO_VERIFY=0  → Format B otomatik doğrulamayı kapatır (varsayılan: açık)
 */

import { readFileSync } from 'node:fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseSocialTweet, parseAllSocialTweets, KNOWN_SYMBOLS } from '../../lib/parseSocial';
import { calculateAccuracyScore } from '../../lib/calculations';

/** Rule 1: tek dokunulan tablo. */
const TABLO = 'social_predictions';

interface TweetRow {
  id: string;
  text: string;
  created_at?: string;
}

interface PredictionRow {
  source_tweet_id: string;
  predictor_handle: string;
  fund_code: string;
  predicted_return_pct: number | null;
  prediction_category: string;
  raw_text: string;
  prediction_date: string;
  status: 'BEKLIYOR' | 'VERI_EKSİK';
}

interface VerifyOp {
  source_tweet_id: string;
  actual: number;
  acc: number;
}

/** 'Wed Aug 25 18:10:00 +0000 2026' veya ISO → YYYY-MM-DD (çözülemezse null). */
function toIsoDate(s: string | undefined): string | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const DRY_RUN = process.env.DRY_RUN === '1';
  const AUTO_VERIFY = process.env.AUTO_VERIFY !== '0';
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  let tweets: TweetRow[];
  try {
    tweets = JSON.parse(readFileSync('data/tweets.json', 'utf8'));
  } catch {
    console.error('HATA: data/tweets.json okunamadı (önce fetch_tweets.py çalıştırın).');
    process.exit(1);
  }
  if (!Array.isArray(tweets) || tweets.length === 0) {
    console.log('Tweet yok — çıkış.');
    return;
  }
  if (!DRY_RUN && (!url || !key)) {
    console.error('HATA: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY eksik (önizleme için DRY_RUN=1).');
    process.exit(1);
  }
  const sb: SupabaseClient | null = DRY_RUN ? null : createClient(url as string, key as string, {
    auth: { persistSession: false },
  });

  const DEFAULT_HANDLE = '@sevketozhan';
  let skipped = 0;

  // ---------------- 1) PARSE (saf, DB'siz) ----------------
  const inserts: PredictionRow[] = [];
  const bCandidates: { fund: string; date: string; actual: number; sourceTweetId: string }[] = [];
  const tweetSourceIds: string[] = [];

  for (const t of tweets) {
    if (!t || !t.id || !t.text) { skipped++; continue; }
    const all = parseAllSocialTweets(t.text);
    if (all.length === 0) {
      // Tekli parse dene (legacy "TLY %0.5" gibi # olmadan)
      const p = parseSocialTweet(t.text);
      if (!p.fundCode || !KNOWN_SYMBOLS.includes(p.fundCode)) { skipped++; continue; }
      if (p.value === null) {
        // Gerçekten sayı yoksa ve tek fon ise VERİ EKSİK, yoksa atla (Açıklanmadı gibi)
        const hasAnyNumber = /\d/.test(t.text);
        if (!hasAnyNumber) { skipped++; continue; }
        const sourceTweetId = `tw-${t.id}`;
        tweetSourceIds.push(sourceTweetId);
        const date = toIsoDate(t.created_at);
        if (!date) continue;
        inserts.push({
          source_tweet_id: sourceTweetId,
          predictor_handle: p.predictorHandle ?? DEFAULT_HANDLE,
          fund_code: p.fundCode,
          prediction_category: p.category,
          raw_text: t.text,
          predicted_return_pct: null,
          prediction_date: date,
          status: 'VERI_EKSİK',
        });
        continue;
      }
      // Tek tahmin
      const sourceTweetId = `tw-${t.id}`;
      tweetSourceIds.push(sourceTweetId);
      const date = toIsoDate(t.created_at);
      if (!date) continue;
      const base = {
        source_tweet_id: sourceTweetId,
        predictor_handle: p.predictorHandle ?? DEFAULT_HANDLE,
        fund_code: p.fundCode,
        prediction_category: p.category,
        raw_text: t.text,
      };
      if (!p.hasPercentSign) {
        inserts.push({ ...base, predicted_return_pct: p.value, prediction_date: date, status: 'BEKLIYOR' });
      } else {
        bCandidates.push({ fund: p.fundCode, date, actual: p.value, sourceTweetId });
      }
      continue;
    }

    // Çoklu tahmin (örn: "#TLY 0,04 #DFI 0,23 #THF -0,34")
    const date = toIsoDate(t.created_at);
    if (!date) { skipped++; continue; }
    const baseHandle = parseSocialTweet(t.text).predictorHandle ?? DEFAULT_HANDLE;
    const baseCat = parseSocialTweet(t.text).category;
    for (let idx = 0; idx < all.length; idx++) {
      const a = all[idx];
      const sourceTweetId = `tw-${t.id}-${a.fundCode.toLowerCase()}`; // her fon için ayrı id (unique)
      tweetSourceIds.push(sourceTweetId);
      if (!a.hasPercentSign) {
        inserts.push({
          source_tweet_id: sourceTweetId,
          predictor_handle: baseHandle,
          fund_code: a.fundCode,
          prediction_category: baseCat,
          raw_text: t.text,
          predicted_return_pct: a.value,
          prediction_date: date,
          status: 'BEKLIYOR',
        });
      } else {
        bCandidates.push({ fund: a.fundCode, date, actual: a.value!, sourceTweetId });
      }
    }
  }

  // ---------------- 2) DB: dedupe + açık tahmin havuzu ----------------
  const existingIds = new Set<string>();
  const openPool = new Map<string, { sourceTweetId: string; predPct: number }[]>(); // fund|date

  if (sb) {
    const { data: existing, error: e1 } = await sb
      .from(TABLO)
      .select('source_tweet_id')
      .in('source_tweet_id', tweetSourceIds);
    if (e1) { console.error('HATA (mevcut id sorgusu):', e1.message); process.exit(1); }
    (existing ?? []).forEach((r: any) => r.source_tweet_id && existingIds.add(r.source_tweet_id));

    const funds = Array.from(new Set(inserts.map((r) => r.fund_code)));
    const dates = Array.from(new Set(inserts.map((r) => r.prediction_date)));
    if (funds.length > 0 && dates.length > 0) {
      const { data: openRows, error: e2 } = await sb
        .from(TABLO)
        .select('source_tweet_id, fund_code, prediction_date, predicted_return_pct')
        .eq('status', 'BEKLIYOR')
        .is('actual_return_pct', null)
        .in('fund_code', funds)
        .in('prediction_date', dates);
      if (e2) { console.error('HATA (açık tahminler):', e2.message); process.exit(1); }
      for (const r of openRows ?? []) {
        const k = `${r.fund_code}|${r.prediction_date}`;
        openPool.set(k, [...(openPool.get(k) ?? []), { sourceTweetId: r.source_tweet_id as string, predPct: Number(r.predicted_return_pct) }]);
      }
    }
  }

  // Bu çalıştırmanın eklediği A (tahmin) satırları da eşleşme havuzuna girer
  for (const r of inserts) {
    if (r.status === 'BEKLIYOR' && r.predicted_return_pct != null) {
      const k = `${r.fund_code}|${r.prediction_date}`;
      openPool.set(k, [...(openPool.get(k) ?? []), { sourceTweetId: r.source_tweet_id, predPct: r.predicted_return_pct }]);
    }
  }

  // ---------------- 3) FORMAT B eşleştirme ----------------
  const verifyOps: VerifyOp[] = [];
  for (const b of bCandidates) {
    if (existingIds.has(b.sourceTweetId)) continue; // zaten işlenmiş
    const k = `${b.fund}|${b.date}`;
    const pool = openPool.get(k) ?? [];
    if (AUTO_VERIFY && pool.length === 1) {
      // Tek açık tahmin → doğrula (havuzdan al: çoklu B'de ikinci ham satır olur)
      const target = pool[0];
      pool.splice(0, 1);
      verifyOps.push({
        source_tweet_id: target.sourceTweetId,
        actual: b.actual,
        acc: calculateAccuracyScore(target.predPct, b.actual),
      });
    } else {
      // Eşleşme yok / çoklu → uydurma yok: ham veri satırı
      const tweet = tweets.find((t) => `tw-${t.id}` === b.sourceTweetId);
      const p = parseSocialTweet(tweet?.text ?? '');
      inserts.push({
        source_tweet_id: b.sourceTweetId,
        predictor_handle: p.predictorHandle ?? DEFAULT_HANDLE,
        fund_code: b.fund,
        prediction_category: p.category,
        raw_text: tweet?.text ?? '',
        predicted_return_pct: b.actual,
        prediction_date: b.date,
        status: 'BEKLIYOR',
      });
    }
  }

  // ---------------- 4) YAZIM (yalnızca social_predictions) ----------------
  const fresh = inserts.filter((r) => !existingIds.has(r.source_tweet_id));

  if (DRY_RUN) {
    console.log('=== DRY_RUN (yazı YAPILMADI) ===');
    console.log('INSERT edecek satırlar:');
    console.log(JSON.stringify(fresh, null, 2));
    console.log('DOĞRULAMA (update) operasyonları:');
    console.log(JSON.stringify(verifyOps, null, 2));
  } else if (sb) {
    if (fresh.length > 0) {
      const { error: e3 } = await sb.from(TABLO).insert(fresh);
      if (e3) { console.error('HATA (insert):', e3.message); process.exit(1); }
    }
    for (const v of verifyOps) {
      const { error: e4 } = await sb
        .from(TABLO)
        .update({ actual_return_pct: v.actual, accuracy_score: v.acc, status: 'DOGRULANDI' })
        .eq('source_tweet_id', v.source_tweet_id);
      if (e4) { console.error('HATA (update):', e4.message); process.exit(1); }
    }
  }

  // Rule 2: özet yalnızca sayılar (hiçbir secret / metin içeriği yok)
  const aCount = fresh.filter((r) => r.status === 'BEKLIYOR' && r.predicted_return_pct != null).length;
  const veriEksik = fresh.filter((r) => r.status === 'VERI_EKSİK').length;
  console.log(
    `ÖZET: ${tweets.length} tweet → ${aCount} tahmin, ${verifyOps.length} doğrulama, ` +
    `${veriEksik} veri eksik, ${skipped} atlandı (finans sinyali yok).` +
    (DRY_RUN ? ' [DRY_RUN]' : ''),
  );
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
