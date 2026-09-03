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
| Birim testler (1. geçiş) | `npm test` | 192 test |
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
`authenticated` / `service_role` rolleri taklit edilir. 32 senaryo:

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
