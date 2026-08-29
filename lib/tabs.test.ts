/**
 * P1 — MİSAFİR MODU: SEKME GÖRÜNÜRLÜĞÜ
 * Misafir yalnızca Piyasa + Giriş görür; portföyle ilgili hiçbir sekme görünmez.
 */

import { describe, it, expect } from 'vitest';
import { GUEST_TABS, USER_TABS, PRIVATE_TAB_IDS, tabsFor } from './tabs';

describe('misafir sekmeleri', () => {
  it('yalnızca Piyasa ve Giriş', () => {
    expect(GUEST_TABS.map((t) => t.id)).toEqual(['market', 'login']);
  });

  it('portföy sekmelerinin HİÇBİRİ misafirde yok', () => {
    const guestIds = GUEST_TABS.map((t) => t.id);
    for (const id of ['dashboard', 'analysis', 'portfolio', 'funds', 'decisions', 'ledger', 'cash', 'social', 'settings']) {
      expect(guestIds).not.toContain(id as never);
    }
  });

  it('giriş sekmesi misafirde var (CTA hedefi)', () => {
    expect(GUEST_TABS.map((t) => t.id)).toContain('login');
  });
});

describe('girişli kullanıcı sekmeleri', () => {
  it('9 sekme: Ana Panel … Ayarlar (Fon İçeriği dahil)', () => {
    expect(USER_TABS).toHaveLength(9);
    expect(USER_TABS.map((t) => t.id)).toContain('funds');
    expect(USER_TABS.map((t) => t.id)).toContain('portfolio');
  });

  it('girişli listede market/login yok', () => {
    const ids = USER_TABS.map((t) => t.id);
    expect(ids).not.toContain('market');
    expect(ids).not.toContain('login');
  });

  it('PRIVATE_TAB_IDS tüm girişli sekmeleri kapsar', () => {
    expect(PRIVATE_TAB_IDS).toEqual(USER_TABS.map((t) => t.id));
  });
});

describe('tabsFor', () => {
  it('misafir → 2 sekme, girişli → 9 sekme', () => {
    expect(tabsFor(true)).toHaveLength(2);
    expect(tabsFor(false)).toHaveLength(9);
  });

  it('iki liste ayrık (kesişim boş)', () => {
    const guest = new Set(GUEST_TABS.map((t) => t.id));
    const overlap = USER_TABS.filter((t) => guest.has(t.id));
    expect(overlap).toEqual([]);
  });
});
