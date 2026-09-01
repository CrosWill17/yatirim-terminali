import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/supabaseServer';
import { parseFintablesHoldings, parseRotaborsaHoldings, toHoldingRows, validateParsed, FUND_SOURCES } from '@/lib/fundHoldings';

export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.text();
}

/**
 * FON İÇERİĞİ OTOMATİK ARAŞTIRMA (dinamik fonlar için)
 *
 * GET /api/fund-holdings/fetch?code=TLY
 * - Oturum zorunlu (portföy kodları kişisel)
 * - fintables.com/fonlar/{CODE} dener (ikincil kaynak, resmi değilse uyarı)
 * - TLY için rotaborsa URL'i de dener (birincil)
 * - Başarılıysa holdings + asOfDate + source döner, client sonra upsertFundHoldingAuto ile yazar
 * - Çözülemezse 404 + reason
 */
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  }

  const url = new URL(req.url);
  const rawCode = (url.searchParams.get('code') ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(rawCode)) {
    return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 });
  }

  // KGM/TP2 gibi hisse içermeyen fonlar için araştırma yapma
  if (['KGM', 'TP2'].includes(rawCode)) {
    return NextResponse.json({ ok: true, code: rawCode, holdings: [], asOfDate: null, source: 'none', note: 'Bu fon hisse içermez (gümüş/PPF)' });
  }

  // Önce FUND_SOURCES'da tanımlı mı? Varsa onun URL'ini kullan
  const known = FUND_SOURCES.find((f) => f.code === rawCode);

  const tries: { kind: 'rotaborsa' | 'fintables'; url: string }[] = [];

  if (known?.url) {
    tries.push({ kind: known.kind as any, url: known.url });
  }

  // Dinamik: fintables her fon için dene (ikincil)
  tries.push({ kind: 'fintables', url: `https://fintables.com/fonlar/${rawCode}` });

  // Dinamik: rotaborsa için bilinen TLY deseni dışında genel deneme yapma (URL bilinmiyor)
  // İleride generic rotaborsa search eklenebilir

  let lastError: string | null = null;

  for (const t of tries) {
    try {
      const html = await fetchHtml(t.url);
      const parsed = t.kind === 'rotaborsa'
        ? parseRotaborsaHoldings(html, rawCode)
        : parseFintablesHoldings(html, rawCode);

      const v = validateParsed(parsed);
      if (!v.ok) {
        lastError = `${t.kind} parse doğrulaması geçmedi: ${v.reason}`;
        continue;
      }

      const rows = toHoldingRows(parsed);

      return NextResponse.json({
        ok: true,
        code: rawCode,
        source: parsed.source,
        asOfDate: parsed.asOfDate,
        reportLabel: parsed.reportLabel,
        holdings: rows.map((r) => ({
          fund_code: r.fund_code,
          ticker: r.ticker,
          company_name: r.company_name,
          weight_pct: r.weight_pct,
          as_of_date: r.as_of_date,
          notes: r.notes,
        })),
        excludedCount: parsed.excludedCount,
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    }
  }

  return NextResponse.json({ ok: false, code: rawCode, error: lastError ?? 'Kaynaklara ulaşılamadı veya parse edilemedi' }, { status: 404 });
}
