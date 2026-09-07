/**
 * HIZ SINIRLAYICI TESTLERİ
 *
 * Saat enjekte edilir (opts.now) — gerçek bekleme yok, test deterministik.
 */

import { describe, it, expect } from 'vitest';
import { createRateLimiter, clientKey, retryAfterSeconds } from './rateLimit';

const W = { windowMs: 60_000, limit: 3 };

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('sliding window sayacı', () => {
  it('limit altındaki istekler geçer', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    for (let i = 0; i < 3; i++) {
      expect(rl.check('k', { ...W, now: c.now }).ok).toBe(true);
    }
  });

  it('limiti aşan istek reddedilir', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    rl.check('k', { ...W, now: c.now });
    rl.check('k', { ...W, now: c.now });
    rl.check('k', { ...W, now: c.now });
    const denied = rl.check('k', { ...W, now: c.now });
    expect(denied.ok).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it('reddedilen istek SAYILMAZ — pencere geri kaymaz', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    for (let i = 0; i < 3; i++) rl.check('k', { ...W, now: c.now });
    // 10 kez daha dene — hepsi reddedilmeli ama pencereyi uzatmamalı
    for (let i = 0; i < 10; i++) expect(rl.check('k', { ...W, now: c.now }).ok).toBe(false);
    // Pencere dolunca tekrar açılmalı
    c.advance(60_001);
    expect(rl.check('k', { ...W, now: c.now }).ok).toBe(true);
  });

  it('kalan hak doğru raporlanır', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    expect(rl.check('k', { ...W, now: c.now }).remaining).toBe(2);
    expect(rl.check('k', { ...W, now: c.now }).remaining).toBe(1);
    expect(rl.check('k', { ...W, now: c.now }).remaining).toBe(0);
  });

  it('anahtarlar birbirinden bağımsız', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    for (let i = 0; i < 3; i++) rl.check('a', { ...W, now: c.now });
    expect(rl.check('a', { ...W, now: c.now }).ok).toBe(false);
    expect(rl.check('b', { ...W, now: c.now }).ok).toBe(true);
  });

  it('pencere kısmen dolunca sadece eski istekler düşer', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    rl.check('k', { ...W, now: c.now });          // t0
    c.advance(30_000);
    rl.check('k', { ...W, now: c.now });          // t0+30s
    c.advance(30_000);
    rl.check('k', { ...W, now: c.now });          // t0+60s → t0 düştü
    expect(rl.check('k', { ...W, now: c.now }).ok).toBe(true);
    expect(rl.check('k', { ...W, now: c.now }).ok).toBe(false);
  });

  it('reset sayaçları temizler', () => {
    const c = fakeClock();
    const rl = createRateLimiter();
    for (let i = 0; i < 3; i++) rl.check('k', { ...W, now: c.now });
    expect(rl.check('k', { ...W, now: c.now }).ok).toBe(false);
    rl.reset();
    expect(rl.check('k', { ...W, now: c.now }).ok).toBe(true);
  });

  it('iki limiter örneği durumu paylaşmaz', () => {
    const c = fakeClock();
    const a = createRateLimiter();
    const b = createRateLimiter();
    for (let i = 0; i < 3; i++) a.check('k', { ...W, now: c.now });
    expect(a.check('k', { ...W, now: c.now }).ok).toBe(false);
    expect(b.check('k', { ...W, now: c.now }).ok).toBe(true);
  });
});

describe('clientKey', () => {
  const req = (headers: Record<string, string> = {}) =>
    ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Request;

  it('oturum varsa user id kullanılır (aynı IP iki kullanıcıyı kilitlemez)', () => {
    expect(clientKey(req({ 'x-forwarded-for': '1.2.3.4' }), 'uid-1')).toBe('u:uid-1');
  });

  it('oturum yoksa x-forwarded-for ilk girişi alınır', () => {
    expect(clientKey(req({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' }), null)).toBe('ip:1.2.3.4');
  });

  it('header yoksa "bilinmeyen"e düşer (crash yok)', () => {
    expect(clientKey(req(), null)).toBe('ip:bilinmeyen');
  });
});

describe('retryAfterSeconds', () => {
  it('kalan süreyi saniyeye yukarı yuvarlar', () => {
    expect(retryAfterSeconds(10_000, 8_500)).toBe(2);
  });

  it('sıfır/negatif sürede bile en az 1 döner', () => {
    expect(retryAfterSeconds(1_000, 5_000)).toBe(1);
  });
});
