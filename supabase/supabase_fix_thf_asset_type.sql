-- THF'yi BIST_HISSE yerine TEFAS_FON olarak düzelt
-- Portföyde THF varsa tipi yanlış olabilir (eski ASSET_META'da yoktu)

UPDATE portfolio_positions
SET asset_type = 'TEFAS_FON',
    asset_name = 'Tera Portföy Hisse Senedi (TL) Fonu (Hisse Senedi Yoğun Fon)'
WHERE symbol = 'THF';

-- Kontrol
-- SELECT symbol, asset_name, asset_type, quantity FROM portfolio_positions WHERE symbol = 'THF';
