# 🧭 ADIM ADIM UYGULAMA REHBERİ

Hazırlayan: 03.09.2026 · İlgili PR: **[#11](https://github.com/CrosWill17/yatirim-terminali/pull/11)**

Bu rehberdeki **her uyarı gerçek PostgreSQL üzerinde test edilerek** yazıldı.
Test çıktıları aşağıda ilgili adımların yanında.

---

## Başlamadan: mevcut durum

| Ne | Durum |
|---|---|
| `main` | `c0d611a` — **eski kod, kırık build** |
| `arena/01a0664c-yatirim-terminali` | `858e775` — yeni kod |
| PR | [#11](https://github.com/CrosWill17/yatirim-terminali/pull/11) açık |
| Supabase şemanız | eski (RLS yalıtımı YOK) |
| `.github/workflows/*` | push edilemedi → **elle uygulanacak** |

---

## ⚠️ Önce bunu okuyun: neden sıra önemli

Kod ve şema **birbirine bağlı**. `onConflict` hedefleri değişti:

| Kod | `onConflict` |
|---|---|
| Eski (main) | `symbol`, `id`, `snapshot_date`, `fund_code,ticker` |
| Yeni (PR #11) | `user_id,symbol`, `user_id,id`, `user_id,snapshot_date`, `user_id,fund_code,ticker` |

Migrasyon eski tekil kısıtları **düşürüyor**. Yani:

| Kombinasyon | Sonuç (gerçek PostgreSQL'de ölçüldü) |
|---|---|
| Eski şema + yeni kod | ✗ `42703: column "user_id" does not exist` — **yazma çalışmaz**, okuma çalışır |
| Yeni şema + eski kod | ✗ `42P10: no unique or exclusion constraint matching ON CONFLICT` — **yazma çalışmaz**, okuma çalışır |
| Yeni şema + yeni kod | ✓ ikisi de çalışır |

**Panik yapmayın:** hangi sırada giderseniz gidin arada kısa bir pencere olur ve
o pencerede **yalnızca yazma** çalışmaz. Testlerde her iki durumda da okuma
8 satırı sorunsuz döndürdü. Veri **kaybolmaz, bozulmaz** — kayıt sadece
yapılmaz ve arayüzde kırmızı banner çıkar (`repo.ts`'in `WriteResult`
sözleşmesi sayesinde sessiz yutma yok).

**Bu yüzden:** Adım 4 ve 5'i arka arkaya yapın. Arada kahve molası vermeyin. 🙂

---

## ADIM 1 — `SUPABASE_OWNER_USER_ID` secret'ını ekleyin

> Neden ilk sırada: RLS migrasyonundan sonra `user_id` NOT NULL olacak ve
> `service_role` bağlamında `auth.uid()` NULL. Sync job'ları sahibini açıkça
> bilmek zorunda. Bu secret yoksa üç job da durur.

1. GitHub → `CrosWill17/yatirim-terminali` → **Settings**
2. Sol menü → **Secrets and variables** → **Actions**
3. **New repository secret**

Önce kendi UUID'nizi alın — Supabase → **SQL Editor** → çalıştırın:

```sql
SELECT id, email, created_at FROM auth.users ORDER BY created_at;
```

| Name | Value |
|---|---|
| `SUPABASE_OWNER_USER_ID` | yukarıdaki sorgudan **kendi hesabınızın** `id` değeri |

✅ **Kontrol:** Secrets listesinde `SUPABASE_OWNER_USER_ID` görünüyor.

> 🔎 **Bu sorguyu saklayın.** Adım 5'te de lazım olacak — orada kaç kullanıcı
> olduğunuza bakacağız.

---

## ADIM 2 — Üç workflow değişikliğini uygulayın

İki yol var. **A yolu çok daha kolay.**

### Yol A (önerilen): GitHub App'e izin verin

Eğer Arena'daki GitHub bağlantısının ayarlarına erişebiliyorsanız, App'e
**`Workflows: Read and write`** izni verin. Sonra bana "push et" deyin —
üç dosyayı da ben gönderirim ve bu adım biter.

İzin veremiyorsanız Yol B.

### Yol B: Elle (GitHub web arayüzü)

Kendi hesabınızla web arayüzünden yaptığınız commit'ler bu kısıtlamaya takılmaz.

#### 2a. `SUPABASE_OWNER_USER_ID`'yi iki mevcut workflow'a ekleyin

**`.github/workflows/fund-holdings-sync.yml`** → dosyayı aç → kalem ikonu →
`"Fon içeriğini çek + parse + Supabase"` adımının `env:` bloğuna **bir satır** ekleyin:

```yaml
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
        run: npx -y tsx@4 scripts/fund_holdings/sync.ts
```

**`.github/workflows/twitter-sync.yml`** → **İKİ ayrı yer** var, ikisine de ekleyin:

```yaml
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
        run: |
          python scripts/twitter_sync/ocr_holdings.py
```

```yaml
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          SUPABASE_OWNER_USER_ID: ${{ secrets.SUPABASE_OWNER_USER_ID }}
          AUTO_VERIFY: '1'
```

> ⚠️ **YAML girintisi önemli.** `SUPABASE_OWNER_USER_ID` satırı diğer
> `SUPABASE_*` satırlarıyla **birebir aynı** hizada olmalı (10 boşluk).
> Kaydırdığınızda GitHub "Invalid workflow file" der.

> ✅ Bu değişiklik eski script'lerle birlikte çalışırken **zararsızdır** —
> main'deki eski script'ler bu değişkeni okumuyor, sadece tanımsız durur.

#### 2b. `ci.yml` dosyasını oluşturun

Repo → **Add file** → **Create new file** → ad: `.github/workflows/ci.yml`

İçerik: **`docs/WORKFLOW_ELLE_UYGULAMA.md`** içindeki "ÖNCELİK 2" bloğunu
olduğu gibi kopyalayın (97 satır).

✅ **Kontrol:** repo → **Actions** sekmesinde **CI** görünüyor.

> Bu adım Adım 4'ten ÖNCE yapılmış olmalı ki merge sonrası CI koşsun.

---

## ADIM 3 — PR #11'i merge edin

1. [PR #11](https://github.com/CrosWill17/yatirim-terminali/pull/11) → **Merge pull request**
2. Adım 2b'yi yaptıysanız CI otomatik koşar. **Actions** sekmesinde iki job'ı izleyin:
   - `verify` — typecheck + test + build + bundle denetimi
   - `rls` — gerçek PostgreSQL'de 38 yalıtım senaryosu
3. İkisi de yeşil olmalı.

> 🔴 CI kırmızıysa **merge etmeyin**, bana hatayı iletin.

✅ **Kontrol:** `main` artık `858e775`. Vercel otomatik deploy ediyorsa
**Vercel → Deployments**'ta yeni deploy'un **Ready** olduğunu görün.

> ❓ **Vercel bağlı mı emin değil misiniz?** Vercel → projeniz → Settings → Git.
> `CrosWill17/yatirim-terminali` ve Production Branch `main` görülmeli.
> Bağlı değilse kodu siz deploy etmelisiniz — bu durumda Adım 5'i
> deploy **bittikten sonra** yapın.

---

## ADIM 4 — Hemen RLS migrasyonunu çalıştırın

> ⏱️ Adım 3 biter bitmez. Aradaki sürede uygulama açık ama **kayıt yapamaz**
> (kırmızı banner). Veri kaybı yok.

### 4a. Kaç kullanıcı var? (kritik ön kontrol)

Supabase → **SQL Editor** → çalıştırın:

```sql
SELECT id, email, created_at FROM auth.users ORDER BY created_at;
```

| Sonuç | Ne yapacaksınız |
|---|---|
| **1 satır** | ✅ Doğrudan 4b'ye geçin |
| **0 satır** | Önce terminalden hesap oluşturun (⚙️ Ayarlar & DB), sonra 4b |
| **2+ satır** | ⛔ **Durun.** Migrasyon bilerek hata verir — hangi satırın kime ait olduğunu otomatik karar vermez. Önce gereksiz hesapları silin (`DELETE FROM auth.users WHERE email = '...';`) ya da bana yazın, elle atama bloğunu sizin için doldurayım |

> Bu davranış test edildi: 2 kullanıcı varken migrasyon
> `auth.users içinde 2 kullanıcı var; mevcut satırlar otomatik atanamaz`
> diyerek duruyor.

### 4b. SQL'i çalıştırın

1. Supabase → **SQL Editor** → **New query**
2. `supabase/supabase_rls_user_isolation.sql` dosyasının **tamamını** kopyalayın
   (main'e merge oldu, GitHub'dan açabilirsiniz)
3. Yapıştırın → **Run**

**Beklenen çıktı:**
```
NOTICE:  Backfill tamam: tüm yetim satırlar <uuid> kullanıcısına atandı.
```
ve hata **yok**.

> 🛡️ **Güvenlik:** Supabase SQL Editor tüm dosyayı **tek transaction** olarak
> koşar. Bir satır patlarsa **her şey geri alınır** — yarım kalmış şema olmaz.
> Bunu test ettim: kasıtlı hata verdiğimde `pg_policies` değişmedi.

### 4c. Hata alırsanız

| Hata | Anlamı | Çözüm |
|---|---|---|
| `auth.users BOŞ ama tablolarda N yetim satır var` | Henüz hesap açmadınız | Terminalden hesap açın, SQL'i **tekrar** çalıştırın (idempotent) |
| `auth.users içinde N kullanıcı var` | Birden fazla hesap | 4a'ya dönün |
| `N satırın user_id'si hâlâ NULL` | Elle atama gerekiyor | Bana yazın |

> ✅ Migrasyon **idempotent** — tekrar çalıştırmak güvenli. Test edildi:
> 2. ve 3. koşu da başarılı.

---

## ADIM 5 — Doğrulama (atlamayın)

Supabase → **SQL Editor** → sırayla:

### 5a. Zayıf politika kalmadı mı?

```sql
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual ILIKE '%IS NOT NULL%' OR with_check ILIKE '%IS NOT NULL%');
```

**Beklenen: 0 satır.** Bir satır bile çıkarsa yalıtım yok demektir → bana yazın.

### 5b. Yeni politikalar yerinde mi?

```sql
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename;
```

**Beklenen:** her tabloda `((auth.uid() = user_id))`. Toplam ~11 politika.

### 5c. Veriniz yerinde mi?

```sql
SELECT count(*) AS pozisyon FROM portfolio_positions;
SELECT count(*) AS kasa     FROM cash_ledger;
SELECT count(*) AS islem    FROM transactions;
```

Migrasyondan önceki sayılarla aynı olmalı. Ve:

```sql
SELECT symbol, user_id FROM portfolio_positions ORDER BY symbol;
```

Her satırda `user_id` dolu ve **hepsi aynı UUID** (sizin).

### 5d. Uygulamayı deneyin

1. Terminali açın → giriş yapın
2. **Portföy verileriniz görünüyor mu?** ✓
3. **Kasa bakiyesi doğru mu?** ✓
4. Küçük bir test işlemi ekleyin → **kırmızı banner ÇIKMIYOR** ✓
5. Üst barda **"Son kayıt" saati güncellendi** ✓

> Eğer kırmızı banner çıkıyorsa: büyük olasılıkla Vercel hâlâ eski kodu
> çalıştırıyor. Deploy'un bittiğini kontrol edin.

---

## ADIM 6 — Sync job'larını kontrol edin

GitHub → **Actions** → sıradaki koşuda:

| Job | Cron | Ne beklenir |
|---|---|---|
| `twitter-sync` | her 30 dk | yeşil |
| `fund-holdings-sync` | Pzt/Per 09:00 | yeşil |

Beklememek için **Run workflow** ile elle tetikleyebilirsiniz.

> `SUPABASE_OWNER_USER_ID` eksikse job şu hatayla durur (veri bozulmaz):
> ```
> HATA: SUPABASE_OWNER_USER_ID eksik veya UUID değil.
> ```

---

## 🚫 Asla yapmayın

| ❌ | Neden |
|---|---|
| Migrasyondan sonra `supabase_schema.sql`'i tekrar çalıştırmak | Zayıf politikaları geri getirir, yalıtım **sessizce** çöker |
| Aynı şekilde `fund_holdings_migration.sql` / `fund_proposals_migration.sql` | Aynı sebep |
| `SUPABASE_SERVICE_ROLE_KEY`'i Vercel'e veya `.env`'e koymak | RLS'i tamamen atlar |

> 🛡️ **İyi haber:** ilk üç madde artık **imkânsız**. Üç dosyanın başına kilit
> koydum — `portfolio_positions.user_id` varsa dosya ilk satırda
> `DURDURULDU: supabase_rls_user_isolation.sql zaten uygulanmış...` diyerek
> duruyor. Test edildi: üçü de duruyor ve `pg_policies`'te zayıf politika
> sayısı 0 kalıyor.
>
> `supabase_twitter_migration.sql` politika içermediği için kilitsiz ve
> tekrar çalıştırılabilir.

---

## Özet: tek bakışta sıra

```
1. SUPABASE_OWNER_USER_ID secret'ını ekle        (zararsız, önce yapılabilir)
2. 3 workflow değişikliğini uygula               (zararsız, önce yapılabilir)
3. PR #11 merge → CI yeşil → Vercel Ready
4. ⏱️ HEMEN supabase_rls_user_isolation.sql çalıştır
5. Doğrulama sorguları + uygulamayı dene
6. Actions'ta sync job'larını kontrol et
```

1 ve 2'yi rahatça önceden yapabilirsiniz. **3 → 4 arasını kısa tutun.**

---

## Bir sorun olursa

Şu üç bilgiyi bana verin, gerisini ben çözerim:

1. Hangi adımda kaldınız
2. Hata mesajının **tam metni**
3. `SELECT count(*) FROM auth.users;` sonucu

**Geri alma:** migrasyonu geri almak isterseniz söyleyin — tersine migration
SQL'ini yazarım. Ama önce 5a–5d'yi deneyin; büyük olasılıkla gerek kalmayacak.
