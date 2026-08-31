# Yatırım Terminali — Baştan Sona Tarama Raporu

Tarih: 2026-08-31
Kapsam: `CrosWill17/yatirim-terminali` @ `arena/01a056b8-yatirim-terminali`

## Yapılan kontroller

| Kontrol | Sonuç |
|---|---|
| `npm install` | ✅ Başarılı (2 high severity npm vulnerability raporlandı) |
| `npm test` (Vitest) | ✅ 10 dosya / 168 test geçti |
| `npm run typecheck` (`tsc --noEmit`) | ✅ Geçti |
| `npm run build` (`next build`) | ✅ Geçti, statik/dinamik route'lar üretildi |
| `npm run lint` (`next lint`) | ⚠️ ESLint yapılandırılmadığı için interaktif kurulum ekranı açıyor, CI'da kullanılamaz |
| `npm audit` | 🔴 2 high severity açık (Next.js 14.2.35 + içindeki postcss) |

Not: Aşağıda "kritik/hata" olarak işaretlenenler genelde kod yapısı, güvenlik ve
veri doğruluğuyle ilgilidir; testler bu hataları yakalamıyor çünkü testler mevcut
mantığı doğruluyor, gerçek akışı/seyi test etmiyor.

---

## 🔴 P0 — Önce çözülmesi gerekenler

### 1. RLS "kullanıcı yalıtımı" yok — herhangi bir kullanıcı herkese ait veriyi okuyup yazabilir

- **Dosya:** `supabase/supabase_schema.sql` (satır 126–132), `supabase/supabase_fund_holdings_migration.sql` (satır 82–84)
- **Sorun:** Tüm tablolarda policy şu şekilde:
  ```sql
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL)
  ```
  Ama hiçbir tabloda `user_id` / `owner_id` sütunu yok. Bu, "oturum açmış herhangi biri"
  anlamına gelir; "bu satırlar bu kullanıcıya ait mi" kontrolü **yok**.
- **Sonuç:** İki farklı hesap açıldığında ikisi de aynı `portfolio_positions`,
  `cash_ledger`, `transactions`, `execution_decisions`, `social_predictions`,
  `fund_holdings` verilerini görür ve üzerine yazabilir. Bu, projenin
  "Portföyünüz yalnızca size gösterilir" iddiasını geçersiz kılar.
  `app_settings.initial_capital` dahil global değerler de herhangi bir kullanıcı tarafından değiştirilebilir.
- **Öneri:** Her tabloya `user_id UUID REFERENCES auth.users(id)` ekleyin; tüm
  repository yazmalarına `user_id` taşıyın; policy'leri `auth.uid() = user_id`
  biçimine çevirin. Kişisel/tek kullanıcılık senaryoda bile RLS'in bu şekilde
  olması gerekir.

### 2. Girişli kullanıcı canlı piyasa verisini hiç alamıyor (`/api/market` 401)

- **Dosya:** `app/page.tsx` satır 156 ve 989
- **Sorun:** İstemci `/api/market` adresini **Authorization header olmadan** çağırıyor:
  ```js
  fetch('/api/market')
  ```
  Ama `app/api/market/route.ts` `getUserFromRequest(req)` ile Bearer token'ı zorunlu tutuyor
  (`Authorization: Bearer <access_token>`).
- **Sonuç:** Giriş yapmış kullanıcı için `/api/market` her seferinde 401 döner;
  `market` state hep `PUBLIC_SEED_MARKET`'te kalır. Üst bardaki "CANLI" rozeti
  hiç yanmaz, portföy tablosundaki güncel fiyatlar seed fiyatına/`unit_cost`'a düşer,
  "CANLI ANALİZİ GÜNCELLE" butonu da çalışmaz.
- **Öneri:** İstemci `/api/market` çağrılarına Supabase `access_token`'ını ekleyin
  (asset-meta/seed çağrılarında zaten yapıldığı gibi). `/api/market` için daha da
  iyisi: token'ı state'te tutup `Authorization` header'ı vermek.

### 3. `npm audit`: 2 high severity açık

- **Dosya:** `package.json` → `next: 14.2.35`
- **Sorun:** `npm audit`, Next.js 14.2.35 ve içindeki postcss için yüksek öncelikli
  güvenlik açıkları bildiriyor (DoS, XSS, cache poisoning, SSRF yolu, request
  smuggling vb.). Düzeltme `next@16.3.3` major yükseltmesi gerektiriyor.
