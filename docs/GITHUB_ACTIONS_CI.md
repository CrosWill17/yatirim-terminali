# ⚙️ GitHub Actions CI Kurulumu

Bu ortamın GitHub App'i `workflows` izni taşımadığından `.github/workflows/ci.yml`
dosyası otomatik push edilemiyor. GitHub web arayüzünden ekleyin:

1. GitHub'da repo → **Add file → Create new file**
2. Dosya adı: `.github/workflows/ci.yml`
3. İçerik olarak aşağıdakini yapıştırın → **Commit new file**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - name: Type check (strict)
        run: npx tsc --noEmit
      - name: Unit tests
        run: npx vitest run
      - name: Production build
        run: npm run build
```

Her push'ta: strict tip kontrolü → 20 unit test → production build çalışır;
yeşil olmayan build Vercel deploy'unu da engeller.
