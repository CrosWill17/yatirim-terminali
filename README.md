# 📈 YATIRIM TERMİNALİ v3.4 (BIST + FON + EMTİA + SUPABASE + VERCEL)

> **BIST, TEFAS Fonları, Kıymetli Madenler, Sosyal Medya Doğrulama Motoru, Otomatik Karar Merkezi, canlı grafikler ve işlem günlüğü içeren modern finansal web terminali.**

---

## ✨ ÖZELLİKLER (v3.4)

- **📡 Gerçek piyasa verisi** — `lib/marketData.ts` veri motoru: Yahoo Finance (BIST 100, USD/TRY, ons altın/gümüş, BIST hisseleri) + fonaly.com (TEFAS fon NAV'ları). 60 sn'de bir sunucu tarafında çekilir; kaynağa ulaşılamayan ortamlarda gerçek 25.08.2026 snapshot'ına düşer ve rozet "SON VERİ" gösterir.
- **☁️ Supabase entegrasyonu (auth tabanlı)** — Portföy, kasa, kararlar, işlemler ve tahminler kalıcı. RLS politikaları yalnızca oturum açmış kullanıcıya izin verir. İlk girişte yerleşik portföy otomatik aktarılır.
- **📊 Canlı grafikler** — Varlık dağılımı (donut) + pozisyon K/Z (bar), recharts ile.
- **📜 Gerçek işlem günlüğü** — Alış/satış/temettü; TEFAS satışlarında %17,5 stopaj otomatik, gerçekleşen K/Z + kasa hareketi deftere işlenir. Yeni kodla otomatik pozisyon açma.
- **🚨 Dinamik alarmlar** — Stop kırılımı / stopa yakınlık / hedefe ulaşma / sert günlük düşüş, canlı fiyatla hesaplanır.
- **🚀 Gerçek UYGULA akışı** — Karar uygulanınca stop/hedef pozisyona işlenir, kasa defterine kayıt atılır, DB'ye kalıcı yazılır.
- **📱 Sosyal doğrulama** — Server-side ayrıştırma (`/api/social-parse`), gerçekleşen getiri girişiyle isabet puanı ve güven skoru güncellemesi.
- **🧪 Test & CI** — Hesap motoru için 20 unit test (Vitest), GitHub Actions CI (typecheck + test + build), `strict: true` TypeScript.

---

## ⚡ HIZLI BAŞLANGIÇ

### 1. Yerel Çalıştırma
```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit testler
npm run typecheck  # strict tip kontrolü
```

### 2. Supabase Kurulumu (kalıcılık için)
1. [supabase.com](https://supabase.com)'da yeni bir proje oluşturun.
2. SQL Editor'de sırasıyla şu dosyaları çalıştırın (hepsi idempotent):
   - `supabase/supabase_schema.sql` (ana tablolar + kullanıcı yalıtımlı RLS)
   - `supabase/supabase_twitter_migration.sql`
   - `supabase/supabase_fund_holdings_migration.sql`
   - `supabase/supabase_fund_proposals_migration.sql`
3. Authentication → Email'i açın (kişisel kullanım için "Confirm email"i kapatmanızı öneririz).
4. API anahtarlarınızı `.env` dosyasına yazın:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://PROJE.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
5. Terminali açın → **⚙️ Ayarlar & DB** sekmesinden giriş yapın (veya hesap oluşturun). İlk girişte portföyünüz DB'ye aktarılır.

> ⚠️ **Eski (v2) kurulumdan yükseltiyorsanız:** `supabase/supabase_user_isolation_migration.sql`
> dosyasındaki 3 adımı (sütun ekle → backfill → kısıt/politika) sırayla çalıştırın.
> Bu migration, RLS'i "herhangi bir oturum açmış kullanıcı" yerine "yalnızca sizin
> kullanıcınız (auth.uid() = user_id)" hâline getirir.

### 3. Vercel Deploy
1. Repo'yu GitHub'a iteleyin, [vercel.com](https://vercel.com) üzerinden import edin.
2. Environment Variables olarak `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` ekleyin.
3. Deploy → tamam. Bu ortamda dışa açık internet olduğu için piyasa verisi **CANLI** moda geçer.

---

## 📂 PROJE DİZİNİ
```
yatirim-terminali/
├── app/
│   ├── layout.tsx               # Root layout ve Bloomberg Dark teması
│   ├── page.tsx                 # 8 Sekmeli Ana Terminal Arayüzü
│   ├── globals.css              # Tailwind stilleri
│   └── api/
│       ├── market/route.ts      # Canlı piyasa veri endpoint'i (60sn cache)
│       └── social-parse/route.ts # Tweet regex ve tahmin ayrıştırıcı
├── lib/
│   ├── calculations.ts          # Finansal formüller, stopaj & doğrulama motoru
│   ├── calculations.test.ts     # 20 unit test (Vitest)
│   ├── marketData.ts            # Canlı piyasa veri motoru (Yahoo + fonaly + seed fallback)
│   ├── repo.ts                  # Supabase veri erişim katmanı
│   ├── supabase.ts              # Supabase bağlantısı
│   └── types.ts                 # TypeScript veri tipleri
├── supabase/
│   └── supabase_schema.sql      # PostgreSQL tabloları + auth tabanlı RLS (v2)
├── .github/workflows/
│   ├── fund-holdings-sync.yml   # Fon içeriği otomatik sync (Actions)
│   └── twitter-sync.yml         # Tweet çekme + OCR + tahmin sync (Actions)
└── docs/
    ├── PROMPT_FOR_DEVELOPER_AI.md
    └── VERCEL_GITHUB_SUPABASE_KURULUM_REHBERI.md
```

---

## 🛡️ GÜVENLİK NOTU
- Şema v3'te tüm tablolarda `user_id` sütunu vardır ve RLS politikaları `auth.uid() = user_id` kuralını uygular: oturum açmış bir kullanıcı **yalnızca kendi** satırlarını görür/yazar; anon anahtar tek başına hiçbir veriye erişemez.
- `NEXT_PUBLIC_` prefix'li anahtarlar tarayıcıya da gönderilir — bunlar **anon** anahtarlar olsun.
- `SUPABASE_SERVICE_ROLE_KEY` yalnızca GitHub Actions'taki admin script'lerinde (fund-holdings-sync, twitter-sync) kullanılır; **asla** Vercel/frontend ortamına eklenmez. Script'ler satırları doğru kullanıcıya yazabilmek için tek kullanıcıyı otomatik çözer; çok kullanıcılı kurulumda `SUPABASE_USER_ID` secret'ı ekleyin.
