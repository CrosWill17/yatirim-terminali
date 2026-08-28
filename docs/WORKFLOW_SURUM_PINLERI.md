# ⚙️ Workflow Sürüm Pinleri — Elle Uygulama (v3.2)

Bu ortamın GitHub App'i `workflows` izni taşımadığından `.github/workflows/*`
dosyaları PR ile **gönderilemiyor**. Push denemesi şu hatayı veriyor:

```
! [remote rejected] (refusing to allow a GitHub App to create or update workflow
  `.github/workflows/fund-holdings-sync.yml` without `workflows` permission)
```

Bu, `GITHUB_ACTIONS_CI.md`'de anlatılan kısıtın aynısı.

## Önemli: bu güncelleme ZORUNLU DEĞİL

v3.2 PR'ının eklediği script'ler, **main'de zaten duran workflow'ların çağırdığı
yollarla birebir aynı**:

| Workflow (main'de mevcut) | Çağırdığı yol | PR'da var mı |
|---|---|---|
| `twitter-sync.yml` | `python scripts/twitter_sync/fetch_tweets.py` | ✅ |
| `twitter-sync.yml` | `npx -y tsx@4 scripts/twitter_sync/sync.ts` | ✅ |
| `fund-holdings-sync.yml` | `npx -y tsx@4 scripts/fund_holdings/sync.ts` | ✅ |

Yani PR merge olur olmaz mevcut workflow'lar çalışmaya başlar. Aşağıdaki pin
güncellemeleri yalnızca bakım amaçlıdır (ve bu depoda doğrulanamadı — bkz. uyarı).

## Opsiyonel güncelleme (GitHub web arayüzünden)

Repo → dosyaya git → kalem ikonu → aşağıdaki üç satırı değiştir → **Commit changes**.

### `.github/workflows/fund-holdings-sync.yml`

```yaml
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v5

-      - uses: actions/setup-node@v4
+      - uses: actions/setup-node@v5
```

### `.github/workflows/twitter-sync.yml`

```yaml
-      - uses: actions/checkout@v4
+      - uses: actions/checkout@v5

-      - uses: actions/setup-python@v5
+      - uses: actions/setup-python@v6

-      - uses: actions/setup-node@v4
+      - uses: actions/setup-node@v5
```

> ⚠️ **Doğrulanmadı:** `checkout@v5`, `setup-node@v5` ve `setup-python@v6`
> etiketlerinin var olduğu bu ortamdan teyit edilemedi (sandbox'tan `github.com`'a
> çıkış yok). Uygulamadan önce <https://github.com/actions/checkout/tags> ve
> <https://github.com/actions/setup-python/tags> sayfalarından kontrol edin.
> Emin değilseniz `v4` / `v4` / `v5` pinlerinde kalmak güvenlidir — mevcut
> workflow'lar bu pinlerle zaten çalışıyor.
