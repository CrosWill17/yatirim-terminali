# YATIRIM TERMİNALİ — AI İnceleme Paketi
> Bu dosya başka bir yapay zekaya projeyi inceletmek için hazırlandı. GitHub bağlayamıyorsan bunu kopyala-yapıştır yapman yeterli.

**Tarih:** 2026-09-02
**Repo:** CrosWill17/yatirim-terminali
**Branch:** arena/01a05b8f-yatirim-terminali (son: 5dcdb43)
**Amaç:** Fon içeriği sürekli güncelleme (KAP PDF + günlük auto + Twitter OCR)

---

## 1. Hızlı Özet (AI'a verilecek ilk paragraf)

Next.js 14.2.35 EXACT (CVE fix), React 18, TS strict, Tailwind, recharts, vitest, Supabase (auth RLS). 
BIST + TEFAS fonları (TLY, THF, DFI vs) + emtia + sosyal doğrulama. 
Fon içeriği 3 katman: 
- KAP PDF (en doğru resmi, TLY haftalık 7g, THF aylık 30g) → kap-pdf-sync günlük 05:00 UTC, kap-client ile KAP API'den çek, Java wrapper çöz, pdf-parse → Supabase source=kap-pdf
- Auto (fintables/rotaborsa) → fund-holdings-sync günlük 06:00 + 15:00 UTC, tazelik eşikli koruma (taze iken kap-pdf korunur, bayatlayınca auto overwrite)
- Twitter foto OCR → twitter-sync 30dk, proposals pending → manuel onay → manual

Ana kural: tek yazı hedefi fund_holdings, manual/calibration asla ezilmez, kap-pdf taze iken korunur bayatlayınca auto devralır.

Son veri: TLY 44 hisse %84.05 FTD (225B TL), THF 78 hisse %99.23 FTD (74B TL) Ağustos 2026 KAP PDF, SQL dosyası hazır.

---

## 2. Teknoloji Yığını

```json
{
  "next": "14.2.35 EXACT",
  "react": "18.3.1",
  "typescript": "5.7.3 strict",
  "supabase-js": "2.48.1",
  "recharts": "3.10.1",
  "pdf-parse": "1.1.1",
  "kap-client": "1.2.0 (Python, KAP API)",
  "vitest": "4.1.11",
  "node": "22 (GitHub Actions)"
}
```

