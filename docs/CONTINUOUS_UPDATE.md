# Sürekli Güncelleme — Fon İçeriği Mimari

## Sorun
KAP PDF en değerli doğru veri (resmi, denetlenmiş) ama:
- TLY haftalık, THF aylık yayınlanır
- Fon yöneticisi günlük alım/satım yapar → KAP PDF 1 gün sonra bayatlar
- Eski sistem 45 gün boyunca auto kaynakları tamamen blokluyordu → günlük trade'ler kaçıyordu

## Çözüm: 3 Katmanlı Sürekli Güncelleme

### 1. KAP PDF — Ana Kaynak (kap-pdf-sync)
- **Ne**: KAP Portföy Dağılım Raporu PDF'leri (resmi)
- **Sıklık**: Günlük 05:00 UTC (08:00 TRT) — `kap-pdf-sync.yml`
- **Araç**: `kap_pdf_fetch.py` (kap-client ile KAP API'den çek) + `kap_pdf_upsert.ts` (parse + Supabase)
- **Source**: `kap-pdf` — ham veri, onay yok, manuel gibi korunur
- **Tazelik**: TLY 7 gün (haftalık), THF 30 gün (aylık), diğer 45 gün
- **Fallback**: Otomatik çekme başarısız olursa kullanıcı manuel PDF yükler (`/api/fund-holdings/parse-pdf`)

### 2. Auto Kaynaklar — Günlük Trade Takibi (fund-holdings-sync)
- **Ne**: fintables.com + rotaborsa.com hisse dağılımları
- **Sıklık**: Günlük 06:00 UTC (09:00 TRT) + 15:00 UTC (18:00 TRT) — borsa kapanış sonrası
- **Mantık**:
  - KAP PDF taze ise (age ≤ eşik): kap-pdf ticker'ları korunur, auto sadece yeni ticker ekler
  - KAP PDF bayat ise (age > eşik): kap-pdf ticker'ları auto overwrite edebilir, satılanlar silinebilir
  - Manuel + calibration ASLA ezilmez/silinmez
- **Source**: `auto` / `fintables` / `rotaborsa`

### 3. Twitter Foto OCR — Anlık Öneri (twitter-sync)
- **Ne**: @sevketozhan günlük etki fotoğraflarından OCR ile ağırlık tahmini
- **Sıklık**: Her 30 dakikada
- **Akış**: Foto → OCR → `fund_holding_proposals` (pending) → UI onay kutusu → manuel onayla `fund_holdings` (source=manual)
- **Otomatik yazım YOK** — sadece öneri

## Koruma Matrisi

| Source | Taze KAP varken | Bayat KAP | Manuel |
|--------|----------------|-----------|--------|
| manual | korunur | korunur | — |
| calibration | korunur | korunur | — |
| kap-pdf | korunur (taze) | overwrite izni (bayat) | — |
| auto | sadece yeni ticker | overwrite + silme | — |

## UI Göstergeleri (FundContentTab)
- `KAP PDF TAZE 2g` — yeşil, resmi veri güncel
- `KAP PDF BAYAT 12g >7g → auto devrede` — amber, günlük trade takibi aktif
- `AUTO GÜNLÜK` — sky, sadece auto kaynak var
- Kaynak rozetleri: kap-pdf (emerald), manual (amber), calibration (violet), auto (sky)

## Workflow'lar

### fund-holdings-sync.yml
```yaml
cron: 0 6 * * *  # 09:00 TRT
cron: 0 15 * * * # 18:00 TRT
```
- fintables + rotaborsa → parse → Supabase fund_holdings (auto)
- Tazelik eşikli koruma

### kap-pdf-sync.yml (YENİ)
```yaml
cron: 0 5 * * *  # 08:00 TRT
```
- kap-client ile KAP'tan son 30 gün Portföy Dağılım Raporlarını çek
- Java serialization wrapper çöz
- data/kap_pdfs/ → pdf-parse → kapPdfParser → Supabase (kap-pdf)

### twitter-sync.yml
```yaml
cron: */30 * * * *
```
- Tweet çek + foto OCR → proposals

## Veri Akışı Örneği (TLY)

1. **31 Ağustos**: KAP PDF yayınlanır (TLY Ağustos 2026)
   - kap-pdf-sync indirir → 44 hisse %84.05 FTD → fund_holdings source=kap-pdf
   - UI: `KAP PDF TAZE 0g`

2. **1 Eylül**: Yönetici OZATD satar, yeni hisse alır
   - fund-holdings-sync (09:00) fintables'tan yeni dağılımı çeker
   - OZATD kap-pdf korumalı olduğu için (taze) overwrite edilmez → eski ağırlık kalır
   - Ama yeni hisse auto olarak eklenir
   - UI: `KAP PDF TAZE 1g` + auto ticker'lar

3. **8 Eylül**: KAP PDF 8 gün oldu → bayat
   - fund-holdings-sync: kap-pdf artık korunmaz, auto OZATD'yi güncel ağırlıkla overwrite eder, satılanlar silinir
   - UI: `KAP PDF BAYAT 8g >7g → auto devrede`

4. **9 Eylül**: Yeni KAP PDF (Eylül haftalık) yayınlanır
   - kap-pdf-sync indirir → yeni resmi veri → fund_holdings overwrite (kap-pdf taze olur)
   - UI: `KAP PDF TAZE 0g`

## Manuel Müdahale

- KAP auto-fetch başarısız olursa: UI'dan PDF yükle → `/api/fund-holdings/parse-pdf` → önizleme → Kaydet (source=kap-pdf)
- Acil düzeltme: Manuel satır ekle (source=manual) — asla ezilmez

## Gelecek İyileştirmeler

- KAP API rate limit ve WAF için retry + backoff
- PDF parse için OCR fallback (taranmış PDF)
- Fiyat değişimlerinden ağırlık tahmini (nominal sabit varsayımı)
- Telegram/Discord bildirimi: KAP PDF bayatlayınca uyar
