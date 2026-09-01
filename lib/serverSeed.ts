/**
 * ⛔ SUNUCU-ÖZEL (SERVER-ONLY) MODÜL
 *
 * Bu dosya YALNIZCA Next.js API route'larından (sunucu tarafı) import edilebilir.
 * `app/page.tsx` gibi 'use client' dosyalarından import edilirse seed portföy
 * verisi client JS bundle'ına gömülür ve site herkese açık olduğu için
 * View Source ile okunabilir hâle gelir.
 *
 * Koruma katmanları:
 *  1) Bu uyarı başlığı + lib/serverSeedGuard.test.ts (istemci kodunun bu
 *     modülü import etmediğini her test koşusunda doğrular).
 *  2) app/api/seed/route.ts veriyi yalnızca GEÇERLİ Supabase oturumu olan
 *     kullanıcıya döndürür (auth.getUser ile sunucu tarafında doğrulanır).
 *  3) Seed yalnızca kullanıcının portföyü BOŞSA istenir.
 */

import type { Decision, Position } from './types';

/**
 * Kanonik varlık adları + türleri (26.08.2026 doğrulama:
 * hisseler → Yahoo Finance meta longName, fonlar → fonaly.com/TEFAS).
 *
 * KOD + AD EŞLEMESİ PORTFÖYÜ ELE VERİR (hangi 8 varlık tutulduğu) → bu yüzden
 * sunucu-özel tutulur ve arayüze /api/asset-meta ile (oturum doğrulanarak) gelir.
 */
export const ASSET_META: Record<string, { name: string; type: Position['asset_type'] }> = {
  BURCE: { name: 'Burçelik Bursa Çelik Döküm Sanayii A.Ş.', type: 'BIST_HISSE' },
  MASFN: { name: 'Masfen Enerji A.Ş.', type: 'BIST_HISSE' },
  SARAE: { name: 'Sa-Ra Enerji İnşaat Ticaret ve Sanayi A.Ş.', type: 'BIST_HISSE' },
  EKIM: { name: 'Ekim Turizm Ticaret ve Sanayi A.Ş.', type: 'BIST_HISSE' },
  TLY: { name: 'Tera Portföy Birinci Serbest Fon', type: 'TEFAS_FON' },
  DFI: { name: 'Atlas Portföy Serbest Fon', type: 'TEFAS_FON' },
  THF: { name: 'Tera Portföy Hisse Senedi (TL) Fonu (Hisse Senedi Yoğun Fon)', type: 'TEFAS_FON' },
  KGM: { name: 'Kuveyt Türk Portföy Gümüş Katılım Fon Sepeti', type: 'TEFAS_FON' },
  TP2: { name: 'Tera Portföy Para Piyasası (TL) Fonu', type: 'PPF' },
};

