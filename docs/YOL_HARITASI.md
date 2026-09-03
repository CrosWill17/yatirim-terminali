# Yol Haritası — ARIZA BULGULARININ SIRALI ÇÖZÜMÜ

Tarih: 2026-08-31
Bağlantılı rapor: `docs/ARIZA_BULGULAR_RAPORU.md`

Amaç: Raporu "bulgu listesi"nden çıkarıp uygulanabilir iş paketlerine dönüştürmek.
Her fazın sonunda `typecheck + test + build` yeşil kalmalı.

---

## Renk / durum

- ✅ TAMAM
- 🟡 DEVAM EDİYOR (bu tur)
- ⬜ BEKLİYOR

---

## FAZ 0 — Acil çalışma hatası (P0 #2)

**🐛 Bulgu:** Girişli kullanıcı `/api/market`'i token'sız çağırdığı için 401 alıyor;
canlı veri hiç gelmiyor.

**✅ Durum:** TAMAM

**Yapılanlar:**
- `app/page.tsx`'e `accessToken` state'i eklendi; `getSession` / `onAuthStateChange`
  ile güncelleniyor.
- `/api/market` çağrılarına `Authorization: Bearer <token>` eklendi.
- "CANLI ANALİZİ GÜNCELLE" butonu da token'lı çağrı yapıyor.
- `handleSignedOut` içinde `assetMeta`, `trustScore`, `market`, `accessToken` da
  sıfırlandı (rapor #9'un bir kısmı).

**✅ Aynı fazda ek düzeltme — Supabase yoksa hata ekranı yerine çalışan açık ekran:**
- "KURULUM HATASI" tam ekranı kaldırıldı; uygulama artık Supabase env yoksa
  halka açık piyasa ekranını çalıştırıyor.
- Üst bartaki durum rozeti nötrleştirildi: `🧪 DEMO MODU` → `🔓 PUBLIC MOD`.
- Ekrandaki "Supabase bağlantısı tanımlı değil…" ambar uyarı kutusu kaldırıldı
  (kullanıcı bunu hata olarak algılıyordu).
- Giriş sekmesi Supabase yokken sessiz, hata olmayan bir bilgi gösteriyor.
- Portföy/kasa gibi kişisel veriler public modda hâlâ hiç yüklenmiyor/gösterilmiyor.

**Doğrulama:** `typecheck` ✅, `test` ✅ (168 geçti), `build` ✅.
`curl /` 200; "KURULUM HATASI / Supabase bağlantısı / DEMO MODU / Application Error"
sayfalarının hiçbiri görünmüyor.

---

## FAZ 1 — RLS / kullanıcı yalıtımı (P0 #1)

**✅ Durum: TAMAM (03.09.2026)**

**Yapılanlar:**
- `supabase/supabase_rls_user_isolation.sql` eklendi (5. zorunlu SQL dosyası):
  - 11 tabloya `user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE`
  - Politikalar `auth.uid() IS NOT NULL` → **`auth.uid() = user_id`**
  - Tekil kısıtlar kullanıcı bazlı bileşiğe çevrildi:
    `(user_id,symbol)`, `(user_id,key)`, `(user_id,snapshot_date)`,
    `(user_id,id)`, `(user_id,fund_code,ticker)`, `(user_id,cal_date,fund_code)`,
    `(user_id,fund_code,ticker,source_tweet_id)`
  - `fund_holdings_history` tetikleyicisi `user_id` taşıyor + `SECURITY DEFINER`
  - Mevcut veri tek kullanıcıya backfill edilir; **birden fazla kullanıcı varsa
    script bilerek hata verir** (kim kime ait otomatik karar vermez)
- `lib/repo.ts`: tüm `onConflict` hedefleri bileşik yapıldı, `setInitialCapital`'a
  `onConflict: 'user_id,key'` eklendi. Payload'larda `user_id` gönderilmiyor —
  DB `DEFAULT auth.uid()` dolduruyor, `WITH CHECK` başkasının id'sini reddediyor.
- `app/page.tsx`: `/api/market/quotes` ve `/api/social-parse` çağrılarına
  `Authorization: Bearer` eklendi.
- Sync job'ları (`fund_holdings/sync.ts`, `twitter_sync/sync.ts`,
  `ocr_holdings.py`): `SUPABASE_OWNER_USER_ID` zorunlu; her yazıya `user_id`,
  her okumaya `.eq('user_id', OWNER_ID)` eklendi. Sebep: `service_role` RLS'i
  atlar ve o bağlamda `auth.uid()` NULL'dır.
- İki workflow'a `SUPABASE_OWNER_USER_ID` secret'ı eklendi.
- `scripts/dbtest/rls-check.mjs` + `npm run test:db`: **38 senaryo, gerçek
  PostgreSQL'e karşı** (embedded-postgres). CI'da ayrı `rls` job'ı.
- `lib/repo.test.ts`: 7 yeni test, tüm `onConflict` hedeflerini kilitliyor.

