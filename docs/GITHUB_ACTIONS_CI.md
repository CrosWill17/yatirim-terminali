# ⚙️ GitHub Actions CI

## Durum: `.github/workflows/ci.yml` artık depoda VAR

Eskiden bu dosya depoda yoktu ve README "CI var" diyordu. Bu yüzden
`pdf-parse` package.json'a eklenmeden commit edilmiş, `next build` kırılmış ve
kimse fark etmemişti (Vercel deploy'u da o commit'te başarısız olurdu).

> Not: `docs/WORKFLOW_SURUM_PINLERI.md`, bu ortamın GitHub App'inin `workflows`
> izni taşımadığını ve workflow dosyalarının push edilemediğini anlatıyordu.
> Dosya artık repoda; push reddedilirse GitHub web arayüzünden elle ekleyin
> (aşağıdaki "Elle ekleme" bölümü).

---

## CI ne yapıyor

İki job:

### 1. `verify` — Typecheck + Test + Build

| Adım | Komut | Neden |
|---|---|---|
| Kur | `npm ci` | `package-lock.json`'dan birebir |
| Tip kontrolü | `npm run typecheck` | `strict: true` |
| Birim testler (1. geçiş) | `npm test` | 303 test |
| Production build | `npm run build` | Kırık build main'e girmesin |
| Birim testler (2. geçiş) | `npm test` | ⬇️ aşağıya bakın |
| Bundle sızıntı denetimi | `grep` | Seed portföyü client JS'ine sızmamalı |
| `npm audit` | `--audit-level=high` | `continue-on-error: true` |

**Neden test iki kez koşuyor:** `lib/seedIsolation.test.ts` içindeki
"client bundle'ında seed portföy verisi YOK" testi `.next/static/chunks/`
dizinini tarar ve `it.skipIf(!hasBuild)` ile yazılmıştır. Yani build
çalıştırılmadıysa test **sessizce atlanır** — yeşil görünür ama hiçbir şey
doğrulamamış olur. İlk geçiş build'den önce (hızlı geri bildirim), ikinci
geçiş build'den sonra (gerçek bundle denetimi) koşar.

> Bu tuzağı bizzat gördük: `.next` yokken `vitest run` **171 passed | 1
> skipped** veriyordu; build'den sonra **172 passed**.

### 2. `rls` — RLS user isolation (gerçek PostgreSQL)

`npm run test:db` → `scripts/dbtest/rls-check.mjs`

`embedded-postgres` gerçek bir PostgreSQL ikilisi indirir, geçici bir cluster
ayar ve Supabase'in `auth` şeması + `auth.uid()` fonksiyonu + `anon` /
`authenticated` / `service_role` rolleri taklit edilir. 38 senaryo:

- 2 kullanıcı varken migrasyon bilerek durur (kim kime ait otomatik karar vermez)
- `auth.users` boş + veri varken "önce hesabınızı oluşturun" der
- idempotentlik: 2. ve 3. koşu da başarılı
- `pg_policies` denetimi: hiçbir `IS NOT NULL` politikası kalmadı
- Kullanıcı B, A'nın hiçbir tablosunu okuyamaz / silemez / değiştiremez
- `DEFAULT auth.uid()`: user_id gönderilmeden insert sahibi otomatik alır
- `WITH CHECK`: başkasının id'siyle insert RLS tarafından reddedilir
- Bileşik tekil kısıt: iki kullanıcı aynı sembolü tutabilir
- `service_role` user_id'siz yazamaz (NOT NULL)
- `anon` (oturumsuz) 0 satır görür

Yerelde: `npm run test:db` (ağ gerekmez, harici servis gerekmez).

---

## Elle ekleme (yalnızca push reddedilirse)

1. GitHub'da repo → **Add file → Create new file**
2. Dosya adı: `.github/workflows/ci.yml`
3. Depodaki `.github/workflows/ci.yml` içeriğini yapıştırın → **Commit new file**

---

## Gerekli secrets

`ci.yml` hiçbir secret kullanmaz (yalnızca kod derler/test eder).
Sync job'ları için gerekenler README → "GitHub Actions secrets" bölümünde.

---

## 🔧 2026-09-08 — twitter-sync arızası: "column ... user_id does not exist"

### Belirti

`twitter-sync` her 30 dakikada kırmızıya düşüyordu. Adım `3/3 Parse + Supabase`,
üç denemenin üçünde de aynı hatayla:

```
Supabase senkronizasyonu: deneme 1/3
HATA (mevcut id sorgusu): column social_predictions.user_id does not exist
...
HATA: twitter sync 3 denemede de başarısız oldu.
```

### Kök neden

`supabase/supabase_rls_user_isolation.sql` migrasyonu **canlı veritabanında
çalıştırılmamıştı**, ama job kodu onun uygulandığını **varsayıyordu**:

- okumalar `.eq('user_id', OWNER_ID)` ile daraltılıyordu,
- insert payload'ına `user_id` ekleniyordu,
- `onConflict` hedefi `user_id,...` bileşiğiydi.

Sütun olmadığı için PostgREST `42703` döndürüyor, retry döngüsü de aynı
yapılandırma hatasını 3 kez tekrarlıyordu. Retry burada işe yaramaz: hata
geçici değil, şemasal.

Not: aynı kök neden `fund-day-end` job'unu da düşürmüştü (orada secret boştu,
sonra da aynı sütun varsayımı sıradaydı).

### Çözüm — "varsayma, yokla"

Yeni `lib/dbCompat.ts` katmanı eklendi. Job'lar şemayı sabit varsaymak yerine
başlangıçta **bir kez yokluyor** (`select user_id limit 1`) ve moda göre
davranıyor:

| Şema | Davranış |
|---|---|
| `user_id` VAR (migrasyon uygulanmış) | Eskisi gibi: kullanıcı bazlı filtre, `user_id` yazımı, bileşik `onConflict` |
| `user_id` YOK (legacy) | Filtre eklenmez, `user_id` gönderilmez, `onConflict` user_id'siz olur + net bir UYARI basılır |
| Yoklama ağ/izin hatası verirse | **Güvenli taraf:** sütun VAR kabul edilir; geçici bir ağ hatası yalıtımı kazara kapatmasın |

Sonuç: migrasyon uygulanmamışken cron kırmızıya boyanmaz ve veri akmaya devam
eder; migrasyon uygulandığı an job **kendiliğinden** yalıtımlı moda geçer.

Dokunulan yerler:

- `lib/dbCompat.ts` (yeni) + `lib/dbCompat.test.ts` (19 test)
- `scripts/twitter_sync/sync.ts` — `social_predictions`
- `scripts/twitter_sync/ocr_holdings.py` — `fund_holding_proposals`
- `scripts/fund_holdings/sync.ts` — `fund_holdings`
- `scripts/fund_holdings/day-end.ts` — `fund_holdings`, `fund_nav_daily`

### Kalıcı çözüm (önerilir)

Legacy mod bir **köprüdür**, hedef değil. Yalıtımı gerçekten açmak için
Supabase → SQL Editor'de `supabase/supabase_rls_user_isolation.sql` dosyasını
çalıştırın. Job'lar sonraki turda kendiliğinden yalıtımlı moda geçer; kodda
değişiklik gerekmez.
