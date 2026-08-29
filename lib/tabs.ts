/**
 * SEKME TANIMLARI (P1 — misafir/girişli ayrımının TEK KAYNAĞI)
 *
 * Misafir yalnızca Piyasa + Giriş görür. Portföy, Fon İçeriği, Kararlar,
 * İşlem Günlüğü, Kasa, Sosyal Doğrulama ve Ayarlar YALNIZCA girişli kullanıcıya
 * gösterilir.
 */

export type TabId =
  | 'market' | 'login'
  | 'dashboard' | 'analysis' | 'portfolio' | 'funds' | 'decisions'
  | 'ledger' | 'cash' | 'social' | 'settings';

export interface TabDef {
  id: TabId;
  label: string;
}

/** Misafire gösterilen sekmeler (salt okunur, DB yazması yok). */
export const GUEST_TABS: TabDef[] = [
  { id: 'market', label: '📈 Piyasa' },
  { id: 'login', label: '🔐 Giriş' },
];

/** Girişli kullanıcıya gösterilen sekmeler. */
export const USER_TABS: TabDef[] = [
  { id: 'dashboard', label: '📊 Ana Panel' },
  { id: 'analysis', label: '🔍 Analiz Merkezi' },
  { id: 'portfolio', label: '💼 Portföy' },
  { id: 'funds', label: '🧬 Fon İçeriği' },
  { id: 'decisions', label: '📋 Kararlar (Hub)' },
  { id: 'ledger', label: '📜 İşlem Günlüğü' },
  { id: 'cash', label: '🏦 Kasa' },
  { id: 'social', label: '📱 Sosyal Doğrulama' },
  { id: 'settings', label: '⚙️ Ayarlar & DB' },
];

/** Giriş gerektiren sekmeler (misafire asla gösterilmez). */
export const PRIVATE_TAB_IDS: TabId[] = USER_TABS.map((t) => t.id);

export function tabsFor(isGuest: boolean): TabDef[] {
  return isGuest ? GUEST_TABS : USER_TABS;
}
