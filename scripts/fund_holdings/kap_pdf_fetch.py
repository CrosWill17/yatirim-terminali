#!/usr/bin/env python3
"""
KAP PDF otomatik çekme — TLY ve THF Portföy Dağılım Raporları

- kap-client kullanarak KAP'tan son Portföy Dağılım Raporlarını çeker
- PDF'leri data/kap_pdfs/ klasörüne indirir
- Java serialization wrapper'ı çözer (KAP API quirki)
- Sonra Node tarafında kap_pdf_upsert.ts ile parse edilip Supabase'e yazılır

Çalıştırma:
  pip install kap-client httpx
  python scripts/fund_holdings/kap_pdf_fetch.py

GitHub Actions: kap-pdf-sync.yml içinde otomatik çalışır
"""

import os
import sys
import struct
from pathlib import Path
from datetime import datetime

# KAP client import - yoksa uyar
try:
    from kap_client import Kap, FundGroup, FundSubject
except ImportError:
    print("HATA: kap-client yüklü değil. pip install kap-client")
    sys.exit(1)

import httpx

DATA_DIR = Path("data/kap_pdfs")
DATA_DIR.mkdir(parents=True, exist_ok=True)

TARGET_FUNDS = ["TLY", "THF"]
DAYS_BACK = 30  # son 30 günde yayınlanan raporlar

def extract_pdf_from_java_bytes(raw: bytes) -> bytes:
    """
    KAP /tr/api/file/download/{objId} endpoint'i Java-serialized byte[] döndürür
    Format: AC ED 00 05 75 ... 78 70 <4 byte len> <PDF bytes>
    """
    try:
        # Java serialization magic AC ED 00 05 kontrol
        if raw[:4] == b'\xac\xed\x00\x05':
            idx = raw.find(b'\x78\x70', 10)
            if idx != -1 and idx + 6 <= len(raw):
                arr_len = struct.unpack('>I', raw[idx+2:idx+6])[0]
                pdf_bytes = raw[idx+6:idx+6+arr_len]
                if pdf_bytes.startswith(b'%PDF'):
                    return pdf_bytes
                # Fallback: PDF header ara
                pdf_start = raw.find(b'%PDF')
                if pdf_start != -1:
                    return raw[pdf_start:]
        # Zaten düz PDF ise
        if raw.startswith(b'%PDF'):
            return raw
        # Son çare: içinde %PDF ara
        pdf_start = raw.find(b'%PDF')
        if pdf_start != -1:
            return raw[pdf_start:]
        return raw
    except Exception as e:
        print(f"  Java unwrap hatası: {e}, ham boyutu {len(raw)}")
        return raw

def download_attachment(url: str, dest: Path) -> bool:
    headers = {
        "Referer": "https://www.kap.org.tr/tr/bildirim-sorgu",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
    try:
        with httpx.Client(timeout=30, headers=headers, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            raw = resp.content
            pdf_bytes = extract_pdf_from_java_bytes(raw)
            if not pdf_bytes.startswith(b'%PDF'):
                print(f"  UYARI: indirilen dosya PDF değil (ilk 20 byte: {pdf_bytes[:20]})")
                # Yine de kaydet, belki parse edilir
            dest.write_bytes(pdf_bytes)
            print(f"  İndirildi: {dest} ({len(pdf_bytes)} byte)")
            return True
    except Exception as e:
        print(f"  İndirme hatası {url}: {e}")
        return False

def main():
    print(f"=== KAP PDF Fetch — {datetime.now().isoformat()} ===")
    print(f"Hedef fonlar: {TARGET_FUNDS}, son {DAYS_BACK} gün")

    fetched = []

    with Kap() as kap:
        # Fon listesini çek (Yatırım Fonları)
        print("Fon listesi çekiliyor (YF)...")
        try:
            funds = kap.fetch_funds(FundGroup.YATIRIM_FONLARI)
        except Exception as e:
            print(f"HATA: fon listesi alınamadı: {e}")
            sys.exit(1)

        fund_map = {f.code: f for f in funds}
        print(f"Toplam {len(funds)} YF fon bulundu")

        for code in TARGET_FUNDS:
            fund = fund_map.get(code)
            if not fund:
                print(f"UYARI: {code} fonu listede yok, atlanıyor")
                continue

            print(f"\n[{code}] OID={fund.oid} için Portföy Dağılım Raporu aranıyor...")
            try:
                disclosures = kap.fetch_fund_disclosures_by_filter(
                    fund_oid=fund.oid,
                    subject_oid=FundSubject.PORTFOY_DAGILIM_RAPORU.value,
                    days=DAYS_BACK,
                )
            except Exception as e:
                print(f"  HATA: disclosure fetch: {e}")
                continue

            if not disclosures:
                print(f"  Sonuç yok (son {DAYS_BACK} günde rapor yayınlanmamış olabilir)")
                continue

            print(f"  {len(disclosures)} rapor bulundu, en yeni 3 gösteriliyor:")
            for d in disclosures[:3]:
                print(f"    - {d.publish_datetime} | {d.subject} | idx={d.index}")

            # En yeni raporu al
            latest = disclosures[0]
            print(f"  En yeni: {latest.publish_datetime} — {latest.subject}")

            try:
                attachments = kap.fetch_attachments(latest.index)
            except Exception as e:
                print(f"  Attachment fetch hatası: {e}")
                continue

            if not attachments:
                print(f"  Attachment yok")
                continue

            for att in attachments:
                # Sadece PDF'leri al
                if not att.filename.lower().endswith('.pdf'):
                    continue
                # Dosya adı: TLY_2026_08.pdf gibi
                safe_name = f"{code}_{latest.publish_datetime.strftime('%Y_%m_%d')}_{att.filename}"
                dest = DATA_DIR / safe_name
                # Zaten varsa atla (aynı gün)
                if dest.exists() and dest.stat().st_size > 1000:
                    print(f"  Zaten var, atlanıyor: {dest}")
                    fetched.append(str(dest))
                    continue

                print(f"  İndiriliyor: {att.filename} → {att.url}")
                if download_attachment(att.url, dest):
                    fetched.append(str(dest))

    print(f"\n=== ÖZET ===")
    print(f"İndirilen/yeni: {len(fetched)} dosya")
    for f in fetched:
        print(f"  {f}")

    # GitHub Actions için output
    if fetched:
        # Son indirilenleri bir dosyaya yaz (sonraki adım için)
        Path("data/kap_pdfs/latest.txt").write_text("\n".join(fetched))
        print(f"\nlatest.txt yazıldı")

    # Başarı: en az 1 dosya veya hiç yeni rapor yoksa da OK (KAP haftalık)
    print("\nKAP PDF fetch tamamlandı")

if __name__ == "__main__":
    main()