/** Yerleşik başlangıç portföyü (20.08.2026) — GİZLİ: yalnız sunucuda durur. */
export const SEED_POSITIONS: Position[] = [
  { id: '1', symbol: 'BURCE', asset_name: 'Burçelik Bursa Çelik Döküm Sanayii A.Ş.', asset_type: 'BIST_HISSE', quantity: 3938, unit_cost: 40.96, target_price: 53.40, stop_price: 32.50, risk_score: 10, current_action: 'KADEMELİ SAT', rationale: 'Zarar eden şirket (F/K -24.2, PD/DD 2.45). Merdivenli çıkış (%5 ağırlığa iniş).', is_active: true },
  { id: '2', symbol: 'KGM', asset_name: 'Kuveyt Türk Portföy Gümüş Katılım Fon Sepeti', asset_type: 'TEFAS_FON', quantity: 25000, unit_cost: 2.99, target_price: 3.40, stop_price: 2.60, risk_score: 7, current_action: 'TUT', rationale: 'Gümüşe %95 endeksli. Tek emtia yoğunluğu 25.000 paya indirildi, stop korumalı.', is_active: true },
  { id: '3', symbol: 'TLY', asset_name: 'Tera Portföy Birinci Serbest Fon', asset_type: 'TEFAS_FON', quantity: 7, unit_cost: 6493, target_price: 9900, stop_price: 7250, risk_score: 9, current_action: '2/3 ÇIKIŞ', rationale: 'OZATD tek hisse %34.27 risk konsantrasyonu. 2/3 kâr al, 1/3 stop korumalı TUT.', is_active: true },
  { id: '4', symbol: 'DFI', asset_name: 'Atlas Portföy Serbest Fon', asset_type: 'TEFAS_FON', quantity: 10400, unit_cost: 3.846, target_price: 6.10, stop_price: 4.60, risk_score: 9, current_action: 'TUT', rationale: '27 hisseye dağılmış (%53 hisse + %28 fon). 2024 LIDER geçmişi sebebiyle stop korumalı.', is_active: true },
  { id: '5', symbol: 'TP2', asset_name: 'Tera Portföy Para Piyasası (TL) Fonu', asset_type: 'PPF', quantity: 24197, unit_cost: 1.963, target_price: 2.20, stop_price: 1.96, risk_score: 1, current_action: 'TUT', rationale: 'Nakit park yeri. Politika faizi %37, TÜFE %31.75 ortamında pozitif reel getiri.', is_active: true },
  { id: '6', symbol: 'MASFN', asset_name: 'Masfen Enerji A.Ş.', asset_type: 'BIST_HISSE', quantity: 486, unit_cost: 45.68, target_price: 52.00, stop_price: 39.50, risk_score: 7, current_action: 'TUT', rationale: 'F/K ~12.2, HBK 3.58, USD fonksiyonel para avantajı.', is_active: true },
  { id: '7', symbol: 'SARAE', asset_name: 'Sa-Ra Enerji İnşaat Ticaret ve Sanayi A.Ş.', asset_type: 'BIST_HISSE', quantity: 211, unit_cost: 70.00, target_price: 90.00, stop_price: 68.00, risk_score: 8, current_action: 'TUT', rationale: '88-97 bandında kâr al (Fib %23.6 = 88.1).', is_active: true },
  { id: '8', symbol: 'EKIM', asset_name: 'Ekim Turizm Ticaret ve Sanayi A.Ş.', asset_type: 'BIST_HISSE', quantity: 630, unit_cost: 30.26, target_price: 22.00, stop_price: 18.37, risk_score: 10, current_action: 'SAT', rationale: 'HBK -2.06, Beta 2.79. İlk tepkide veya 18.37 dibi kırılırsa acil satış.', is_active: true },
];

/** Yerleşik stratejik kararlar — GİZLİ: yalnız sunucuda durur. */
export const SEED_DECISIONS: Decision[] = [
  { id: 'kr1', symbol: 'TLY', action_type: '2/3 ÇIKIŞ', status: 'onaylandi', target_price: 9900, stop_price: 7250, risk_score: 9, details: 'OZATD aşırı yoğunlaşması sebebiyle 2/3 kâr realizasyonu. Stop 7.250 TL.', created_at: '2026-08-20' },
  { id: 'kr2', symbol: 'BURCE', action_type: 'MERDİVENLİ SAT', status: 'bekliyor', target_price: 53.40, stop_price: 32.50, risk_score: 10, details: 'Zarar eden şirket riskini azaltmak için 36.5-38 / 40.96 / 46.0 / 53.4 kademeleri.', created_at: '2026-08-20' },
  { id: 'kr3', symbol: 'KGM', action_type: 'TUT (25.000 Pay)', status: 'bekliyor', target_price: 3.40, stop_price: 2.60, risk_score: 7, details: 'Gümüş yoğunlaşması azaltıldı, kalan 25.000 pay stop 2.60 ile taşınıyor.', created_at: '2026-08-20' },
  { id: 'kr4', symbol: 'EKIM', action_type: 'İLK TEPKİDE SAT', status: 'bekliyor', target_price: 22.00, stop_price: 18.37, risk_score: 10, details: 'HBK negatif ve beta çok yüksek. 18.37 dip altı acil stop.', created_at: '2026-08-20' },
  { id: 'kr5', symbol: 'NAKIT', action_type: 'NAKİT DAĞITIMI', status: 'bekliyor', risk_score: 3, details: 'Nakit havuzu: %40 TP2, %30 THF hisse fonu, %10 Altın BYF, %20 tampon nakit.', created_at: '2026-08-20' },
  { id: 'kr6', symbol: 'PORTFOY', action_type: 'STOP DÜZELTMELERİ', status: 'onaylandi', risk_score: 5, details: 'Tüm pozisyonlar için tanımlanan stop seviyeleri sisteme işlendi.', created_at: '2026-08-20' },
  { id: 'kr10', symbol: 'TLY', action_type: 'POZİSYON ARTIRMA', status: 'reddedildi', risk_score: 9, details: 'OZATD risk yoğunlaşması nedeniyle pozisyon artırımı kesinlikle reddedildi.', created_at: '2026-08-20' },
];

/** İlk kurulumda DB'ye yazılan başlangıç sermayesi ve serbest nakit. */
export const SEED_INITIAL_CAPITAL = 678000;
export const SEED_CASH_BALANCE = 257706;
