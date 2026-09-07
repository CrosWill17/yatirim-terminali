import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/supabaseServer';
import { parseKapPdfHoldings, validateKapParsed } from '@/lib/kapPdfParser';
import { toHoldingRows } from '@/lib/fundHoldings';

export const dynamic = 'force-dynamic';

/**
 * KAP PDF → fon içeriği parse
 *
 * POST /api/fund-holdings/parse-pdf
 * Body: multipart/form-data
 *   - file: PDF dosyası
 *   - fund_code: TLY (opsiyonel, default TLY)
 *
 * Auth: Bearer token zorunlu (portföy kişisel)
 *
 * Dönüş:
 *   { ok:true, code, asOfDate, reportLabel, holdings: [...], excludedCount, totalWeight }
 *   holdings: toHoldingRows formatında (fund_code,ticker,company_name,weight_pct,as_of_date,source,notes)
 *
 * Hiçbir tabloya YAZMAZ — sadece parse eder, önizleme döndürür.
 * Yazma işlemi client'ta FundContentTab üzerinden onUpsert ile yapılır (source=manual/kap-pdf).
 */

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Oturum gerekli' }, { status: 401 });
  }

  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const rawCode = (form.get('fund_code') as string | null)?.trim().toUpperCase() || 'TLY';

    if (!/^[A-Z0-9]{2,10}$/.test(rawCode)) {
      return NextResponse.json({ error: 'Geçersiz fon kodu' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'PDF dosyası gerekli (file alanı)' }, { status: 400 });
    }

    if (file.type && file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Sadece PDF kabul edilir' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF çok büyük (max 10MB)' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // pdf-parse dynamic import (ESM uyumu için)
    //
    // ÖNEMLİ: paket KÖKÜ ('pdf-parse') DEĞİL, iç modül yüklenir.
    // pdf-parse@1.1.1'in index.js'i `if (!module.parent) { ... }` debug bloğu
    // içerir ve o blok './test/data/05-versions-space.pdf' dosyasını
    // readFileSync ile okur. Webpack'in modül sarmalayıcısı (`__webpack_require__.nmd`)
    // `module.parent` alanını HİÇ set etmediği için Next.js server bundle'ında
    // `!module.parent === true` olur → modül yüklenirken ENOENT fırlar ve bu
    // uç her çağrıda 500 döner. İç modül (lib/pdf-parse.js) o bloğu içermez.
    // @ts-ignore - no types
    const mod: any = await import('pdf-parse/lib/pdf-parse.js');
    const pdfParse = (mod.default ?? mod) as any;
    const data = await pdfParse(buffer);
    const text: string = data.text || '';

    if (!text || text.trim().length < 100) {
      return NextResponse.json({ ok: false, error: 'PDF metni okunamadı (taranmış görüntü olabilir, OCR gerekli)' }, { status: 422 });
    }

    const parsed = parseKapPdfHoldings(text, rawCode);
    const v = validateKapParsed(parsed);

    if (!v.ok) {
      return NextResponse.json({
        ok: false,
        code: rawCode,
        error: v.reason,
        holdingsCount: parsed.holdings.length,
        excludedCount: parsed.excludedCount,
        asOfDate: parsed.asOfDate,
        reportLabel: parsed.reportLabel,
        previewText: text.slice(0, 2000), // debug için ilk 2k karakter
      }, { status: 422 });
    }

    const rows = toHoldingRows(parsed as any).map((r) => ({
      ...r,
      source: 'kap-pdf' as const,
      notes: `${parsed.reportLabel} | KAP PDF ${file.name} (otomatik parse)`,
    }));

    const totalWeight = rows.reduce((s, r) => s + r.weight_pct, 0);

    return NextResponse.json({
      ok: true,
      code: rawCode,
      source: 'kap-pdf',
      asOfDate: parsed.asOfDate,
      reportLabel: parsed.reportLabel,
      holdings: rows,
      excludedCount: parsed.excludedCount,
      totalWeight: Number(totalWeight.toFixed(4)),
      rowCount: rows.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `PDF parse hatası: ${msg}` }, { status: 500 });
  }
}
