# 🌐 YATIRIM TERMİNALİ v3.1 — GITHUB, SUPABASE & VERCEL KURULUM REHBERİ

Bu rehber, **Yatırım Terminali v3.1** projenizi GitHub'a yükleyip **Supabase** veritabanına bağlayarak
**Vercel** üzerinde dakikalar içinde canlıya almanızı sağlar.

> ⚠️ **v3.1 güvenlik notu:** Bu sürümde RLS politikaları auth tabanlıdır; veritabanına erişmek için
> terminal içinden oturum açmanız gerekir. `service_role` anahtarı bu mimaride **kesinlikle kullanılmaz**
> (eski v3.0 dokümantasyondaki `SUPABASE_SERVICE_ROLE_KEY` satırını uygulamanız GEREKMEZ).

---

## 📋 GEREKSİNİMLER
1. **GitHub Hesabı** ([github.com](https://github.com))
2. **Supabase Hesabı** ([supabase.com](https://supabase.com) — Ücretsiz tier fazlasıyla yeterlidir)
3. **Vercel Hesabı** ([vercel.com](https://vercel.com) — GitHub ile tek tıkla giriş yapabilirsiniz)

---

## 🛠️ ADIM 1: SUPABASE VERİTABANINI HAZIRLAMA

1. [Supabase Dashboard](https://supabase.com/dashboard)'a gidin ve **"New Project"** butonuna tıklayın.
2. Proje Adı: `yatirim-terminali`
3. Güvenli bir veritabanı parolası belirleyin ve bölge olarak **Frankfurt (eu-central-1)** seçin.
4. Proje oluştuktan sonra sol menüden **SQL Editor** (`>_` simgesi) sekmesine gelin.
5. **"New Query"** butonuna tıklayın.
6. Projedeki `supabase/supabase_schema.sql` dosyasının içeriğini kopyalayıp yapıştırın ve **"Run"** butonuna basın.
   - 7 tablo oluşur: `portfolio_positions`, `cash_ledger`, `transactions`, `execution_decisions`,
     `social_predictions`, `app_settings`, `portfolio_snapshots` + auth tabanlı RLS politikaları.
7. Sol menüden **Authentication → Providers → Email** sekmesinde Email'in açık olduğundan emin olun.
   - Kişisel kullanım için **"Confirm email"** seçeneğini **KAPATMANIZI** öneririz;
     açıksa terminalden hesap oluşturduğunuzda e-postanızdaki onay linkine tıklamanız gerekir.
8. Sol menüden **Project Settings → API** sekmesine gidin. Aşağıdaki **iki değeri** kopyalayın:
   - **Project URL:** `https://xxxxxxxxxxxx.supabase.co`
   - **anon / public key** (göz simgesine tıklayıp kopyalayın): `eyJh...`

   🔒 **`service_role` key'i KOPYALAMAYIN, KULLANMAYIN.** O anahtar tüm güvenlik kurallarını atlar;
   bu projede hiçbir yerde (ne `.env`'de ne Vercel'de) yeri yoktur.

---

## 🐙 ADIM 2: GITHUB REPOSU

Reponuz zaten GitHub'daysa (bu ortamda `CrosWill17/yatirim-terminali`) bu adımı atlayın.
Yoksa: `git init` → `git add .` → `git commit -m "feat: v3.1"` → `git push -u origin main`.

> 💡 `.env` dosyası `.gitignore` ile korunur; anahtarlarınız asla repo'ya gitmez.

---

## ▲ ADIM 3: VERCEL'DE İÇE AKTARMA (YENİ PROJE İÇİN)

1. [vercel.com/new](https://vercel.com/new) adresine gidin.
2. **"Add New → Project"** altında GitHub listenizden `yatirim-terminali` repo'sunu seçin → **Import**.
3. Framework otomatik olarak **Next.js** algılanır; değişiklik gerekmez.
4. **"Environment Variables"** bölümü açılır → Supabase değerlerini ekleyin (aşağıdaki ADIM 4'te detaylı anlatım).
5. **"Deploy"** butonuna basın. ~1-2 dakika sonra `https://yatirim-terminali-xxx.vercel.app` adresinde canlıdır. 🎉

---

## 🔑 ADIM 4: SUPABASE DEĞERLERİNİ VERCEL'E GİRME (DETAYLI)

### 4.1 Vercel paneline gidin
- [vercel.com/dashboard](https://vercel.com/dashboard) → projenize (`yatirim-terminali`) tıklayın.
- Üst menüden **Settings** (Ayarlar) → sol menüde **Environment Variables** sekmesini açın.

### 4.2 Değişkenleri ekleyin
**"+ Add Environment Variable"** butonuna tıklayın. Aşağıdaki iki satırı, satır satır ekleyin:

| Field (Değişken Adı) | Value (Değer) | Environments (ortamlar) |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxxxxxxxxx.supabase.co` | ☑️ Production ️ Preview ☑️ Development |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIs...` (anon key'in tamamı) | ☑️ Production ☑️ Preview ☑️ Development |

Giriş kuralları:
- **Adı** tam olarak `NEXT_PUBLIC_SUPABASE_URL` ve `NEXT_PUBLIC_SUPABASE_ANON_KEY` yazın.
  `NEXT_PUBLIC_` prefix'i Next.js'in değerleri tarayıcıya da gönderebilmesi için **zorunludur** —
  kısaltmayın veya değiştirmeyin.
- **Değeri** tırnak eklemeyin, boşluk bırakmayın, anahtarın tamamını yapıştırın (anon key ~200 karakterdir).
- **Environments** kutucuklarından en az **Production**'ı işaretleyin (öneri: üçünüzü de).
- **Add** ile kaydedin; ikinci satırı aynı şekilde ekleyin.

> 📌 Değerleri girdikten sonra Vercel'de "environment variables have changed" uyarısı görürsünüz
> veya otomatik olarak yeniden derleme başlar.

### 4.3 Neden yeniden deploy (redeploy) şart?
`NEXT_PUBLIC_` ile başlayan değişkenler **build sırasında** JavaScript paketinin içine gömülür
("inlined"). Yani değişkeni ekledikten/çıkarana kadar derlenmiş sürüm eski (boş) değerlerle çalışır.
- Yeni eklediniz → Vercel çoğu durumda otomatik yeniden derler; gelmediyse
  **Deployments** sekmesi → son deploy → **⋯ → Redeploy** (yedek "Copy variables" kutusunu kapalı bırakın).
- Değeri değiştirdiniz (ör. yeni Supabase projesi) → mutlaka **yeni bir deploy** tetikleyin.

### 4.4 Çalıştığını doğrulama
1. Siteyi açın → üst barda `📍 YEREL MOD` yerine **`🔒 OTURUM GEREKLİ`** rozeti görünmeli
   (Supabase'e ulaşıldığının işaretidir).
2. **⚙️ Ayarlar & DB** sekmesindeki **VERİTABANI OTURUMU** panelinden e-posta + şifre ile
   **GİRİŞ YAP** (ilk sefer: **HEPSAP OLUŞTUR**).
3. Girişte üst barda **`☁️ DB KALICI`** rozeti yanar; Ayarlar'da `🟢 ... kalıcı olarak saklanıyor` yazar.
4. İlk girişte yerleşik portföy (BURCE, KGM, TLY, DFI, TP2, MASFN, SARAE, EKIM) otomatik olarak
   Supabase'e aktarılır — sayfa yenileseniz de verileriniz kalır.
5. Bonus doğrulama: Supabase Dashboard → **Table Editor** → `portfolio_positions` tablosunda
   8 pozisyonunuzu görebilirsiniz.

### 4.5 Yerel geliştirme için `.env`
Bilgisayarınızda `npm run dev` ile çalıştırırken aynı değerleri proje kökündeki `.env` dosyasına yazın
(şablon: `.env.example` → `cp .env.example .env` → değerleri girin). `.env` git'e girmez.

---

## 🔒 GÜVENLİK NOTLARI
- `anon` key tarayıcıya da gider — bu **tasarımı gereğidir** ve güvenliği RLS politikaları sağlar:
  v3.1 şemasında her tabloya yalnızca oturum açmış (auth.uid()) kullanıcı okur-yazar.
  Anon key tek başına veritabanına **erişemez**.
- `service_role` key'ini asla `NEXT_PUBLIC_` yapmayın, asla Vercel env'lerine eklemeyin;
  sızarsa veritabanınızın tüm RLS korumasını geçilebilir.
- Şifre değiştirmek isterseniz: Supabase → Authentication → Users → ilgili kullanıcı → reset.
  Supabase projenizi silerseniz tüm veriler gider; kayıp yaşamamak için Ayarlar'daki
  **JSON YEDEK İNDİR** ile düzenli yedek alın.

---

## 🔄 OTOMATİK GÜNCELLEME (CI/CD)
- GitHub repo'na yeni kod gönderdiğinizde (`git push origin main`) Vercel sitenizi otomatik
  yeniden derler. Repo'daki GitHub Actions CI (typecheck + 20 unit test + build) her push'ta çalışır;
  yeşil olmayan build'ler Vercel deploy'unu da reddeder.
- Veritabanı Supabase'de bulutta yaşadığı için tüm işlemleriniz, kararlarınız, nakit akışlarınız ve
  sosyal tahminleriniz kalıcı olarak korunur.
