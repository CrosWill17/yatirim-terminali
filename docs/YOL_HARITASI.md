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

**🟡 Durum:** BAŞLAMADIK — en yüksek öncelik, ama şema değiştirir.

**Kapsam:**
- Tüm veri tablolarına `user_id UUID REFERENCES auth.users(id)` ekleme.
- RLS politikalarını `auth.uid() = user_id` yapma.
- `repo.ts` fonksiyonlarına `user_id` taşıma (loadAll / write / upsert / insert / delete).
- `app/page.tsx`'te oturumla birlikte `user_id`'yi sorgulara/oluşturmalara ekleme.
- `app_settings` ve `portfolio_snapshots` için kullanıcı bazlı anahtar/şema kararı.
- Mevcut veriyi kullanıcıya taşıyacak migration (opsiyonel tek kullanıcı destekli).

**Karar noktası:** Bu depo tek kullanıcılı mı kalacak, yoksa gerçek çok kullanıcılı mı?
- Tek kullanıcıysa bile `user_id` şart: ileride ikinci hesap açılırsa veri karışmaz.
- Çok kullanıcılıysa ilk kurulum için herhesap kendi seed'ini almalı.

**Gerekli SQL dosyaları:**
- `supabase/supabase_schema.sql` (yeniden düzenlenmiş)
- `supabase/supabase_rls_user_isolation.sql` (yeni migration)

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

**🟡 Durum:** BAŞLAMADIK

**Kapsam:**
- ESLint yapılandırması ekleyip `npm run lint`'i çalışır yapma.
- README'deki CI workflow iddiasını gerçekle uyumlu hale getirme
  (ya `.github/workflows/ci.yml` ekle, ya README'den kaldır).
- Sürüm tek kaynak: `package.json`, README, header ("v3.1/v3.3/3.0.0" tutarsız).
- `service_role` dokümantasyonunu güncelle (yalnızca GitHub Actions admin job'larında).
- Kurulum rehberinde üç migration'ın zorunlu olduğunu netleştir.

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
| FAZ 1 | RLS kullanıcı yalıtımı | ⬜ |
| FAZ 2 | Canlı/seed işaretleme + minor düzeltmeler | ⬜ |
| FAZ 3 | Sosyal doğrulama mantığı | ⬜ |
| FAZ 4 | Hata bildirimi / veri tutarlılığı | ⬜ |
| FAZ 5 | Lint / dokümantasyon | ⬜ |
| FAZ 6 | Güvenlik / bağımlılık | ⬜ |
| FAZ 7 | Test / regresyon | ⬜ |
