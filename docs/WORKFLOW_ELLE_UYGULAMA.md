# ⚠️ Workflow Dosyaları — Elle Uygulama (ZORUNLU)

Bu ortamın GitHub App'i `workflows` izni taşımıyor. Push denemesi şu hatayı verdi:

```
! [remote rejected] (refusing to allow a GitHub App to create or update workflow
  `.github/workflows/ci.yml` without `workflows` permission)
```

Bu yüzden `.github/workflows/` altındaki **üç dosya bu branch'e push EDİLEMEDİ**.
Dosyalar çalışma ağacında duruyor ama git'te değiller. Kodun geri kalanı
(RLS migrasyonu, build düzeltmesi, uç auth, dokümanlar) push edildi.

İki yol var:

- **Kolay yol:** GitHub App'e `workflows: write` izni verin → bu branch'i
  tekrar push edin. Bitti.
- **Elle yol:** aşağıdaki üç değişikliği GitHub web arayüzünden uygulayın.

---

## 🔴 ÖNCELİK 1 — `SUPABASE_OWNER_USER_ID` (RLS migrasyonundan ÖNCE şart)

`supabase/supabase_rls_user_isolation.sql` çalıştırıldıktan sonra
`user_id` **NOT NULL**. `service_role` bağlamında `auth.uid()` NULL olduğu için
sync job'ları artık sahibini açıkça belirtmek zorunda.

**Bu secret'ı eklemezseniz üç sync job'ı da şu hatayla durur:**

```
HATA: SUPABASE_OWNER_USER_ID eksik veya UUID değil.
```

(İyi haber: sessiz veri bozulması değil, gürültülü durma. Job'lar bilerek
bu kontrolü yazıyor.)

### 1a. Secret'ı ekleyin

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**

| Name | Value |
|---|---|
| `SUPABASE_OWNER_USER_ID` | Supabase → Authentication → Users → kendi hesabınızın UUID'si |

UUID'yi SQL ile de alabilirsiniz:
```sql
SELECT id, email, created_at FROM auth.users ORDER BY created_at;
```

### 1b. `.github/workflows/fund-holdings-sync.yml`

Repo → dosyaya git → kalem ikonu → **"Fon içeriğini çek + parse + Supabase"**
adımının `env:` bloğuna bir satır ekleyin:

```yaml
       env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
+         # service_role RLS'i atlar ve auth.uid() NULL'dır; fund_holdings.user_id
+         # NOT NULL olduğu için job satırları KİMİN adına yazdığını bilmeli.
+         # Değer: Supabase → Authentication → Users → kendi hesabınızın UUID'si.
+         SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
        run: npx -y tsx@4 scripts/fund_holdings/sync.ts
```

### 1c. `.github/workflows/twitter-sync.yml` — İKİ yer

**"2/3 Foto OCR → fund_holding_proposals"** adımının `env:` bloğu:

```yaml
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
+         SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
        run: |
          python scripts/twitter_sync/ocr_holdings.py
```

**"3/3 Parse + Supabase"** adımının `env:` bloğu:

```yaml
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
+         SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
          AUTO_VERIFY: '1'
```

---

## 🟠 ÖNCELİK 2 — `.github/workflows/ci.yml` (yeni dosya)

Repo → **Add file → Create new file** → ad: `.github/workflows/ci.yml`
→ aşağıdakini yapıştırın → **Commit new file**.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

# GITHUB_TOKEN'a yazma yetkisi gerekmiyor; sadece repo içeriğini okuyoruz.
permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # ---------------------------------------------------------------------------
  # Ana hat: strict tip kontrolü → birim testler → production build.
  # Build adımı ZORUNLU: bu depoda bir kez `pdf-parse` package.json'a
  # eklenmeden commit edilmişti ve `next build` kırılmıştı (Vercel deploy'u da
  # ölür). CI olmadığı için kimse fark etmedi. Bu adım onu imkânsız kılar.
  # ---------------------------------------------------------------------------
  verify:
    name: Typecheck + Test + Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          # Diğer workflow'larla (twitter-sync, fund-holdings-sync) aynı sürüm.
          node-version: '22'
          cache: 'npm'

      - name: Kur (npm ci — package-lock.json'dan birebir)
        run: npm ci

      - name: Tip kontrolü (strict)
        run: npm run typecheck

      # `next build` üretmeden koşulmaz: lib/seedIsolation.test.ts içindeki
      # "client bundle'ında seed portföy verisi YOK" testi .next/ yoksa
      # it.skipIf ile SESSİZCE atlanır. Sıra bu yüzden test → build → test.
      - name: Birim testler (1. geçiş)
        run: npm test

      - name: Production build
        run: npm run build

      - name: Birim testler (2. geçiş — derlenmiş bundle denetimi dahil)
        run: npm test

      # Seed portföyü (adet/maliyet/nakit) client JS'ine sızmamalı.
      # site herkese açık; View Source ile okunabilirdi.
      - name: Bundle sızıntı denetimi
        run: |
          set -e
          echo "Seed marker'ları client chunk'larında aranıyor..."
          LEAK=0
          for m in 3938 24197 10400 6493 678000 257706 SEED_POSITIONS SEED_DECISIONS; do
            if grep -rq "$m" .next/static/chunks/ 2>/dev/null; then
              echo "::error::SIZINTI: '$m' client bundle'da bulundu"
              LEAK=1
            fi
          done
          [ "$LEAK" -eq 0 ] && echo "✓ seed portföy verisi client bundle'da YOK"
          exit $LEAK

      - name: Bağımlılık açıkları
        # next 14.x EOL olduğu için bilinen high açıklar var (bkz. docs).
        # Deploy'u kırmamak için uyarı olarak çalışır; ayrı issue'da takip edilir.
        continue-on-error: true
        run: npm audit --audit-level=high

  # ---------------------------------------------------------------------------
  # RLS yalıtımı gerçek PostgreSQL'e karşı doğrulanır.
  # supabase/supabase_rls_user_isolation.sql'in "auth.uid() = user_id"
  # politikaları gerçekten kullanıcıları ayırıyor mu, iki kullanıcı aynı
  # sembolü tutabiliyor mu, service_role user_id'siz yazamıyor mu.
  # ---------------------------------------------------------------------------
  rls:
    name: RLS user isolation (real PostgreSQL)
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - name: Migrasyonları çalıştır + yalıtımı doğrula
        run: npm run test:db
```

---

## Uygulama sırası (özet)

1. `SUPABASE_OWNER_USER_ID` secret'ını ekle (1a)
2. İki mevcut workflow'a env satırını ekle (1b, 1c)
3. **Sonra** `supabase/supabase_rls_user_isolation.sql`'i çalıştır
4. `ci.yml`'i ekle (Öncelik 2)
5. Actions sekmesinde üç job'ın da yeşil olduğunu gör

3. adımı 1–2'den önce yaparsanız sync job'ları bir sonraki cron'da hata verir —
veri bozulmaz, sadece durur.
