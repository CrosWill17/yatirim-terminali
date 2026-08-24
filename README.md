# 📈 YATIRIM TERMİNALİ v3.0 (BIST + FON + EMTİA + SUPABASE + VERCEL)

> **BIST, TEFAS Fonları, Kıymetli Madenler, Sosyal Medya Doğrulama Motoru ve Otomatik Karar Merkezi içeren modern finansal web terminali.**

---

## ⚡ HIZLI BAŞLANGIÇ

### 1. Supabase Kurulumu
1. [supabase.com](https://supabase.com)'da yeni bir proje oluşturun.
2. `supabase/supabase_schema.sql` dosyasındaki SQL sorgusunu **Supabase SQL Editor**'e yapıştırıp çalıştırın.
3. API anahtarlarınızı alın (`Project Settings` -> `API`).

### 2. GitHub & Vercel Deploy
```bash
git init
git add .
git commit -m "feat: Yatirim Terminali v3.0 initial release"
git remote add origin https://github.com/KULLANICI_ADINIZ/yatirim-terminali.git
git push -u origin main
```
4. [vercel.com](https://vercel.com)'da GitHub reponuzu import edin ve çevre değişkenlerini ekleyin:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. **Deploy** butonuna basın!

---

## 📂 PROJE DİZİNİ
```
yatirim-terminali/
├── app/
│   ├── layout.tsx             # Root layout ve Bloomberg Dark teması
│   ├── page.tsx               # 8 Sekmeli Ana Terminal Arayüzü
│   ├── globals.css            # Tailwind stilleri
│   └── api/
│       ├── market/route.ts    # Canlı BIST/Döviz/Emtia API
│       └── social-parse/route.ts # Tweet regex ve tahmin ayrıştırıcı
├── lib/
│   ├── calculations.ts        # Finansal formüller, stopaj & doğrulama motoru
│   ├── supabase.ts            # Supabase bağlantısı
│   └── types.ts               # TypeScript veri tipleri
├── supabase/
│   └── supabase_schema.sql    # PostgreSQL Tabloları & Başlangıç Portföy Verileri
└── docs/
    ├── PROMPT_FOR_DEVELOPER_AI.md            # AI Kodlayıcı Geliştirici Promptu
    └── VERCEL_GITHUB_SUPABASE_KURULUM_REHBERI.md # Adım Adım Kurulum Rehberi
```