- **Sonuç:** Herkese açık Vercel ortamında riskli.
- **Öneri:** Next.js major yükseltmesini ayrı bir iş olarak planlayın; bu bir
  breaking change olduğu için önce localized branch'te test etmek gerekiyor.

---

## 🟠 P1 — İşlevsel / veri doğruluğu hataları

### 4. "CANLI" rozeti yanıltıcı olabilir (`source: 'live'` karışık veriyle)

- **Dosya:** `lib/marketData.ts` satır 345 civarı
- **Sorun:** `live.okCount > 0` ise tüm snapshot `source: 'live'` olarak işaretleniyor,
  ama `positions` içinde canlı gelmeyen kodlar `base.positions` (seed) değerleriyle
  dolduruluyor:
  ```js
  const positions = { ...base.positions };
  for (const [code, q] of Object.entries(live.positions)) positions[code] = q;
  ```
- **Sonuç:** Birkaç kaynak başarılı olup birkaçı başarısız olursa, karışık
  **seed + canlı** veri "CANLI" olarak gösterilir. Kullanıcı hangi fiyatın
  bugün/hangisinin 25.08.2026 olduğunu bilemez.
- **Öneri:** `MarketQuote`'a `source` alanı ekleyin (veya `positions` için ayrı
  `live/seed` belirleyin); ya da yalnızca istenen kritik verilerin tamamı canlıysa
  `source: 'live'` işaretleyin.

### 5. Güven skoru kalıcı değil, her kullanıcıya ortak ve yenilemede sıfırlanıyor

- **Dosya:** `app/page.tsx` satır 78 (`useState(78.5)`), satır 632 (`setTrustScore`)
- **Sorun:** Doğrulama sonrası `trustScore` sadece React state'inde güncelleniyor.
  Veritabanına yazılmıyor. Sayfa yenilendiğinde tekrar `78.5`'e döner; ayrıca
  birden fazla kullanıcı varsa hepsi aynı skoru görür (RLS ile paylaşılan global durum).
- **Öneri:** `social_predictions`/`app_settings` üzerinde `user_id` bazlı bir
  `trust_score` satırı tutun; state'i oradan yükleyin.

### 6. `updatePrediction` yanlış kayıtları toplu güncelleyebilir

- **Dosya:** `lib/repo.ts` satır 336–345
- **Sorun:** UI ile oluşturulan tahminlerin `id`'si `Date.now()` tabanlı (UUID değil).
  Bu yüzden `updatePrediction`, `eq('raw_text', ...).eq('fund_code', ...)` fallback'ine gidiyor.
  `.update()` üzerinde birden fazla satır aynı `raw_text` + `fund_code` ile eşleşirse
  **hepsi** doğrulanmış olur.
- **Öneri:** UI oluştururken gerçek UUID üretin (veya `created_at` + `id` gibi kesin
  benzersiz bir kimlik kullanın); fallback'e mümkünse girmeyin.

### 7. `/api/social-parse` "BILINMEYEN" tahminleri kaydediyor

- **Dosya:** `app/api/social-parse/route.ts` satır 24; `app/page.tsx` `handleParseTweet`
- **Sorun:** `parseSocialTweet` kod bulamazken `fundCode = null` döner, ama API
  `parsed.fundCode ?? 'BILINMEYEN'` yapıyor. UI bu değeri alıp DB'ye
  `fund_code = 'BILINMEYEN'` olarak tahmin yazıyor.
- **Sonuç:** "0.45%" gibi kod içermeyen metinler veritabanını kirletir; tahmin
  motoru bu satırları gerçek fon tahmini gibi gösterir.
- **Öneri:** `fundCode` null ise API ya `success: false` ya da `predictionAllowed: false`
  döndürsün; UI yalnızca gerçek fon kodu bulunanları kaydetsin.

### 8. `twitter-sync` Format B eşleşmezse "gerçekleşen" veriyi "tahmin" olarak yazıyor

- **Dosya:** `scripts/twitter_sync/sync.ts` satır 189–200
- **Sorun:** Format B (yüzde işaretli, gerçekleşen) için tek açık tahmin bulunamazsa
  şu satır ekleniyor:
  ```js
  predicted_return_pct: b.actual,
  status: 'BEKLIYOR',
  ```
  Yani "gerçekleşen getiri" verisi `predicted_return_pct` olarak ve "bekleyen tahmin"
  olarak kaydediliyor. Bu hem anlam olarak yanlış hem de sonraki doğrulamayı bozar.
