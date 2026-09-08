# 🚀 Supabase Kurulum Adımları (yalıtımı açmak için)

> Bu dosya, `twitter-sync` arızasının **kalıcı** çözümü içindir.
> Kod tarafı düzeltildi (cron artık düşmüyor), ama **kullanıcı yalıtımı hâlâ
> kapalı**. Aşağıdaki adımlar onu açar.
>
> Buradaki tüm SQL'ler gerçek bir PostgreSQL üzerinde test edildi.

---

## ⚠️ Önce bunu oku: sıra önemli

`supabase_rls_user_isolation.sql` dosyası **11 tablonun zaten var olmasını
bekler**. Tablolar yoksa `ALTER TABLE ... does not exist` hatası alırsın.

Ayrıca bazı kurulum dosyalarında **koruma kilidi** var: RLS migrasyonundan
SONRA tekrar çalıştırılırlarsa `DURDURULDU: ... zaten uygulanmis` diyerek
kendilerini iptal ederler. Bu kasıtlı — çünkü tekrar koşsalardı zayıf
`auth.uid() IS NOT NULL` politikalarını geri getirip yalıtımı sessizce
çökertirlerdi.

**Sonuç: aşağıdaki sırayı bozma.**

---

## ADIM 0 — Neyin eksik olduğunu gör (teşhis)

Supabase → **SQL Editor** → **New query** → yapıştır → **Run**.

Bu sorgu hiçbir şeyi değiştirmez, sadece rapor verir.

```sql
WITH beklenen(sira, tablo, dosya) AS (VALUES
  (1,'portfolio_positions','supabase_schema.sql'),
  (1,'cash_ledger','supabase_schema.sql'),
  (1,'transactions','supabase_schema.sql'),
  (1,'execution_decisions','supabase_schema.sql'),
  (1,'social_predictions','supabase_schema.sql'),
  (1,'app_settings','supabase_schema.sql'),
  (1,'portfolio_snapshots','supabase_schema.sql'),
  (2,'fund_holdings','supabase_fund_holdings_migration.sql'),
  (2,'fund_holdings_history','supabase_fund_holdings_migration.sql'),
  (2,'calibration_log','supabase_fund_holdings_migration.sql'),
  (4,'fund_holding_proposals','supabase_fund_proposals_migration.sql'),
  (5,'fund_nav_daily','supabase_fund_nav_daily_migration.sql')
)
SELECT
  b.sira AS adim,
  b.tablo,
  CASE WHEN c.oid IS NULL THEN 'YOK -> ' || b.dosya ELSE 'var' END AS tablo_durumu,
  CASE
    WHEN c.oid IS NULL THEN '-'
    WHEN a.attname IS NULL THEN 'YOK -> RLS migrasyonu gerekli'
    ELSE 'var'
  END AS user_id_durumu
FROM beklenen b
LEFT JOIN pg_class c
  ON c.relname = b.tablo
 AND c.relnamespace = 'public'::regnamespace
 AND c.relkind = 'r'
LEFT JOIN pg_attribute a
  ON a.attrelid = c.oid AND a.attname = 'user_id' AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY b.sira, b.tablo;
```

**Nasıl okunur:**

| Gördüğün | Anlamı | Ne yap |
|---|---|---|
| `tablo_durumu = YOK -> dosya.sql` | O tablo hiç kurulmamış | O adımı çalıştır |
| `user_id_durumu = YOK -> RLS migrasyonu gerekli` | **Arızanın sebebi bu** | ADIM 6'yı çalıştır |
| Her ikisi de `var` | Zaten tamam | Hiçbir şey yapma |

Beklentim: tablolar `var`, `user_id` sütunları `YOK` çıkacak (`fund_nav_daily`
hariç — o kendi migrasyonunda `user_id` ile birlikte geliyor).

---

## ADIM 1-5 — Yalnızca ADIM 0'da "YOK" çıkan tabloları kur

Bu adımları **sadece gerekiyorsa** çalıştır. `var` diyorsa **atla**.

Her dosyanın tam içeriğini repodaki `supabase/` klasöründen kopyala:

| Adım | Dosya | Ne zaman çalıştır |
|---|---|---|
| 1 | `supabase/supabase_schema.sql` | `portfolio_positions` vb. YOK ise |
| 2 | `supabase/supabase_fund_holdings_migration.sql` | `fund_holdings` YOK ise |
| 3 | `supabase/supabase_twitter_migration.sql` | Adım 1'i yeni çalıştırdıysan |
| 4 | `supabase/supabase_fund_proposals_migration.sql` | `fund_holding_proposals` YOK ise |
| 5 | `supabase/supabase_fund_nav_daily_migration.sql` | `fund_nav_daily` YOK ise |

> `supabase_schema.sql` 8 satır yerleşik örnek portföy ekler. Kendi verin
> varsa bu adımı zaten atlıyor olacaksın.

---

## ADIM 6 — Hesabın var mı? (RLS'ten ÖNCE şart)

RLS migrasyonu, mevcut satırları bir kullanıcıya devretmek zorunda. `auth.users`
boşsa devredecek kimse olmadığı için script **bilerek durur**:

