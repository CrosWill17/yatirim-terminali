# 📈 YATIRIM TERMİNALİ v3.4 (BIST + FON + EMTİA + SUPABASE + VERCEL)

> **BIST, TEFAS Fonları, Kıymetli Madenler, Sosyal Medya Doğrulama Motoru,
> Otomatik Karar Merkezi, canlı grafikler ve işlem günlüğü içeren modern
> finansal web terminali.**

> Sürümün tek kaynağı `package.json` → `"version"`. Bu başlık onunla aynı kalır.

---

## ✨ ÖZELLİKLER

- **📡 Gerçek piyasa verisi** — `lib/marketData.ts` veri motoru: Yahoo Finance
  (USD/TRY, ons altın/gümüş, BIST hisseleri) + borsaningundemi.com (XU100, gram
  altın) + fonaly.com (TEFAS fon NAV'ları). 60 sn'de bir sunucu tarafında
  çekilir; kaynağa ulaşılamayan ortamlarda gerçek 25.08.2026 snapshot'ına düşer
  ve rozet "SON VERİ" gösterir.
- **☁️ Supabase + kullanıcı yalıtımı** — Portföy, kasa, kararlar, işlemler ve
  tahminler kalıcı. Her satır bir `user_id`'ye ait ve RLS politikaları
  `auth.uid() = user_id` ile **yalnızca sahibine** izin verir.
- **📊 Canlı grafikler** — Varlık dağılımı (donut) + pozisyon K/Z (bar), recharts ile.
- **📜 Gerçek işlem günlüğü** — Alış/satış/temettü; TEFAS satışlarında %17,5
  stopaj otomatik, gerçekleşen K/Z + kasa hareketi deftere işlenir.
- **🚨 Dinamik alarmlar** — Stop kırılımı / stopa yakınlık / hedefe ulaşma /
  sert günlük düşüş, canlı fiyatla hesaplanır.
- **📱 Sosyal doğrulama** — Server-side ayrıştırma (`/api/social-parse`),
  gerçekleşen getiri girişiyle isabet puanı ve güven skoru güncellemesi.
- **🧬 Fon içeriği** — KAP PDF'i ana kaynak (`/api/fund-holdings/parse-pdf`),
  fintables/rotaborsa otomatik sync ikincil kaynak; manuel/KAP satırları asla ezilmez.
- **🧪 Test & CI** — **192 birim test** (Vitest) + **32 RLS yalıtım testi**
  (gerçek PostgreSQL'e karşı) + GitHub Actions CI (typecheck + test + build +
  bundle sızıntı denetimi), `strict: true` TypeScript.

---

## ⚡ HIZLI BAŞLANGIÇ

### 1. Yerel çalıştırma

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 192 birim test
npm run test:db    # RLS yalıtımını gerçek PostgreSQL'e karşı doğrula
npm run typecheck  # strict tip kontrolü
npm run build      # production build
```

### 2. Supabase kurulumu (kalıcılık için)

SQL dosyaları **sırayla** çalıştırılmalı — hepsi zorunlu:

| # | Dosya | Ne yapar |
|---|---|---|
| 1 | `supabase/supabase_schema.sql` | 7 çekirdek tablo + başlangıç verisi |
| 2 | `supabase/supabase_fund_holdings_migration.sql` | `fund_holdings` + history + trigger |
| 3 | `supabase/supabase_twitter_migration.sql` | `predicted_return_pct` NULL'lanabilir + tweet id |
| 4 | `supabase/supabase_fund_proposals_migration.sql` | `fund_holding_proposals` (OCR onay kutusu) |
| 5 | `supabase/supabase_rls_user_isolation.sql` | **`user_id` + gerçek kullanıcı yalıtımı** |

> ⚠️ **5. dosyayı atlamayın.** İlk 4 dosyanın RLS politikaları
> `auth.uid() IS NOT NULL` der — yani "giriş yapmış **herhangi biri**". Site
> herkese açık olduğu için hesap açan herkes tüm portföyü okuyup silebilir.
> Yalıtımı 5. dosya sağlar.

Kurulum adımları:

1. [supabase.com](https://supabase.com)'da yeni proje oluşturun.
2. **Önce terminalden hesabınızı oluşturun** (Authentication → Email açık).
   5. dosya mevcut satırları bir kullanıcıya atar; `auth.users` boşsa
   "önce hesabınızı oluşturun" hatası vererek durur.
3. Yukarıdaki 5 SQL dosyasını **SQL Editor**'de sırayla çalıştırın.
4. `.env` dosyanızı `.env.example`'dan kopyalayıp doldurun:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://PROJE.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
5. Terminali açın → **⚙️ Ayarlar & DB** sekmesinden giriş yapın.
   İlk girişte yerleşik portföy `/api/seed` üzerinden (oturum doğrulanarak) aktarılır.

Doğrulama — SQL Editor'de:
```sql
SELECT tablename, policyname, qual FROM pg_policies WHERE schemaname='public';
```
Her satırda `((auth.uid() = user_id))` görünmeli; `IS NOT NULL` **görünmemeli**.

### 3. Vercel deploy

1. Repo'yu GitHub'a itin, [vercel.com](https://vercel.com) üzerinden import edin.
2. Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Deploy. CI (`.github/workflows/ci.yml`) yeşil olmadan merge etmeyin —
   kırmızı build Vercel'de de kırılır.

### 4. GitHub Actions secrets (sync job'ları için)

> ⚠️ **Workflow dosyaları elle uygulanmalı.** Bu ortamın GitHub App'i
> `workflows` izni taşımadığı için `.github/workflows/*` push edilemiyor.
> Gerekli üç değişikliğin tam içeriği: **`docs/WORKFLOW_ELLE_UYGULAMA.md`**.
> `SUPABASE_OWNER_USER_ID` secret'ını RLS migrasyonunu çalıştırmadan ÖNCE
> ekleyin, yoksa üç sync job'ı da durur.

Settings → Secrets and variables → Actions:

| Secret | Ne |
|---|---|
| `SUPABASE_URL` | Proje URL'i |
| `SUPABASE_SERVICE_ROLE_KEY` | **RLS'i atlar.** Yalnızca Actions'ta; uygulamada asla. |
| `SUPABASE_OWNER_USER_ID` | Satırların sahibi — `auth.users.id` (UUID) |
| `TWITTER_AUTH_TOKEN`, `TWITTER_CT0` | twitter.com oturum çerezleri |

`SUPABASE_OWNER_USER_ID` neden zorunlu: `user_id` NOT NULL ve service_role
bağlamında `auth.uid()` NULL. Job'lar satırları kimin adına yazdığını açıkça
bilmek zorunda — yoksa insert `null value in column "user_id"` ile reddedilir.

---

## 🔐 UÇ NOKTALAR VE YETKİ

| Uç | Yetki | Neden |
|---|---|---|
| `GET /api/market/public` | **Açık** | Misafir ekranı; yalnızca kamuya açık enstrümanlar |
| `GET /api/market` | Oturum | Portföy kodlarını döndürür |
| `GET /api/market/quotes` | Oturum + hız sınırı | Sunucudan Yahoo/fonaly'ye çıkar |
| `GET /api/seed` | Oturum | Yerleşik portföy |
| `GET /api/asset-meta` | Oturum | Kod→ad eşlemesi portföyü ele verir |
| `POST /api/social-parse` | Oturum + hız sınırı | — |
| `GET /api/fund-holdings/fetch` | Oturum | — |
| `POST /api/fund-holdings/parse-pdf` | Oturum | PDF parse (max 10 MB) |

Hız sınırı bellek içi ve **instance başınadır** (serverless'ta kesin sınır
değil). Ayrıntı: `lib/rateLimit.ts` başlığı.

---

## 📂 PROJE DİZİNİ

```
yatirim-terminali/
├── app/
│   ├── layout.tsx                 # Root layout, Bloomberg Dark teması
│   ├── page.tsx                   # Sekmeli ana terminal arayüzü
│   └── api/                       # Yukarıdaki uç noktalar
├── components/                    # FundContentTab, GuestMarketView, LoginPanel, …
├── lib/
│   ├── calculations.ts            # Finansal formüller, stopaj, doğrulama motoru
│   ├── marketData.ts              # Canlı veri motoru (Yahoo + BNG + fonaly + seed)
│   ├── repo.ts                    # Supabase veri erişim katmanı (WriteResult sözleşmesi)
│   ├── rateLimit.ts               # Bellek içi hız sınırı (saf, test edilebilir)
│   ├── parseSocial.ts             # Tweet ayrıştırıcı — UI ve Actions aynı modül
│   ├── kapPdfParser.ts            # KAP PDF → fon içeriği
│   ├── serverSeed.ts              # ⛔ SUNUCU-ÖZEL: yerleşik portföy
│   └── *.test.ts                  # Birim testler
├── scripts/
│   ├── dbtest/rls-check.mjs       # RLS yalıtımını gerçek PostgreSQL'de doğrular
│   ├── fund_holdings/sync.ts      # Actions: fon içeriği sync
│   └── twitter_sync/              # Actions: tweet + OCR
├── supabase/                      # 5 SQL dosyası (yukarıdaki sırayla)
├── .github/workflows/
│   ├── ci.yml                     # typecheck + test + build + bundle denetimi + RLS
│   ├── fund-holdings-sync.yml
│   └── twitter-sync.yml
└── docs/
    ├── ARIZA_BULGULAR_RAPORU.md
    ├── KOD_INCELEME_2026-09-03.md # Bağımsız kod incelemesi (kanıtlı bulgular)
    ├── YOL_HARITASI.md
    └── VERCEL_GITHUB_SUPABASE_KURULUM_REHBERI.md
```

---

## 🛡️ GÜVENLİK

- **Kullanıcı yalıtımı:** her tabloda `user_id UUID NOT NULL DEFAULT auth.uid()`,
  politikalar `auth.uid() = user_id`. Tekil kısıtlar kullanıcı bazlı bileşik
  (`user_id, symbol` vb.) → iki kullanıcı aynı sembolü tutabilir.
  Doğrulama: `npm run test:db` (32 senaryo, gerçek PostgreSQL).
- **Seed izolasyonu:** yerleşik portföy (adet/maliyet/nakit) `lib/serverSeed.ts`
  içinde sunucu-özel durur ve client bundle'a **girmez**. CI her build'de
  `.next/static/chunks/` içinde bu değerleri arar.
- **`service_role`** anahtarı uygulamada hiçbir yerde kullanılmaz; yalnızca
  Actions sync job'larında. RLS'i atladığı için o job'lar her sorguyu
  `.eq('user_id', OWNER_ID)` ile daraltır.
- **`pdf-parse` `1.1.1` olarak tam pinli** ve kök değil iç modül
  (`pdf-parse/lib/pdf-parse.js`) import edilir. Gerekçe: paket kökündeki
  `if (!module.parent)` debug bloğu, webpack `module.parent` set etmediği için
  Next.js server bundle'ında ENOENT fırlatır. Ayrıntı: route içindeki yorum.

### Bilinen açık

Next.js `14.2.35` EOL'dür ve `npm audit` **2 high** raporlar (next, postcss).
CI'da `npm audit` uyarı olarak koşar (`continue-on-error`), deploy'u kırmaz.
Kapatmak için planlı major yükseltme gerekir — bkz. `docs/YOL_HARITASI.md` FAZ 6.
