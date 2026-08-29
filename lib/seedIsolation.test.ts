/**
 * P0 — SEED VERİSİ İSTEMCİ BUNDLE'INDA OLMAMALI
 *
 * Site Vercel'de herkese açık. Yerleşik portföy (adet, maliyet, stop, karar
 * metinleri) client JS'ine gömülürse View Source ile okunabilir. Bu testler
 * seed sabitlerinin SUNUCU-ÖZEL dosyada kaldığını doğrular.
 *
 * Ayrıca `next build` çalıştırılmışsa (.next varsa) gerçek bundle taranır —
 * bu, kabul testlerindeki "bundle kontrolü" maddesinin otomatik karşılığıdır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

/** Seed'e özgü, başka yerde geçmesi beklenmeyen değerler. */
const SEED_MARKERS = [
  '3938',      // BURCE adet
  '24197',     // TP2 adet
  '10400',     // DFI adet
  '6493',      // TLY birim maliyet
  '678000',    // başlangıç ana para
  '257706',    // serbest nakit
  'SEED_POSITIONS',
  'SEED_DECISIONS',
  'MERDİVENLİ SAT',
];

/**
 * Yorumları siler: kontrol edilen şey KULLANICIYA GÖRÜNEN metin ve derlenen
 * koddur; "kaldırıldı" diyen açıklama yorumları ihlal sayılmaz.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/** İstemci tarafına derlenen dosyalar (route'lar ve sunucu-özel modüller hariç). */
function clientFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === 'api' || entry === 'node_modules' || entry === '.next') continue;
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      if (/\.test\.tsx?$/.test(entry)) continue;
      if (full.endsWith(join('lib', 'serverSeed.ts'))) continue;      // sunucu-özel
      if (full.endsWith(join('lib', 'supabaseServer.ts'))) continue;  // sunucu-özel
      out.push(full);
    }
  };
  walk(join(ROOT, 'app'));
  walk(join(ROOT, 'components'));
  walk(join(ROOT, 'lib'));
  return out;
}

describe('P0 — seed verisi sunucu-özel dosyada kalır', () => {
  it('istemci dosyaları lib/serverSeed import etmez', () => {
    const offenders: string[] = [];
    for (const f of clientFiles()) {
      const src = readFileSync(f, 'utf8');
      if (/from\s+['"](@\/lib\/serverSeed|\.\/serverSeed|\.\.\/lib\/serverSeed)['"]/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('istemci dosyalarında seed portföy değerleri geçmiyor', () => {
    const offenders: { file: string; marker: string }[] = [];
    for (const f of clientFiles()) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of SEED_MARKERS) {
        if (src.includes(m)) offenders.push({ file: f.replace(ROOT, ''), marker: m });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('serverSeed.ts seed sabitlerini gerçekten tanımlıyor', () => {
    const src = readFileSync(join(ROOT, 'lib', 'serverSeed.ts'), 'utf8');
    expect(src).toContain('export const SEED_POSITIONS');
    expect(src).toContain('export const SEED_DECISIONS');
    expect(src).toContain('3938');
  });

  it('/api/seed route\'u oturum doğruluyor', () => {
    const src = readFileSync(join(ROOT, 'app', 'api', 'seed', 'route.ts'), 'utf8');
    expect(src).toContain('getUserFromRequest');
    expect(src).toMatch(/status:\s*401/);
  });

  it('app/page.tsx portföy state\'ini boş başlatıyor (seed ile değil)', () => {
    const src = readFileSync(join(ROOT, 'app', 'page.tsx'), 'utf8');
    expect(src).toMatch(/useState<Position\[\]>\(\[\]\)/);
    expect(src).toMatch(/useState<Decision\[\]>\(\[\]\)/);
    expect(src).toMatch(/useState<SocialPrediction\[\]>\(\[\]\)/);
  });

  it('"YEREL MOD" kavramı arayüzden kaldırıldı', () => {
    for (const f of clientFiles()) {
      const src = stripComments(readFileSync(f, 'utf8'));
      expect(src.includes('YEREL MOD'), f).toBe(false);
      expect(/yerel modda/i.test(src), f).toBe(false);
      expect(/'local'/.test(src), f).toBe(false);
    }
  });
});

describe('P0 — derlenmiş bundle kontrolü (next build sonrası)', () => {
  const chunksDir = join(ROOT, '.next', 'static', 'chunks');
  const hasBuild = existsSync(chunksDir);

  it.skipIf(!hasBuild)('client bundle\'ında seed portföy verisi YOK', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith('.js')) files.push(full);
      }
    };
    walk(chunksDir);
    expect(files.length).toBeGreaterThan(0);

    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of SEED_MARKERS) {
        if (src.includes(m)) hits.push(`${f.replace(ROOT, '')}:${m}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