```
auth.users BOŞ ama tablolarda N yetim satır var.
```

Kontrol et:

```sql
SELECT id, email, created_at FROM auth.users ORDER BY created_at;
```

**Boş çıktıysa** önce hesap aç: uygulamada **⚙️ Ayarlar & DB → VERİTABANI
OTURUMU → KAYIT OL**.

> E-posta onayı istenirse: Supabase → **Authentication → Providers → Email** →
> *Confirm email* kapatılabilir. Ya da **Authentication → Users → Add user**
> ile "Auto Confirm" işaretleyerek doğrudan oluştur.

**Çıkan UUID'yi bir yere kaydet** — ADIM 8'de secret olarak lazım olacak.

---

## ADIM 7 — RLS migrasyonu (asıl düzeltme)

`supabase/supabase_rls_user_isolation.sql` dosyasının **tamamını** SQL
Editor'e yapıştır ve çalıştır.

Bu dosya:
- 11 tabloya `user_id` sütununu ekler,
- mevcut satırları tek kullanıcıya devreder (backfill),
- `NOT NULL` + `DEFAULT auth.uid()` yapar,
- tekil kısıtları kullanıcı bazlı bileşiğe çevirir,
- zayıf `auth.uid() IS NOT NULL` politikalarını silip `auth.uid() = user_id`
  politikalarını kurar.

**İdempotenttir** — tekrar çalıştırmak güvenlidir (test ettim).

### Birden fazla kullanıcın varsa

Script şu hatayla durur:

```
auth.users içinde N kullanıcı var; mevcut satırlar otomatik atanamaz.
```

Bu bir koruma: hangi satırın kime ait olduğuna kendi başına karar vermez.
Çözüm — dosyadaki **"1b. ELLE ATAMA"** bloğundaki satırların yorumunu kaldır ve
`00000000-...` yerine kendi UUID'ni yaz, sonra tekrar çalıştır.

---

## ADIM 8 — GitHub secret'ları (senin tarafında yapılacak)

`fund-day-end` job'u geçen çalıştırmada `SUPABASE_OWNER_USER_ID` **boş** olduğu
için düşmüştü. Bunu kontrol et:

**GitHub → repo → Settings → Secrets and variables → Actions**

| Secret | Değeri nereden alırsın |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (⚠️ gizli) |
| `SUPABASE_OWNER_USER_ID` | ADIM 6'daki UUID |
| `TWITTER_AUTH_TOKEN` | x.com çerezi `auth_token` |
| `TWITTER_CT0` | x.com çerezi `ct0` |

> `service_role` anahtarı RLS'i tamamen atlar. Asla tarayıcı koduna, `.env`
> dosyasına veya sohbete yapıştırma — yalnızca GitHub Secrets'a.

---

## ADIM 9 — Doğrula

### 9a. SQL tarafı

Teşhisi (ADIM 0) tekrar çalıştır → tüm satırlar `var / var` olmalı.

Politikaların doğru kurulduğunu gör:

```sql
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
 ORDER BY tablename;
```

Beklenen: her satırda `(auth.uid() = user_id)`.

Zayıf politika kalmadığını kanıtla — **0 satır dönmeli**:

```sql
SELECT tablename, policyname
  FROM pg_policies
 WHERE schemaname = 'public'
   AND qual ILIKE '%IS NOT NULL%';
```

### 9b. Workflow tarafı

**GitHub → Actions → twitter-sync → Run workflow** ile elle tetikle.

Beklenen: yeşil ✅ ve loglarda **artık şu uyarı OLMAMALI**:

```
UYARI: social_predictions.user_id sütunu YOK — ...
```

Bu uyarının kaybolması, job'un yalıtımlı moda geçtiğinin kanıtıdır.

Aynısını `fund-day-end` için de yap (bu, `SUPABASE_OWNER_USER_ID` secret'ını
doğrular).

---

## Özet kontrol listesi

- [ ] ADIM 0 — teşhisi çalıştır, neyin eksik olduğunu gör
- [ ] ADIM 1-5 — yalnızca "YOK" çıkanları kur (sırayla)
- [ ] ADIM 6 — hesabın var mı, UUID'yi not al
- [ ] ADIM 7 — `supabase_rls_user_isolation.sql` çalıştır
- [ ] ADIM 8 — 5 GitHub secret'ını doğrula
- [ ] ADIM 9 — SQL + workflow doğrulaması

---

## Sorun giderme

| Hata | Sebep | Çözüm |
|---|---|---|
| `relation "..." does not exist` | Tablo kurulmamış | ADIM 1-5'i sırayla yap |
| `auth.users BOŞ ama tablolarda N yetim satır var` | Hiç hesap yok | ADIM 6 |
| `auth.users içinde N kullanıcı var` | Çok kullanıcı | "1b. ELLE ATAMA" bloğu |
| `DURDURULDU: ... zaten uygulanmis` | Kurulum dosyasını RLS'ten sonra koştun | **Normal** — o dosyayı atla |
| `policy ... already exists` | — | Olmamalı; dosya idempotent |
| Workflow'da hâlâ legacy uyarısı | Migrasyon geçmemiş | ADIM 0'ı tekrar çalıştır |
