# 🚀 YATIRIM TERMİNALİ v3.0 — AI YAZILIM GELİŞTİRİCİ SİSTEM PROMPTU
> **Kullanım Amacı:** Bu promptu Cursor, Claude Code, v0, ChatGPT veya GitHub Copilot gibi bir yapay zekâ kodlayıcıya vererek; **Vercel**, **Supabase** ve **GitHub** üzerinde çalışan uçtan uca modern bir finansal yatırım terminali web uygulaması inşa ettirmek için kullanın.

---

```markdown
# MASTER PROMPT: "YATIRIM TERMİNALİ v3.0" FULL-STACK WEB UYGULAMASI GELİŞTİRME

## 🎯 GÖREV VE ROL
Sen, Bloomberg Terminal ve TradingView kalitesinde, kurumsal düzeyde finansal dashboard'lar inşa eden **Kıdemli Full-Stack Web Mimarı ve Finans Mühendisisin**.
Görevin: BIST (Borsa İstanbul), TEFAS Yatırım Fonları, Kıymetli Madenler (Altın/Gümüş), Sosyal Medya Tahmin Doğrulama Motoru ve Otomatik Karar Merkezi içeren **"Yatırım Terminali v3.0"** web uygulamasını sıfırdan eksiksiz şekilde geliştirmektir.

## 🛠️ TEKNOLOJİ YIĞINI (TECH STACK)
- **Frontend:** Next.js 14/15 (App Router), React 18/19, TypeScript, Tailwind CSS, Lucide React Icons, Shadcn UI / Radix Primitives, Recharts / TradingView Lightweight Charts.
- **Backend / Serverless:** Next.js Serverless Route Handlers (`/api/*`) veya Python FastAPI Vercel Serverless.
- **Veritabanı & Kalıcılık:** Supabase (PostgreSQL + Row Level Security + Realtime + Storage/JSON Backup).
- **Veri Kaynakları:**
  - `yfinance` (BIST hisseleri: `.IS`, Endeks: `XU100.IS`, Döviz: `USDTRY=X`, Emtia: `GC=F`, `SI=F`).
  - `fonaly.com` scraping (TEFAS fon fiyatları, günlük değişim ve 1H/1A/3A/6A/1Y getiri tabloları).
  - Sosyal Regex Parser: Tweet/metin içerisinden fon kodu (örn: TLY, DFI) ve getiri oranlarını (`%0.45`, `0.45%`) çıkaran ayrıştırıcı.
- **Dağıtım (Deployment):** Vercel (GitHub Reposu üzerinden otomatik CI/CD).

---

## 📐 SİSTEM MİMARİSİ VE 8 TEMEL MODÜL (SEKMELER)

Uygulama tek sayfa uygulama (SPA) mantığında, üstte piyasa bilgi şeridi (Ticker Bar) ve solda/üstte 8 sekmeli modern koyu tema (Dark Bloomberg Aesthetics) menüsüne sahip olmalıdır:

### 1. 📊 ANA PANEL (DASHBOARD)
- **Piyasa Ticker Bar:** Canlı BIST 100 (`XU100.IS`), Dolar/TL (`USDTRY=X`), Ons Altın (`GC=F`), Gram Altın (Hesaplama: `(Ons / 31.1035) * Dolar`), Gümüş (`SI=F`), Altın/Gümüş Rasyosu (Tarihsel referans ~80, güncel oran ~66.6 - gümüş görece pahalı sinyali), TP2 Para Piyasası Fonu.
- **Portföy Özet Kartları:** Toplam Varlık Değeri, Toplam Kâr/Zarar (TL ve %), Kullanılabilir Nakit (Kasa), Günlük Net Değişim.
- **Kritik Alarm Kartları:** 
  - Stop seviyesine %3 yaklaşan hisse/fonlar.
  - Günlük %3+ sert hareket yapan varlıklar.
  - Güven skoru %50'nin altına düşen sosyal tahminciler.
  - Güncel KAP bildirim uyarıları.

### 2. 🔍 ANALİZ MERKEZİ (AI STRATEJİ MOTORU)
- **"CANLI ANALİZİ GÜNCELLE" Butonu:** Portföyü, canlı fiyatları ve makro parametreleri okuyarak anında **5 Bölümlü Sert Analiz Raporu** üretir ve Supabase `terminal_reports` tablosuna kaydeder:
  1. **BÖLÜM 1 — NET KARAR (Sert ve Tavizsiz):** Asla yuvarlak cümle kurulmaz. Önce doğrudan aksiyon (AL/SAT/TUT/KADEMELİ ÇIK), ardından net hedef ve stop seviyesi verilir.
  2. **BÖLÜM 2 — TEMEL VE BİLANÇO DEDEKTİFİ:** F/K, FD/FAVÖK, ROE, Net Borç/FAVÖK. *Kritik Kural:* Zarar eden şirkette F/K anlamsızdır (negatif) -> PD/DD kullanılır. PD/DD > 1.5 ise pahalı uyarısı verilir.
  3. **BÖLÜM 3 — SOSYAL MEDYA FİLTRESİ:** @sevketozhan benchmark'ı ve diğer tahmincilerin iddiaları KAP verileriyle çapraz sorgulanır.
  4. **BÖLÜM 4 — FON VE EMTİA STRATEJİSİ:** Fon portföy yoğunlaşma uyarıları (Örn: TLY'deki %34 OZATD ağırlığı), yönetim ücreti ve %17.5 stopaj kesintisi hesabı.
  5. **BÖLÜM 5 — AKADEMİ NOTU:** İlgili işleme özel öğretici finansal kural (Beta katsayısı, Fibonacci düzeltmesi, Reel Getiri hesabı vb.).

### 3. 💼 PORTFÖY (PORTFOLIO TRACKING)
- **Dinamik Tablo Kolonları:** `Kod` | `Varlık Adı` | `Tür` | `Adet` | `Birim Maliyet (TL)` | `Toplam Maliyet` | `Güncel Fiyat` | `Günlük Değişim (%)` | `Toplam Değer (TL)` | `Net K/Z (TL)` | `K/Z (%)` | `Portföy Ağırlığı (%)` | `Stop Fiyatı` | `Teknik Sinyal (RSI/SMA Rozeti)` | `Aksiyonlar`.
- **Hızlı İşlem Modalı (Alış/Satış):**
  - Alışta: Kasa bakiyesini kontrol et (yetersiz bakiye engeli), yeni ortalama maliyeti hesapla, kasadan nakit düş ve `transactions` + `cash_ledger` tablolarına yaz.
  - Satışta: Pay adedini kontrol et, stopajı (%17.5 veya hisse fonunda %0) hesapla, net tutarı kasaya ekle, gerçekleşen K/Z'yi kaydet.

### 4. 📋 KARARLAR (EXECUTION HUB)
- **4 Durum Kolonu / Tablosu:**
  - `BEKLEYENLER` (İnceleme bekleyen öneriler)
  - `ONAYLANANLAR` (Uygulanmaya hazır stratejiler)
  - `UYGULANANLAR` (Portföye yansıtılmış işlemler)
  - `REDDEDİLENLER` (Reddedilen spekülatif öneriler)
- **"🚀 UYGULA" Akıllı Popup:**
  - Kararı seçince otomatik işlem modalını açar (Örn: `kr1: TLY 2/3 Çıkış` -> 7 payın 4.67 / 5 payını güncel fiyattan sat, stopajı düş, 257.706 TL nakite ekle).
  - "✅ Sistemi Otomatik Güncelle" ve "✍️ Kendim Uyguladım" seçenekleri.

### 5. 📜 GEÇMİŞ (MASTER LEDGER)
- **Ana Para ve Büyüme Takibi:** 
  - `Yatırılan Sermaye = Başlangıç Ana Para + Nakit Girişleri - Nakit Çıkışları`
  - `Toplam Portföy Net K/Z = (Mevcut Portföy Varlıkları + Kasa Nakit) - Yatırılan Sermaye`
- **İşlem Listesi:** Tarih, Varlık, İşlem Türü, Miktar, Fiyat, Stopaj, Gerçekleşen K/Z.
- **CSV / Excel İndir:** Tüm işlem geçmişini tek tıkla CSV olarak dışa aktar.

### 6. 🏦 KASA (CASH MANAGEMENT)
- **Nakit Giriş/Çıkış Modülü:** Maaş, temettü, dış para transferi, fatura/harcama çekimleri.
- **Anlık Nakit Senkronizasyonu:** Portföy alım/satımlarıyla otomatik güncellenen dinamik bakiye.
- **Kategori Dağılım Grafiği:** Nakit akış kategorileri.

### 7. 📱 SOSYAL (BENCHMARK & TAHMİN DOĞRULAMA MOTORU)
- **Tweet / Metin Yapıştırma Kutusu:** Kullanıcı sosyal medyadan (özellikle `@sevketozhan`) bir metin yapıştırdığında otomatik Regex:
  - Fon kodunu bulur (`TLY`, `DFI`, `KGM`, `THF`, `TP2` vb.).
  - Getiri beklentisini ayrıştırır (`+0.45%`, `%1.2` vb.).
- **7 Adımlı Doğrulama Algoritması:**
  1. Tahmin kaydı oluşturulur (`social_predictions`).
  2. Akşam TEFAS / fonaly gerçekleşen getiri çekilir.
  3. İsabet Skoru hesaplanır:
     - Fark < %0.05 -> 100 Puan
     - Fark < %0.10 -> 80 Puan
     - Fark < %0.20 -> 60 Puan
     - Fark < %0.50 -> 30 Puan
     - Fark >= %0.50 -> 0 Puan
  4. Yeni Güven Skoru: `Yeni Skor = (0.7 * Eski Güven Skoru) + (0.3 * İsabet Skoru)`
  5. 3 defa üst üste yanılgıda güven skoru sıfırlanır ve alarm tetiklenir.
  6. Nihai Birleştirilmiş Tahmin: `(Kendi Model Analizi * 0.6) + (@sevketozhan * 0.4)`

### 8. ⚙️ AYARLAR (SETTINGS & BACKUP)
- **Canlı Veri Kaynakları Durum Paneli:**
  - `yfinance API` (🟢 Aktif)
  - `fonaly.com Scraper` (🟢 Aktif)
  - `Supabase PostgreSQL` (🟢 Bağlı)
- **Veritabanı Yedek İndir / Yükle:** Tek tıkla tüm portföy, işlem ve karar veritabanını JSON paketi olarak indir ve geri yükle.

---

## 🗄️ SUPABASE VERİTABANI ŞEMASI
Projeyi başlatırken `supabase/supabase_schema.sql` dosyasında tanımlanan tabloları kullan:
1. `portfolio_positions`
2. `transactions`
3. `cash_ledger`
4. `execution_decisions`
5. `social_predictors` & `social_predictions`
6. `fund_holdings` & `kap_logs`
7. `market_cache`
8. `terminal_reports`

---

## 🛡️ KRİTİK FİNANSAL KURALLAR VE MANTIK
1. **Halüsinasyon Kesinlikle Yasak:** Veri çekilemiyorsa "Veri eksik" uyarısı göster, rastgele fiyat üretme.
2. **Zarar Eden Şirket Kuralı:** Net kâr negatifse F/K gösterilmez; PD/DD öne çıkarılır. PD/DD > 1.5 ise kırmızı bayrak çekilir.
3. **Tek Hisse / Fon Yoğunlaşma Limiti:** Tek bir hisse/emtiada portföyün %20'sinden fazlası varsa "Konsantrasyon Riski" uyarısı verilir (Örn: TLY'nin %34'ü OZATD).
4. **Stop-Loss Zorunluluğu:** "Fon yöneticisi korur" varsayımı yapılmaz. Her pozisyonun net bir stop fiyatı olmalıdır.
5. **Kademeli Çıkış ve Stopaj:** Fon satışlarında kâr üzerinden %17.5 stopaj maliyeti simüle edilerek kullanıcıya net getiri gösterilir.

---

## 🚀 TESLİM EDİLECEK DOSYA VE KOD YAPISI
Lütfen projeyi şu dizin yapısına tam uyumlu olarak eksiksiz kodla:
```
yatirim-terminali/
├── app/
│   ├── layout.tsx             # Root layout, koyu tema ve Font yapılandırması
│   ├── page.tsx               # 8 Sekmeli Ana Terminal Görünümü
│   └── globals.css            # Bloomberg Dark Tailwind Stilleri
├── components/
│   ├── TickerBar.tsx          # Canlı BIST/Döviz/Altın/Gümüş şeridi
│   ├── Tabs/
│   │   ├── DashboardTab.tsx   # 📊 Ana Panel
│   │   ├── AnalysisTab.tsx    # 🔍 Analiz Merkezi (5 Bölümlü Rapor)
│   │   ├── PortfolioTab.tsx   # 💼 Portföy Tablosu & İşlem Modalı
│   │   ├── DecisionsTab.tsx   # 📋 Kararlar Hub (Execution)
│   │   ├── LedgerTab.tsx      # 📜 Geçmiş & Kasa Raporu
│   │   ├── CashTab.tsx        # 🏦 Kasa Yönetimi
│   │   ├── SocialTab.tsx      # 📱 Sosyal Tahmin Doğrulama Motoru
│   │   └── SettingsTab.tsx    # ⚙️ Ayarlar & JSON Yedekleme
│   └── Modals/
│       ├── TradeModal.tsx     # Alım/Satım Modalı
│       └── DecisionModal.tsx  # Karar Uygulama Modalı
├── lib/
│   ├── supabase.ts            # Supabase Client Bağlantısı
│   ├── calculations.ts        # Finansal Formüller, Stopaj, İsabet Skoru
│   └── types.ts               # TypeScript Tipleri
├── pages/api/ (veya app/api/)
│   ├── market.ts              # yfinance & fonaly canlı fiyat çekici
│   ├── social-parse.ts        # Tweet regex & tahmin ayrıştırıcı
│   └── report.ts              # Canlı analiz raporu üretici
├── supabase/
│   └── supabase_schema.sql    # Tam SQL Şeması ve Başlangıç Verileri
├── docs/
│   └── VERCEL_KURULUM.md      # Vercel & Supabase Kurulum Rehberi
└── package.json
```
```