**Karar noktası (çözüldü):** depo tek kullanıcılı kalsa bile `user_id` şarttı —
ikinci hesap açılırsa veri karışmasın diye. Çok kullanıcılı senaryo de çalışıyor
(bileşik tekil kısıtlar sayesinde).

**Doğrulama:** `npm run test:db` → **38 geçti, 0 kaldı**; `npm test` → **192 geçti**;
`typecheck` ✅; `build` ✅.

**Kalan:** `app_settings` ve `portfolio_snapshots` için ayrı şema kararı
gerekmedi — bileşik anahtar yeterli oldu.

---

## FAZ 2 — Canlı veri işaretleme ve doğrulama (P1 #4, #18)

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- `MarketQuote`'a `source`/`stale` alanı ekleme; pozisyon bazında canlı/seed ayrımı.
- Yalnızca kritik verilerin tamamı canlıysa `source:'live'` işaretleme.
- BNG parser'a Unicode eksi desteği (rapor #21).
- `publicWatchlist.test.ts`'deki `'SA-RARA'` yazım hatası (rapor #18).

---

## FAZ 3 — Sosyal doğrulama mantığı (P1 #5, #6, #7, #8, #15)

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- Güven skorunu DB'ye kalıcı yazma (kullanıcı bazlı); `trustScore` state'ini yükleme.
- `updatePrediction`'da kesin kimlik (UI tarafında UUID üretimi).
- `/api/social-parse`: kod yoksa `success:false` / `canSave:false` davranışı;
  `BILINMEYEN` kayıt yasağı; `@sevketozhan` fallback'i tekilleştirme.
- `twitter-sync` Format B fallback: `predicted_return_pct` yerine
  `status='GECERSIZ'/actual` kullanımı.

---

## FAZ 4 — Hata bildirimi ve veri tutarlılığı (P2 #10, #17, #16, #20)

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- `loadAll`'da `portfolio_snapshots` / `app_settings` hatalarını da yayma (sessiz yutma yok).
- `fund_holdings` migration eksikse runtime'da görünür uyarı (sadece console değil).
- `Position.is_active` alanının DB/tip sözleşmesini netleştirme (ya sütun ekle ya kaldır).
- Günlük snapshot'ın işlem sonrası güncellenmesi.

---

## FAZ 5 — Build / lint / dokümantasyon tutarlılığı (P2 #11, #12, #13, #14)

**🟡 Durum:** KISMEN TAMAM (03.09.2026) — yalnızca ESLint kaldı

**Kapsam:**
- ⬜ **HÂLÂ AÇIK:** ESLint yapılandırması ekleyip `npm run lint`'i çalışır yapma.
  Şu an depoda hiçbir ESLint config yok; `next lint` interaktif kurulum prompt'u
  açıyor ve CI'da kilitlenir. (`ls -a | grep eslint` → boş)
- ✅ `.github/workflows/ci.yml` eklendi (typecheck + test×2 + build + bundle denetimi + RLS job).
- ✅ Sürüm tek kaynak: `package.json` `3.4.0`, README başlığı v3.4.
- ✅ `service_role` + `SUPABASE_OWNER_USER_ID` dokümantasyonu güncellendi (.env.example, README).
- ✅ Kurulum rehberinde 5 SQL dosyasının da zorunlu olduğu netleştirildi (README + şema başlığı).

---

## FAZ 6 — Güvenlik / bağımlılık güncellemesi (P0 #3)

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- `npm audit` high severity açıklarının kapatılması.
- Next.js 14 → 16 major yükseltmesi (breaking change; ayrı branch'te derin test).
- Ya mevcut Next.js 14'ün güvenli yamasını uygula (varsa), ya planlı yükseltme.

---

## FAZ 7 — Test güçlendirme ve regresyon

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- Gerçek `/api/*` çağrılarını doğrulayan route testleri.
- RLS davranışını simüle eden entegrasyon testleri.
- `handleAddTransaction`, `handleApplyDecision`, `handleParseTweet` gibi kritik
  akışların fonksiyonlara ayrılıp birim test edilebilmesi.

---

## İlerleme tablosu

| Faz | İş | Durum |
|---|---|---|
| FAZ 0 | `/api/market` token sızıntısı/fonksiyonel hatası | ✅ |
| FAZ 1 | RLS kullanıcı yalıtımı | ✅ (03.09.2026, 38 senaryo ile doğrulandı) |
| FAZ 2 | Canlı/seed işaretleme + minor düzeltmeler | ⬜ |
| FAZ 3 | Sosyal doğrulama mantığı | ⬜ |
| FAZ 4 | Hata bildirimi / veri tutarlılığı | ⬜ |
| FAZ 5 | Lint / dokümantasyon | 🟡 dokümantasyon ✅, ESLint ⬜ |
| FAZ 6 | Güvenlik / bağımlılık | ⬜ |
| FAZ 7 | Test / regresyon | ⬜ |
