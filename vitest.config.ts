import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Vitest yapılandırması
 *  - `@/*` takma adı: Next.js tsconfig paths ile aynı (bileşen testleri için şart)
 *  - environment: node → react-dom/server ile statik render (jsdom gerekmez)
 *  - oxc.jsx: Next.js tsconfig'inde "jsx": "preserve" zorunlu; test derlemesinde
 *    bunu "automatic" runtime ile eziyoruz, aksi hâlde .tsx bileşenlerdeki JSX
 *    dönüştürülmeden kalıyor ve vitest parse hatası veriyor.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