Env: NEXT_PUBLIC_SUPABASE_URL + ANON_KEY (service_role ASLA frontend'e yok, sadece Actions secret)

---

## 3. Dosya Ağacı (önemli olanlar)

```
.github/workflows/
  fund-holdings-sync.yml  # günlük 06:00 + 15:00 UTC
  kap-pdf-sync.yml        # günlük 05:00 UTC (YENİ)
  twitter-sync.yml        # 30dk
app/
  page.tsx                # 8 sekmeli ana terminal
  api/fund-holdings/parse-pdf/route.ts  # PDF upload → parse → önizleme (yazmaz)
lib/
  types.ts                # source union: auto|manual|kap-pdf|fintables|rotaborsa|calibration
  fundHoldings.ts         # parse + tahmin matematiği, HoldingRow
  kapPdfParser.ts         # KAP PDF metin → holdings (GRUP %)
  repo.ts                 # Supabase repo, upsertFundHoldingKapPdf vs
  fundCodes.ts
components/
  FundContentTab.tsx      # tazelik badge, 3 katman açıklaması
scripts/fund_holdings/
  sync.ts                 # fintables/rotaborsa → Supabase, tazelik eşikli
  kap_pdf_fetch.py        # KAP API → data/kap_pdfs/
  kap_pdf_upsert.ts       # PDF → Supabase kap-pdf
scripts/twitter_sync/
  fetch_tweets.py, ocr_holdings.py, sync.ts
supabase/
  supabase_schema.sql
  supabase_fund_holdings_migration.sql
  fund_holdings_TLY_THF_2026_08_kap_pdf.sql  # 122 upsert, 2026-08-31
docs/
  CONTINUOUS_UPDATE.md    # sürekli güncelleme mimari
```

---

## 4. Kritik Kodlar (kopyala)

### lib/types.ts — source union
```ts
export type FundHoldingSource = 'auto'|'manual'|'kap-pdf'|'fintables'|'rotaborsa'|'calibration';
export interface FundHoldingRow {
  id: string;
  fund_code: string;
  ticker: string;
  company_name: string|null;
  weight_pct: number;
  as_of_date: string;
  source: FundHoldingSource;
  notes: string|null;
}
```

### lib/fundHoldings.ts — HoldingRow
```ts
export interface HoldingRow {
  fund_code: string;
  ticker: string;
  company_name: string | null;
  weight_pct: number;
  as_of_date: string;
  source: 'auto' | 'manual' | 'kap-pdf' | 'calibration' | 'fintables' | 'rotaborsa';
  notes: string | null;
}
export const MIN_IMPACT_PCT = 0.01;
```

### scripts/fund_holdings/sync.ts — tazelik eşikli koruma (özet)
```ts
const KAP_FRESH_DAYS: Record<string, number> = { TLY: 7, THF: 30 };
const DEFAULT_FRESH = 45;

const kapRows = existing.filter(e => e.source === 'kap-pdf');
let latestKapDate = max(kapRows.map(e => new Date(e.as_of_date)));
const kapAgeDays = (now - latestKapDate)/86400000;
const isKapFresh = kapAgeDays <= (KAP_FRESH_DAYS[fundCode] ?? 45);

protectedTickers = manual + calibration + (kap-pdf if isKapFresh)
autoRows = rows.filter(r => !protectedTickers.has(r.ticker))

stale = existing.filter(e => !protectedTickers.has(e.ticker) && !keepSet.has(e.ticker))
// taze iken kap-pdf korunur, bayatlayınca auto overwrite + silme
```

### .github/workflows/fund-holdings-sync.yml
```yaml
on:
  schedule:
    - cron: '0 6 * * *'   # 09:00 TRT
    - cron: '0 15 * * *'  # 18:00 TRT
```

### .github/workflows/kap-pdf-sync.yml (YENİ)
```yaml
on:
  schedule:
    - cron: '0 5 * * *'  # 08:00 TRT
jobs:
  sync:
    steps:
      - pip install kap-client httpx
      - python scripts/fund_holdings/kap_pdf_fetch.py
      - npx tsx scripts/fund_holdings/kap_pdf_upsert.ts
```

### scripts/fund_holdings/kap_pdf_fetch.py — özet
```py
from kap_client import Kap, FundGroup, FundSubject
with Kap() as kap:
  funds = kap.fetch_funds(FundGroup.YATIRIM_FONLARI)
  fund = next(f for f in funds if f.code == "TLY")
  disclosures = kap.fetch_fund_disclosures_by_filter(
    fund_oid=fund.oid,
    subject_oid=FundSubject.PORTFOY_DAGILIM_RAPORU.value,
    days=30
  )
  attachments = kap.fetch_attachments(latest.index)
  # download /tr/api/file/download/{objId} + Java AC ED unwrap
```

---

## 5. Supabase Şema (özet)

```sql
-- fund_holdings
CREATE TABLE fund_holdings (
  id uuid primary key default gen_random_uuid(),
  fund_code text not null,
  ticker text not null,
  company_name text,
  weight_pct numeric not null,
  as_of_date date not null,
  source text not null check (source in ('auto','manual','kap-pdf','calibration','fintables','rotaborsa')),
  notes text,
  updated_at timestamptz default now(),
  unique(fund_code, ticker)
);

-- fund_holding_proposals (Twitter OCR)
CREATE TABLE fund_holding_proposals (
  id uuid primary key,
  fund_code text, ticker text, weight_pct numeric,
  prev_weight_pct numeric, source_tweet_id text,
  predictor_handle text, raw_text text,
  detected_at timestamptz, status text -- pending|approved|rejected
);
```

---

## 6. Mevcut Sorun / İstek

Kullanıcı diyor: "Bu kaynak şu anki en değerli doğru veri ama fon yöneticisi hergün alım satım yapabilir yani her gün anlık değişebilir o yüzden sürekli güncellemeye ihtiyaç duyuyoruz"

Çözüm yapıldı: 3 katman + tazelik eşik. Şimdi başka bir AI'ın projeyi incelemesi isteniyor ama GitHub bağlanamıyor.

---

## 7. Başka AI'a Nasıl Verilir? (4 Yöntem)

### Yöntem A — Tek Dosya Paket (EN KOLAY, önerilen)
Bu dosyayı (`docs/AI_REVIEW_PACKAGE.md`) + aşağıdaki ek dosyaları kopyala-yapıştır:

1. Bu dosyanın tamamını
2. `docs/CONTINUOUS_UPDATE.md` içeriğini
3. `lib/types.ts`, `lib/fundHoldings.ts`, `scripts/fund_holdings/sync.ts` içeriğini
4. `package.json`

Diğer AI'a de ki: "Bu proje Next.js 14.2.35 EXACT, Supabase, KAP PDF ana kaynak. Dosyaları incele ve ..."

Token limiti varsa: sadece bu dosya yeterli, içinde özet var.

### Yöntem B — Zip / Tarball (GitHub bağlayamıyorsan)
```bash
# Repo kökünde
git archive --format=zip --output=/tmp/yatirim-terminali.zip arena/01a05b8f-yatirim-terminali
# veya
zip -r /tmp/yatirim.zip . -x "node_modules/*" ".git/*" ".next/*" "dist/*"
```
Sonra zip'i Google Drive / file.io / wetransfer ile paylaş, AI'a link ver (bazı AI'lar zip okuyabilir) veya AI'ın dosya yükleme varsa oraya yükle.

### Yöntem C — Repomix (tek dosyalık kod dump, AI'lar için ideal)
```bash
npm i -g repomix
repomix --include "lib/**,app/**,components/**,scripts/**,.github/**,supabase/*.sql,docs/*.md,package.json"
# repomix-output.txt oluşur (~200-400KB), onu AI'a yükle
```
Repomix tüm kodu tek txt'e birleştirir, AI'lar bunu çok iyi anlar.

### Yöntem D — GitHub Geçici Public Fork
Eğer repo private ise:
1. GitHub → New repo → public → `yatirim-terminali-review`
2. `git remote add review https://github.com/SEN/review.git && git push review arena/01a05b8f-yatirim-terminali:main --force`
3. AI'a public link ver: `https://github.com/SEN/yatirim-terminali-review`
4. İnceleme bitince repo'yu sil

### Yöntem E — Gist ile kritik dosyalar
```bash
gh gist create lib/types.ts lib/fundHoldings.ts scripts/fund_holdings/sync.ts docs/CONTINUOUS_UPDATE.md --public
# çıkan gist linkini AI'a ver
```

---

## 8. Güvenlik Uyarısı

ASLA paylaşma:
- `.env`, `.env.local`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public olsa bile başka AI'a verme, sadece URL yeterli)
- `TWITTER_AUTH_TOKEN`, `TWITTER_CT0`

Paylaşırken `.env.example` kullan:
```
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[REDACTED]
```

---

## 9. AI'a Sorulacak Örnek Prompt

```
Bu proje BIST yatırım terminali, Next.js 14.2.35 EXACT. 
Fon içeriği için KAP PDF ana kaynak ama yönetici günlük trade yapıyor, 
bu yüzden sürekli güncelleme mimarisi kurduk (kap-pdf-sync günlük + fund-holdings-sync günlük 2x + twitter-sync 30dk).

Dosyaları incele:
- Tasarım doğru mu? Tazelik eşik mantığı (TLY 7g, THF 30g) mantıklı mı?
- KAP PDF auto fetch (kap-client) Java wrapper çözümü güvenli mi?
- fund_holdings tablosunda kap-pdf bayatlayınca auto overwrite izni riskli mi?
- Daha iyi ne yapılabilir? Öner.

Kodlar ekte.
```

---

## 10. Ek: Tüm Workflow Dosyaları

### fund-holdings-sync.yml
```
name: fund-holdings-sync
on:
  schedule:
    - cron: '0 6 * * *'
    - cron: '0 15 * * *'
  workflow_dispatch: {}
...
```

### kap-pdf-sync.yml
```
name: kap-pdf-sync
on:
  schedule:
    - cron: '0 5 * * *'
...
```

---

Bu paket hazır. Başka AI'a bu dosyayı yükle veya kopyala-yapıştır yap.
