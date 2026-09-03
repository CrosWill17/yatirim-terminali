# Kod İncelemesi — 03.09.2026

İncelenen commit: `c0d611a` ("feat: KAP PDF ana kaynak, onay yok, ham veri")
Branch: `arena/01a0664c-yatirim-terminali`

Bu rapordaki **her sayı ve her iddia bu ortamda çalıştırılan bir komutun çıktısıdır**.
Doğrulanamayan maddeler açıkça "DOĞRULANMADI" olarak işaretlenmiştir.

---

## 0. Çalıştırılan kontroller (ham sonuç)

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx vitest run` | ✅ **172 passed** (11 dosya) |
| `npx next build` | ❌ **BAŞARISIZ** → `Module not found: Can't resolve 'pdf-parse'` |
| `npm run lint` | ❌ ESLint config yok → interaktif prompt açılıyor, CI'da kilitlenir |
| `npm audit` | ⚠️ **2 high** (next 14.2.35, postcss ≤8.5.22) |
| `curl /api/market` (token'sız) | ✅ HTTP 401 |
| `curl /api/asset-meta` (token'sız) | ✅ HTTP 401 |
| `curl /api/market/quotes?symbols=THYAO,TLY` (token'sız) | ⚠️ **HTTP 200** |
| `curl -X POST /api/social-parse` (token'sız) | ⚠️ **HTTP 200** |

> Not: `npm test` ilk koşuda "171 passed | 1 skipped" verdi. Atlanan test
> `seedIsolation.test.ts` içindeki bundle taramasıydı (`it.skipIf(!hasBuild)`);
> `next build` çalıştırılınca o test de devreye girdi ve 172'ye çıktı.

---

## 1. İYİ YANLAR

1. **Hata sözleşmesi gerçekten kurulmuş.** `lib/repo.ts` supabase-js'in
   `{ data, error }` desenini `WriteResult`'a sarıyor; `classifySupabaseError`
   RLS / not_found / network ayrımı yapıyor. Sessiz yutma yok. Bu, bu tip
   projelerde en çok atlanan şey ve burada doğru yapılmış.
2. **Test kültürü var ve testler anlamlı.** 172 test; `repo.test.ts` (37),
   `fundHoldings.test.ts` (23), `ui.test.ts` (18) gerçek davranış doğruluyor,
   sadece satır kapsamı doldurmuyor.
3. **"Uydurma veri yok" ilkesi koda işlemiş.** `MarketQuote.changePct: number | null`,
   `predicted_return_pct: number | null`, `PUBLIC_PRECIOUS.verified: false` +
   arayüzde "VERİ EKSİK". Finans uygulamasında en doğru tasarım kararı bu.
4. **Seed izolasyonu çalışıyor (kısmen).** Bundle taramasıyla doğrulandı:
   `BURCE / MASFN / SARAE / EKIM` → **0 chunk**'ta geçiyor.
   `3938 / 24197 / 10400 / 6493 / 678000 / 257706` → **0 chunk**'ta geçiyor.
   Yani adet/maliyet/nakit gerçekten sunucuda kalıyor.
5. **Kaynak katmanlı + tazelik kontrollü.** `fetchYahooQuote` içinde
   `regularMarketTime > 42h → reddet` kontrolü, donmuş `^XU100` feed'ini yakalıyor.
   `fetchBorsaningundemiTickers`'ta sanity aralığı (XU100: 3.000–300.000) var.
   HTML scrape eden kodda bu savunma genellikle unutulur.
6. **`inFlight` promise cache** ile thundering herd engellenmiş (`getMarketData`,
   `getPublicMarketData`, `getStockQuotes`, `getFundQuotes`).
7. **Parser'lar saf fon.** `parseSocial`, `kapPdfParser`, `fundHoldings`'in
   side-effect'i yok → test edilebilir ve hem UI hem GitHub Actions aynı
   modülü kullanıyor (tek kaynak).
8. **Workflow'lar dikkatli yazılmış:** `permissions: contents: read`,
   `concurrency` grubu, `timeout-minutes`, `if: always()` teşhis adımı.
9. **Dokümantasyon dürüst.** `docs/ARIZA_BULGULAR_RAPORU.md` ve
   `YOL_HARITASI.md` kendi açıklarını listeliyor; `WORKFLOW_SURUM_PINLERI.md`
   "doğrulanmadı" diye açıkça yazıyor. Bu olgunluk nadir.

---

## 2. SORUNLAR

### 🔴 P0-1 — Build kırık (DÜZELTİLDİ)

`app/api/fund-holdings/parse-pdf/route.ts` `pdf-parse` import ediyordu ama
paket `package.json`'da **yoktu**. `next build` şu hatayla ölüyordu:

```
./app/api/fund-holdings/parse-pdf/route.ts
Module not found: Can't resolve 'pdf-parse'
```

Yani **Vercel deploy'u da bu commit'te başarısız olur.** CI olmadığı için
kimse fark etmemiş (bkz. P1-1).

### 🔴 P0-2 — `pdf-parse` paket kökü Next.js'te patlıyor (DÜZELTİLDİ)

Paketi eklemek yetmiyordu. `pdf-parse@1.1.1`'in `index.js`'i:

```js
module.exports = Pdf;
let isDebugMode = !module.parent;
if (isDebugMode) {
  let PDF_FILE = './test/data/05-versions-space.pdf';
  let dataBuffer = Fs.readFileSync(PDF_FILE);   // ← senkron, fırlatır
```

Next.js server bundle'ından çıkarılan webpack runtime'ı:

```js
t.nmd = e => (e.paths = [], e.children || (e.children = []), e)
```

`nmd` **`parent` alanını set etmiyor** → `!module.parent === true` → debug
bloğu çalışıyor → `ENOENT`. Birebir doğrulandı:

```
module.parent = null | !module.parent = true
SONUÇ: YÜKLEME SIRASINDA PATLADI -> ENOENT |
  ENOENT: no such file or directory, open './test/data/05-versions-space.pdf'
```

Yani build yeşile dönse bile **uç her çağrıda 500 dönecekti.**
Çözüm: iç modül (`pdf-parse/lib/pdf-parse.js`) — debug bloğu içermiyor
(`grep -c "05-versions-space"` → **0**), `typeof: function` olarak temiz yükleniyor.

> **DOĞRULANMADI:** Gerçek bir KAP PDF'i üzerinde uçtan uca metin çıkarımı.
> Elle ürettiğim test PDF'leri pdf.js'in xref doğrulamasını geçemedi
> ("bad XRef entry"), sandbox'tan dışarı çıkıp gerçek KAP PDF'i de indiremedim.
> `lib/kapPdfParser.ts`'in metin→holdings mantığı zaten 3 testle kapsanıyor,
> ama `buffer → text` adımı gerçek bir PDF'le bir kez denenmeli.

### 🔴 P0-3 — RLS kullanıcı yalıtımı YOK

Tüm şemada `user_id` sütunu **hiç yok** (`grep -n "user_id" supabase/*.sql` → 0 eşleşme)
ve tüm politikalar aynı:

```sql
CREATE POLICY "Auth Portfolio" ON portfolio_positions
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
```

`auth.uid() IS NOT NULL` = "giriş yapmış **herhangi biri**". README bunu
"RLS politikaları yalnızca oturum açmış kullanıcıya izin verir" diye güvenlik
özelliği olarak sunuyor — ama bu yalıtım değil.

Üstüne `supabase_schema.sql` şunu öneriyor:

> "Kişisel terminal için 'Confirm email' KAPALI önerilir"

Yani: site Vercel'de herkese açık → herhangi biri e-posta onayı olmadan hesap
açabilir → **tüm portföyü, kasayı, işlemleri okuyup silebilir/yazabilir.**
Bu, projedeki en ciddi açık. `YOL_HARITASI.md` FAZ 1 bunu zaten işaretlemiş
ama "BAŞLAMADIK" durumunda.

> **DOĞRULANMADI:** Gerçek bir Supabase projesine karşı ikinci hesapla deneme.
> Bu ortamda `NEXT_PUBLIC_SUPABASE_URL` tanımlı değil (`isSupabaseConfigured()`
> false), o yüzden `createServerSupabase()` null dönüyor. Bulgum SQL
> metninin okunmasına dayanıyor; politika ifadesi tartışmaya yer bırakmıyor.

### 🟠 P1-1 — CI yok, README var diyor

`ls .github/workflows/` → sadece `fund-holdings-sync.yml` ve `twitter-sync.yml`.
**`ci.yml` yok.** Ama README:

```
├── .github/workflows/ci.yml     # CI: typecheck + test + build
```

ve "GitHub Actions CI (typecheck + test + build)" diye özellik listesinde.
`docs/GITHUB_ACTIONS_CI.md` bunu "GitHub App'in `workflows` izni yok, elle
ekleyin" diye açıklıyor — anlaşılır, ama README düzeltilmemiş.

**Sonuç:** P0-1 (kırık build) bu yüzden fark edilmedi. Önerilen CI içeriği
`npm run build` çalıştırıyor olsaydı ilk push'ta kırmızı yanardı.

### 🟠 P1-2 — İki uç auth'suz açık (curl ile doğrulandı)

```
GET  /api/market/quotes?symbols=THYAO,TLY   → HTTP 200
POST /api/social-parse {"text":"#TLY 0,53"} → HTTP 200
```

`/api/market` ve `/api/asset-meta` doğru şekilde 401 veriyor; bu ikisi vermiyor.

- `/api/market/quotes`: sunucunuzu **herkese açık bir fiyat proxy'si** yapıyor.
  Kod doğrulaması (`/^[A-Z0-9]{2,10}$/`) ve 60 kod limiti var → SSRF değil,
  ama rate limit yok. 5 ardışık isteğin hepsi 200 döndü. Yahoo/fonaly
  sunucunuzun IP'sini banlayabilir; bu durumda canlı veri sizin için de ölür.
- `/api/social-parse`: saf parser, zarar düşük. Ama `predictorHandle`
  fallback'i `'@sevketozhan'` olarak **yanıtta sızıyor** ve auth'suz.

### 🟠 P1-3 — Fon kodları client bundle'da; kendi yorumuyla çelişiyor

`lib/fundCodes.ts` başlığı: *"Bu dosya portföy bileşimini ELE VERMEZ"*.
Ama `app/page.tsx` (`'use client'`) bu modülü import ediyor. Bundle taraması:

```
TLY -> 1 chunk dosyasında geçiyor
DFI -> 1 chunk dosyasında geçiyor
THF -> 1 chunk dosyasında geçiyor
KGM -> 1 chunk dosyasında geçiyor
TP2 -> 1 chunk dosyasında geçiyor
```

Aynı dosyada `lib/publicWatchlist.ts` bu kodları `FORBIDDEN_FOR_GUEST` içinde
"misafire asla gösterilmez" diye listeliyor. İki dosya birbirini yalanlıyor.

Karar sizin: bu kodlar zaten halka açık TEFAS kodlarıysa sorun yok, ama o
zaman yorum ve `FORBIDDEN_FOR_GUEST` düzeltilmeli. Gizliyse `fundCodes.ts`
sunucu-özel olmalı.

Ayrıca `FORBIDDEN_FOR_GUEST` listesinde **`THF` eksik** — `ASSET_META`'da var,
seed'de yok ama portföye sonradan eklenebilir.

Ve `seedIsolation.test.ts`'in bundle testi yalnızca **sayısal** marker arıyor;
kod adlarını aramadığı için bu sızıntıyı **yakalamıyor**.

### 🟠 P1-4 — `social_predictions` şema/kod çelişkisi (kurulum sırası tuzağı)

`supabase_schema.sql`:
```sql
predicted_return_pct NUMERIC(8, 4) NOT NULL,
```
`lib/types.ts`:
```ts
predicted_return_pct: number | null;
```
`lib/repo.ts` `insertPrediction` bu alanı `null` gönderebiliyor
(VERİ_EKSİK satırları) → `23502 not-null violation`.

Düzeltme yalnızca `supabase_twitter_migration.sql`'de:
```sql
ALTER TABLE social_predictions ALTER COLUMN predicted_return_pct DROP NOT NULL;
```

README kurulumda **sadece** `supabase_schema.sql`'i çalıştırmayı söylüyor; üç
migration'ın zorunlu olduğu hiçbir yerde yazmıyor. Yeni kurulumda "tweet
ekle" ilk denemede patlar. `YOL_HARITASI.md` FAZ 5 bunu zaten not etmiş.

### 🟡 P2 — Diğer bulgular

| # | Bulgu | Kanıt |
|---|---|---|
| P2-1 | `npm run lint` çalışmıyor — ESLint config yok, `next lint` interaktif prompt açıyor | `ls -a \| grep -i eslint` → boş |
| P2-2 | Next.js 14.2.35 EOL, **2 high** açık | `npm audit` |
| P2-3 | `Position.is_active` DB'de yok, `repo.ts`'te hep `true` hardcoded | `loadAll` → `is_active: true` |
| P2-4 | `trustScore` başlangıcı **uydurma 78.5** ve DB'ye yazılmıyor — "uydurma yok" ilkesiyle çelişiyor | `useState(78.5)` |
| P2-5 | Optimistic state + rollback yok: `handleAddTransaction` state'i güncelliyor, `track()` başarısız olsa bile geri almıyor | `app/page.tsx` |
| P2-6 | `assetMeta` senkron `useEffect`'i `track()`'i atlayarak sessiz DB yazması yapıyor — repo.ts'in "sessiz yutma yok" kuralını ihlal ediyor | `void upsertPosition(...)` |
| P2-7 | `handleApplyDecision` her uygulamada kasa defterine `amount: 0` satır yazıyor; `cashBalance` da `cash_ledger`'dan son `balance_after` ile hesaplanıyor → defter kirleniyor | `app/page.tsx` |
| P2-8 | `updatePrediction` UUID yoksa `raw_text + fund_code` ile eşleştiriyor → birden fazla satırı güncelleyebilir | `lib/repo.ts` |
| P2-9 | `app/page.tsx` **1760 satır** tek dosya; en kritik 4 akış (`handleAddTransaction`, `handleApplyDecision`, `handleParseTweet`, `handleVerifyPrediction`) component içinde → birim test edilemiyor | `wc -l` |
| P2-10 | `.env.example` "SERVICE_ROLE_KEY bu projede KULLANILMAZ" diyor; iki workflow da `secrets.SUPABASE_SERVICE_ROLE_KEY` kullanıyor | `grep` |
| P2-11 | `lib/serverSeed.ts` yorumu `lib/serverSeedGuard.test.ts`'e atıf yapıyor — o dosya yok, gerçek dosya `seedIsolation.test.ts` | `ls lib/` |
| P2-12 | README "20 unit test" diyor → gerçek **172** | `vitest run` |
| P2-13 | Sürüm kimliği dağınık: `package.json` `3.0.0`, README `v3.1`, migration'lar `v3.2`/`v3.4` | `grep` |
| P2-14 | `twitter-sync` **her 30 dk**'da bir çalışıyor ve her koşuda `apt-get install tesseract` + `pip install` + `npm ci` yapıyor | `cron: '*/30 * * * *'` |
| P2-15 | Modül-seviyesi cache serverless'ta instance başına; her instance Yahoo/fonaly'yi ayrı scrape eder → ban riski | `let cache` (module scope) |
| P2-16 | `NUMERIC(18,4)` sütunlar 6 ondalıklı TEFAS NAV'larını kesiyor (THF seed'i `2.724426` → DB `2.7244`) | `supabase_schema.sql` |

---

## 3. BU TURDA YAPILAN DEĞİŞİKLİK

```
 app/api/fund-holdings/parse-pdf/route.ts | 11 +++++++++-
 package-lock.json                        | 35 ++++++++++++++++++++++++++++++++
 package.json                             |  1 +
```

1. `pdf-parse` **1.1.1** tam pin olarak `dependencies`'e eklendi.
2. Import `pdf-parse` → `pdf-parse/lib/pdf-parse.js` olarak değiştirildi ve
   gerekçesi yorumla belgelendi (webpack `nmd` / `module.parent` tuzağı).

### Değişiklik sonrası doğrulama

| Komut | Sonuç |
|---|---|
| `npx tsc --noEmit` | ✅ exit 0 |
| `npx vitest run` | ✅ **172 passed** (bundle testi dahil, artık skip değil) |
| `npx next build` | ✅ `Compiled successfully` — 10 route üretildi |
| `grep -rl "05-versions-space" .next/server/` | ✅ **0 dosya** (debug bloğu bundle'dan çıktı) |

**Çalıştırılan kod yolu:** `next build`, `app/api/fund-holdings/parse-pdf/route.ts`
içindeki `await import('pdf-parse/lib/pdf-parse.js')` satırını derleyip
`.next/server/chunks/262.js` + `643.js` içine pdfjs olarak yerleştirdi; aynı
build daha önce `Can't resolve 'pdf-parse'` ile ölüyordu. `vitest`'in
`seedIsolation.test.ts > derlenmiş bundle kontrolü` testi de bu build'in
çıktısını taradı ve geçti.

---

## 4. KARAR BEKLEYENLER (önerilen sıra)

| Öncelik | İş | Neden şimdi |
|---|---|---|
| 1 | **`user_id` + gerçek RLS** (`auth.uid() = user_id`) | Tek açık kapı. Şema değişiyor, o yüzden ayrı branch/migration |
| 2 | **CI workflow'u ekle** (typecheck + test + build) | Bir daha kırık build main'e girmesin |
| 3 | `/api/market/quotes` + `/api/social-parse`'a auth veya rate limit | Yahoo ban riski |
| 4 | README'yi gerçeğe çek (ci.yml, 172 test, zorunlu migration'lar, service_role) | 10 dk iş, güven kaybettiriyor |
| 5 | `fundCodes.ts` kararı: gizli mi, halka açık mı? | Yorum/kod çelişkisi + test kör noktası |
| 6 | ESLint config + `npm run lint`'i CI'a bağla | Şu an komut çalışmıyor |
| 7 | `app/page.tsx`'i böl, kritik akışları saf fonksiyona çıkar | Test edilebilirlik |
| 8 | Next.js 14 → güncel sürüm | 2 high açık |

---

## 5. GÜNCELLEME — 03.09.2026 (aynı gün, inceleme sonrası)

Rapor teslim edildikten sonra ilk 4 madde sırayla uygulandı.

| # | Madde | Durum | Kanıt |
|---|---|---|---|
| P0-1 | Kırık build (`pdf-parse`) | ✅ | `next build` → `Compiled successfully` |
| P0-2 | `pdf-parse` debug-mode ENOENT | ✅ | `grep -rl "05-versions-space" .next/server/` → **0 dosya** |
| P0-3 | RLS kullanıcı yalıtımı | ✅ | `npm run test:db` → **32 geçti, 0 kaldı** |
| P1-1 | CI yok | ✅ | `.github/workflows/ci.yml` (2 job), YAML parse OK |
| P1-2 | Auth'suz iki uç | ✅ | `curl` → ikisi de **HTTP 401** (önce 200'dü) |
| P1-4 | `predicted_return_pct` kurulum tuzağı | ✅ | README'de 5 SQL dosyası sırayla + şema başlığında uyarı |
| P2-10 | `service_role` doküman çelişkisi | ✅ | `.env.example` + README |
| P2-13 | Sürüm dağınıklığı | ✅ | `package.json` `3.4.0` = README v3.4 |

### RLS doğrulaması nasıl yapıldı

SQL metnine bakarak değil, **gerçek PostgreSQL'e karşı** koşularak.
`scripts/dbtest/rls-check.mjs` (`npm run test:db`) `embedded-postgres` ile
geçici bir cluster ayağa kaldırır, Supabase'in `auth` şemasını + `auth.uid()`
fonksiyonunu + `anon`/`authenticated`/`service_role` rollerini taklit eder ve
iki farklı kullanıcıyla 32 senaryo dener.

Bu harness **iki gerçek hatayı yakaladı**:

1. Migration **"İDİMPOTENT" diye yazıyordu ama değildi** — 2. koşuda
   `policy "Owner Portfolio" ... already exists` ile patlıyordu.
   `DROP POLICY IF EXISTS` + koşullu `ADD PRIMARY KEY` ile düzeltildi.
2. İlk yazılan hata mesajı gerçek kurulum senaryosunu karşılamıyordu:
   `supabase_schema.sql` 8 satır seed INSERT ediyor ama `auth.users` boşsa
   backfill'in atayacağı kimse yok. Mesaj artık "önce hesabınızı oluşturun" diyor.

### Yeni test varlıkları

| Dosya | İçerik |
|---|---|
| `scripts/dbtest/rls-check.mjs` | 32 senaryo, gerçek PostgreSQL |
| `lib/rateLimit.test.ts` | 14 test — sliding window, saat enjeksiyonlu |
| `lib/repo.test.ts` (genişletildi) | 7 yeni test — tüm `onConflict` hedefleri kilitli |

### Hâlâ açık olanlar

| # | Madde | Not |
|---|---|---|
| P1-3 | `fundCodes.ts` — fon kodları client bundle'da | **Karar bekliyor:** bu kodlar gizli mi, halka açık TEFAS kodları mı? Yorum ve `FORBIDDEN_FOR_GUEST` şu an gerçeği söylemiyor |
| P2-1 | ESLint config yok, `npm run lint` çalışmıyor | FAZ 5'te |
| P2-2 | Next.js 14.2.35 EOL, 2 high açık | Major yükseltme, ayrı branch |
| P2-3..P2-9, P2-11, P2-12, P2-14..P2-16 | Diğer P2 bulgular | `docs/YOL_HARITASI.md` FAZ 2–7 |
