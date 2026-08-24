# 🌐 YATIRIM TERMİNALİ v3.0 — GITHUB, SUPABASE & VERCEL KURULUM REHBERİ

Bu rehber, **Yatırım Terminali v3.0** projenizi **GitHub**'a yükleyip **Supabase** veritabanına bağlayarak **Vercel** üzerinde dakikalar içinde canlıya almanızı sağlar.

---

## 📋 GEREKSİNİMLER
1. **GitHub Hesabı** ([github.com](https://github.com))
2. **Supabase Hesabı** ([supabase.com](https://supabase.com) — Ücretsiz Tier fazlasıyla yeterlidir)
3. **Vercel Hesabı** ([vercel.com](https://vercel.com) — GitHub ile tek tıkla giriş yapabilirsiniz)

---

## 🛠️ ADIM 1: SUPABASE VERİTABANINI HAZIRLAMA

1. [Supabase Dashboard](https://supabase.com/dashboard)'a gidin ve **"New Project"** butonuna tıklayın.
2. Proje Adı: `yatirim-terminali`
3. Güvenli bir veritabanı parolası belirleyin ve bölge olarak **Frankfurt (eu-central-1)** seçin.
4. Proje oluştuktan sonra sol menüden **SQL Editor** (`>_` simgesi) sekmesine gelin.
5. **"New Query"** butonuna tıklayın.
6. Projemizdeki `supabase/supabase_schema.sql` dosyasının içeriğini kopyalayıp buraya yapıştırın ve **"Run"** butonuna basın.
   - Bu işlem 8 ana tabloyu (`portfolio_positions`, `transactions`, `cash_ledger`, `execution_decisions`, `social_predictors` vb.) oluşturacak ve mevcut portföy verilerinizi (BURCE, KGM, TLY, DFI, TP2, MASFN, SARAE, EKIM) otomatik yükleyecektir.
7. Sol menüden **Project Settings** -> **API** sekmesine gidin. Aşağıdaki iki değeri kopyalayın:
   - **Project URL:** `https://xxxxxxxxxxxx.supabase.co`
   - **anon / public key:** `eyJh......`

---

## 🐙 ADIM 2: GITHUB REPOSU OLUŞTURMA VE KODLARI YÜKLEME

1. [GitHub](https://github.com/new)'da yeni bir özel (Private) veya genel (Public) repository açın:
   - İsim: `yatirim-terminali`
2. Bilgisayarınızdaki veya çalışma ortamınızdaki proje dizininde terminali açın ve komutları çalıştırın:

```bash
cd yatirim-terminali

# Git başlatma
git init
git add .
git commit -m "feat: Yatirim Terminali v3.0 - Full-stack release"

# GitHub reponuzu bağlama (Kendi kullanıcı adınızı yazın)
git branch -M main
git remote add origin https://github.com/KULLANICI_ADINIZ/yatirim-terminali.git
git push -u origin main
```

---

## ▲ ADIM 3: VERCEL İLE CANLIYA ALMA (DEPLOYMENT)

1. [Vercel Dashboard](https://vercel.com/new)'a gidin.
2. **"Import Git Repository"** listesinden oluşturduğunuz `yatirim-terminali` reposunu seçin ve **"Import"** butonuna tıklayın.
3. **"Environment Variables"** (Çevre Değişkenleri) bölümünü açın ve Supabase'den aldığınız bilgileri ekleyin:

| Değişken Adı | Değer | Açıklama |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxxxxx.supabase.co` | Supabase Proje URL'niz |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi...` | Supabase Anonim Anahtar |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi...` | Supabase Service Role Anahtarı (Opsiyonel / Admin) |

4. **"Deploy"** butonuna tıklayın!
5. Yaklaşık 1 dakika içinde projeniz `https://yatirim-terminali-xxx.vercel.app` adresinde canlıya çıkacaktır! 🎉

---

## 🔄 OTOMATİK GÜNCELLEME (CI/CD)
- GitHub reponuza yeni bir kod gönderdiğinizde (`git push origin main`), Vercel sitenizi otomatik olarak yeniden derleyip günceller.
- Veritabanı Supabase'de bulutta yaşadığı için tüm işlemleriniz, kararlarınız, nakit akışlarınız ve sosyal tahminleriniz kalıcı olarak korunur.