- **Öneri:** Eşleşme yoksa bu satırı `status='GECERSIZ'` / `VERI_EKSIK` olarak
  işaretleyin; `actual_return_pct`'i `predicted_return_pct`'e kopyalamayın.

---

## 🟡 P2 — Orta öncelik

### 9. Çıkış yapınca hassas/kişisel state temizlenmiyor

- **Dosya:** `app/page.tsx` `handleSignedOut` (satır 666 civarı)
- **Sorun:** `setPositions([])`, `setDecisions([])` vb temizleniyor ama
  `setAssetMeta({})`, `setTrustScore(78.5)`, `setMarket(PUBLIC_SEED_MARKET)`
  yapılmıyor. Aynı tarayıcıda ikinci bir kullanıcı giriş yaparsa, asset-meta/piyasa
  verisi gelene kadar önceki kullanıcının `assetMeta` (hangi 8 varlık olduğu) ve
  market fiyatları anlık olarak görünebilir; `trustScore` de korunur.
- **Öneri:** `handleSignedOut` içinde tüm kişisel derived state'i sıfırlayın.

### 10. `app_settings` / `portfolio_snapshots` yükleme hataları sessizce yutuluyor

- **Dosya:** `lib/repo.ts` satır 120–122, 230–231
- **Sorun:** `loadAll` içinde `balRes` ve `setRes` hataları `core` listesinde kontrol
  edilmiyor. Örneğin `app_settings` tablosu yoksa `setRes.error` görmezden gelinip
  `initialCapital = null` ile devam ediliyor; UI "0" gösteriyor. Bu, P0'daki
  "sessiz yutma yasak" ilkesini ihlal ediyor.
- **Öneri:** `app_settings` ve `portfolio_snapshots` okuma hatalarını da
  `loadAll`'a yayın (en azından warn + UI ipucu).

### 11. Dokümantasyon "service_role kullanılmıyor" diyor ama işler kullanıyor

- **Dosya:** `.env.example`, `docs/VERCEL_GITHUB_SUPABASE_KURULUM_REHBERI.md`
  (service_role "kesinlikle kullanılmaz" diyor) vs `scripts/fund_holdings/sync.ts` ve
  `scripts/twitter_sync/sync.ts` (GitHub Actions'ta `SUPABASE_SERVICE_ROLE_KEY`
  kullanıyor).
- **Sonuç:** Kullanıcı kafası karışabilir; service_role'un nerede, neden kullanıldığı
  açıkça yazılmamış. Frontend'de/Vercel'de kesinlikle yok, ancak CI scriptlerinde var.
- **Öneri:** Dokümantasyonu güncelleyin: "service_role yalnızca GitHub Actions
  admin scriptlerinde kullanılır, asla Vercel/frontend ortamında kullanılmaz."

### 12. `supabase_twitter_migration.sql` çalıştırılmadan `VERI_EKSİK` kayıtları patlar

- **Dosya:** `supabase/supabase_schema.sql` (`predicted_return_pct NUMERIC NOT NULL`)
  vs `supabase/supabase_twitter_migration.sql` ("DROPS NOT NULL")
- **Sonuç:** README'nin hızlı kurulumu yalnızca `supabase_schema.sql`'i söylüyor;
  bu migration çalıştırılmadıysa `predicted_return_pct = NULL` (VERI_EKSİK)
  kaydı reddedilir. Kurulum akışında üç migration'ın da zorunlu olduğu net değil.
- **Öneri:** Tek tek "zorunlu migration" listesi ve doğrulama adımı ekleyin; ya da
  ana şemada `predicted_return_pct`'in `NULL`'a izin vermesini sağlayın.

### 13. README sürüm adları tutarsız ve "CI workflow repo içinde" iddiası doğru değil

- **Dosya:** `README.md` ("GitHub Actions CI (typecheck + test + build)",
  dizin ağacında `.github/workflows/ci.yml`), `.github/workflows/` (sadece 2 workflow)
  ve `docs/GITHUB_ACTIONS_CI.md` (ci.yml manuel eklenecek diyor)
