/**
 * BİLEŞEN RENDER TESTLERİ (react-dom/server — jsdom gerekmez)
 *
 * Amaç: P0 hata banner'ı, P2 maske butonu, P1 misafir ekranı ve P3 fon içeriği
 * sekmesinin gerçekten render olduğunu ve beklenen metinleri ürettiğini
 * kanıtlamak. JSX yerine createElement kullanılıyor (vitest 4 + rolldown
 * .tsx dönüşümünü esbuild ayarından bağımsız yaptığı için).
 */

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBanner from './ErrorBanner';
import PrivacyToggle from './PrivacyToggle';
import FundContentTab from './FundContentTab';
import GuestMarketView from './GuestMarketView';
import type { FundHoldingRow } from '@/lib/types';

const noop = async () => {};

const rows: FundHoldingRow[] = [
  { id: 'h1', fund_code: 'TLY', ticker: 'OZATD', company_name: 'Özata Denizcilik', weight_pct: 34.27, as_of_date: '2026-07-31', source: 'auto', notes: 'KAP raporu | dışlanan: 3' },
  { id: 'h2', fund_code: 'TLY', ticker: 'FIYATYOK', company_name: 'Fiyatı Olmayan A.Ş.', weight_pct: 5, as_of_date: '2026-07-31', source: 'manual', notes: 'manuel override (UI)' },
];

const fundTab = (props: Partial<Parameters<typeof FundContentTab>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(FundContentTab, {
      rows,
      prices: { OZATD: { price: 500, changePct: 2 }, FIYATYOK: null },
      masked: false,
      canWrite: true,
      onUpsert: noop,
      onDelete: noop,
      ...props,
    })
  );

describe('P0 — ErrorBanner', () => {
  it('hata yokken hiçbir şey render etmez', () => {
    expect(renderToStaticMarkup(createElement(ErrorBanner, { message: null, onDismiss: noop }))).toBe('');
  });

  it('hata varsa kırmızı uyarı + sebep görünür', () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBanner, {
        message: 'Pozisyon kaydı: new row violates row-level security policy',
        onDismiss: noop,
      })
    );
    expect(html).toContain('Değişiklikler kaydedilemedi');
    expect(html).toContain('row-level security');
    expect(html).toContain('role="alert"');
    expect(html).toContain('sayfayı yenilerseniz kaybolur');
  });
});

describe('P2 — PrivacyToggle', () => {
  it('maske kapalıyken GÖSTER', () => {
    const html = renderToStaticMarkup(createElement(PrivacyToggle, { masked: false, onToggle: noop }));
    expect(html).toContain('GÖSTER');
    expect(html).toContain('aria-pressed="false"');
  });

  it('maske açıkken GİZLİ', () => {
    const html = renderToStaticMarkup(createElement(PrivacyToggle, { masked: true, onToggle: noop }));
    expect(html).toContain('GİZLİ');
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('P1 — GuestMarketView', () => {
  const html = renderToStaticMarkup(createElement(GuestMarketView, { onLoginClick: noop }));

  it('giriş CTA\'sı ve halka açık ekran başlığı görünür', () => {
    expect(html).toContain('PORTFÖYÜNÜZÜ GÖRMEK İÇİN GİRİŞ YAPIN');
    expect(html).toContain('HALKA AÇIK PİYASA EKRANI');
  });

  it('portföy verisi içermiyor', () => {
    for (const secret of ['BURCE', 'MASFN', 'SARAE', 'EKIM', 'TLY', 'DFI', 'KGM', 'TP2', '3938', '24197', '678000']) {
      expect(html).not.toContain(secret);
    }
  });

  it('salt okunur: form ve kayıt butonu yok', () => {
    expect(html).not.toContain('<form');
    expect(html).not.toContain('KAYDET');
  });

  it('endeks kartları var', () => {
    expect(html).toContain('BIST 100');
    expect(html).toContain('USD/TRY');
    expect(html).toContain('GRAM ALTIN');
    expect(html).toContain('ONS GÜMÜŞ');
  });
});

describe('P3 — FundContentTab', () => {
  it('hisse, resmî ad, ağırlık, rapor dönemi ve kaynaklar gösterilir', () => {
    const html = fundTab();
    expect(html).toContain('OZATD');
    expect(html).toContain('Özata Denizcilik');
    expect(html).toContain('34,27');
    expect(html).toContain('2026-07-31');
    expect(html).toContain('auto');
    expect(html).toContain('manual');
  });

  it('başlıkta as_of_date + kaynak + dışlanan satır sayısı', () => {
    const html = fundTab();
    expect(html).toContain('Rapor dönemi');
    expect(html).toContain('Kaynak');
    expect(html).toContain('Dışlanan');
    expect(html).toContain('>3<');
  });

  it('manuel satır sayısı rozeti (sync ezmez)', () => {
    expect(fundTab()).toContain('manuel satır (sync ezmez)');
  });

  it('fiyatı eksik hisse → VERİ EKSİK + missingTickers (uydurma yok)', () => {
    const html = fundTab();
    expect(html).toContain('VERİ EKSİK');
    expect(html).toContain('fiyatı eksik: FIYATYOK');
  });

  it('günlük tahmin ve kaplama hesaplanır', () => {
    const html = fundTab();
    expect(html).toContain('GÜNLÜK TAHMİN');
    expect(html).toContain('Kaplama');
    // (34.27 × 2 / 100) = 0.6854 → tr-TR "+0,69"
    expect(html).toContain('+0,69');
    expect(html).toContain('34,27');
  });

  it('ağırlık % kamu verisidir → maske açıkken de görünür', () => {
    expect(fundTab({ masked: true })).toContain('34,27');
  });

  it('manuel override formu alanları mevcut', () => {
    const html = fundTab();
    expect(html).toContain('FON KODU');
    expect(html).toContain('HİSSE KODU');
    expect(html).toContain('AĞIRLIK %');
    expect(html).toContain('RESMÎ AD');
    expect(html).toContain('source=');
  });

  it('DB hazır değilse yazma uyarısı', () => {
    expect(fundTab({ canWrite: false })).toContain('Yazma için veritabanı bağlantısı ve oturum gerekli.');
  });

  it('kayıt yoksa migration yönlendirmesi', () => {
    const html = fundTab({ rows: [] });
    expect(html).toContain('Fon içeriği kaydı yok');
    expect(html).toContain('supabase_fund_holdings_migration.sql');
  });
});
