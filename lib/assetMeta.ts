/**
 * VARLIK TÜRÜ ETİKETLERİ (jenerik — portföy bilgisi içermez)
 *
 * DİKKAT: Kanonik varlık ADLARI ve kodları (ASSET_META) portföyü ele verdiği
 * için SUNUCU-ÖZEL dosyada durur (lib/serverSeed.ts) ve arayüze
 * /api/asset-meta üzerinden, oturum doğrulanarak gelir.
 */

export const TÜR_LABEL: Record<string, string> = {
  BIST_HISSE: 'BİST HİSSE',
  TEFAS_FON: 'TEFAS FON',
  PPF: 'PARA PİYASASI',
  EMTIA_ETF: 'EMTİA ETF',
};