- **Sonuç:** README'de CI'nin hazır olduğu izlenimi var; gerçekte `.github/workflows/ci.yml`
  depoda yok. Ayrıca üst barda `v3.3`, README'de `v3.1`, `package.json`'da `3.0.0`.
- **Öneri:** README'yi güncelleyin veya CI workflow'unu gerçekten ekleyin; sürümü tek
  kaynaktan yönetin.

### 14. `npm run lint` çalışmıyor

- **Dosya:** `package.json` → `"lint": "next lint"`
- **Sorun:** ESLint/eslint-config paketleri ve `.eslintrc` yok. `next lint`
  interaktif "How would you like to configure ESLint?" sorusu açar; CI'da takılır.
- **Öneri:** ESLint yapılandırmasını ekleyin ya da bu script'i kaldırın.

### 15. Sosyal ayırıcıda gereksiz/tutarsız `@sevketozhan` fallback

- **Dosya:** `app/api/social-parse/route.ts` satır 18–19
- **Sorun:** `handle || parsed.predictorHandle || (parsed.fundCode ? '@sevketozhan' : '@sevketozhan')`
  ternary'nin iki dalı da aynı; kod tespit edilmemiş olsa bile tahminci `@sevketozhan` yazılıyor.
- **Öneri:** Kod bulunamadıysa `predictorHandle`'ı `null` bırakın veya açıkça
  `'@sevketozhan'` olduğunda tek yazın.

---

## 🔵 P3 — Küçük / yapısal

### 16. `is_active` alanı DB'de yok, her zaman `true` yükleniyor

- **Dosya:** `lib/types.ts` (`Position.is_active`), `lib/repo.ts` (`is_active: true`),
  `supabase/supabase_schema.sql` (sütun yok)
- **Sonuç:** Pozisyon "kapalı" kavramı gerçekte desteklenmiyor; `KAPANDI` yalnızca
  `current_action` metni olarak var.

### 17. `loadAll` açılışta `fund_holdings` migration yoksa "bağlı" gibi görünüyor

- **Dosya:** `lib/repo.ts` (`fund_holdings` hatalarını console'a yazıp geçiyor)
- **Sonuç:** DB "connected" görünür, fon içeriği yok; kullanıcıya açık bir uyarı
  verilmiyor. (README'de migration uyarısı var, ama runtime'da banner yok.)

### 18. `publicWatchlist.test.ts`'de 'SA-RARA' yazım hatası

- **Dosya:** `lib/publicWatchlist.test.ts`
- **Sonuç:** Test `'SA-RARA'` arıyor; doğrusu `'SA-RA'`. Bu yüzden bu kontrol
  gerçekte tam olarak doğrulamıyor.

### 19. `monthEndOfLabel` regex'inde `aralık` iki kez listelenmiş

- **Dosya:** `lib/fundHoldings.ts`
- **Sonuç:** Çalışmayı etkilemiyor ama kopyala-yapıştır artığı.

### 20. Geçici/otomatik günlük snapshot bir kez alınıyor

- **Dosya:** `app/page.tsx` `snapshotSavedRef`
- **Sonuç:** Oturum içinde işlem/pozisyon değişse bile tek snapshot var; işlem
  sonrası güncel snapshot oluşmuyor.

### 21. `fetchBorsaningundemiTickers` yüzde işareti ayrıştırmada Unicode eksiğini tanımıyor

- **Dosya:** `lib/marketData.ts` (borsaningundemi parser)
- **Sonuç:** Sayfada Unicode eksi (U+2212) kullanılırsa negatif `%` değişimi
  `null` düşebilir; fonaly parser'da bu zaten ele alınmış.

---

## Önerilen yol haritası (karar için)

1. **Önce P0'ları çözün:** RLS user-isolation şeması + repository `user_id`
   akışı; `/api/market` tokenlı çağrı; Next.js güvenlik yükseltme planı.
2. **P1'i sırayla ele alın:** canlı/seed kaynak işaretlemesi, trust score
   kalıcılığı, `updatePrediction` kimliği, `BILINMEYEN`/Format-B kayıt mantığı.
3. **P2'leri temizleyin:** çıkışta state sıfırlama, `loadAll` hata kontrolü,
   dokümantasyon ve lint yapılandırması.
4. **Testleri güçlendirin:** mevcut 168 test mantığı doğruluyor; gerçek
   `/api/*` akışı ve RLS davranışı için entegrasyon testleri ekleyin.
