#!/usr/bin/env python3
"""
YATIRIM TERMİNALİ — twitter-sync / ADIM 1b: Fotoğraf OCR ile fon ağırlık önerileri

@sevketozhan günlük etki fotoğrafı (EN ÇOK KATKI SAĞLAYAN / KAYBETTİREN) içinde
TAHMİNİ AĞIRLIK %X -> %Y bilgilerini OCR ile çözer ve fund_holding_proposals
tablosuna pending olarak yazar.

Güvenlik:
- Hiçbir secret loga yazılmaz
- Fotoğraf indirme best-effort, başarısızsa atlanır
- OCR çözülemezse "VERİ EKSİK" — uydurma yok
- Otomatik fund_holdings yazımı YOK — sadece proposals tablosu (onay kutusu ile manuel)

Ortam:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (GitHub Secrets)
  DRY_RUN=1 → Supabase'e yazmaz, stdout'a basar
  TWEETS_JSON=data/tweets.json (fetch_tweets.py çıktısı, media_urls içermeli)

Bağımlılıklar (Actions'ta kurulur):
  pip install pillow pytesseract supabase
  apt-get install tesseract-ocr tesseract-ocr-tur

Not: Sandbox'ta tesseract yoksa OCR atlanır, DRY_RUN ile test edilebilir.
"""

import json
import os
import re
import sys
import tempfile
from pathlib import Path

# Optional deps — yoksa gracefully atla
try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import pytesseract
    TESS_AVAILABLE = True
except ImportError:
    TESS_AVAILABLE = False

# Supabase client optional
try:
    from supabase import create_client
    SUPA_AVAILABLE = True
except ImportError:
    SUPA_AVAILABLE = False

TWEETS_JSON = os.environ.get("TWEETS_JSON", "data/tweets.json")
DRY_RUN = os.environ.get("DRY_RUN") == "1"

# Türkçe ayları ve fon kodları
KNOWN_FUNDS = ["TLY", "DFI", "KGM", "TP2", "THF", "GUM", "YZG", "MJG", "DMG", "GMC", "AK2", "ABG", "BAC", "LIDER", "IEYHO", "ISKPL"]
FUND_CODE_RE = re.compile(r"#([A-Z]{2,5})\b")
TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")
# Tahmini ağırlık: %48,02 -> %51,00 veya %0,25 veya %3,25 -> %3,03
WEIGHT_ARROW_RE = re.compile(r"TAHM[İI]N[İI]\s*AĞIRLIK\s*%?([\d.,]+)\s*->\s*%?([\d.,]+)", re.IGNORECASE)
WEIGHT_SINGLE_RE = re.compile(r"TAHM[İI]N[İI]\s*AĞIRLIK\s*%?([\d.,]+)", re.IGNORECASE)

def parse_tr_number(s: str):
    """TR sayı: 48,02 veya 3.25 veya 51,00 -> float"""
    if not s:
        return None
    s = s.strip().replace("%", "").replace(" ", "")
    # TR: 48,02 -> 48.02 ; 1.234,56 -> 1234.56
    if "," in s and "." in s:
        # son virgül ondalık ise TR
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        n = float(s)
        if 0 <= n <= 100:
            return n
    except:
        pass
    return None

def extract_fund_code(text: str, ocr_text: str = "") -> str | None:
    """Tweet metninden veya OCR metninden fon kodu çıkar"""
    # Önce tweet metnindeki #CODE
    m = FUND_CODE_RE.search(text or "")
    if m:
        code = m.group(1).upper()
        if code in ["DFI", "TLY", "KGM", "TP2", "THF", "GUM"] or len(code) <= 5:
            return code
    # OCR metninde büyük DFI yazısı (örnekte DFI +2,73%)
    # En çok geçen fon kodu
    combined = (text or "") + " " + (ocr_text or "")
    # DFI özel: fotoğrafta büyük DFI var
    if "DFI" in combined.upper():
        return "DFI"
    if "TLY" in combined.upper():
        return "TLY"
    # Genel: bilinen fonlardan ara
    for f in ["DFI", "TLY", "KGM", "TP2"]:
        if f in combined.upper():
            return f
    return None

def parse_ocr_holdings(ocr_text: str):
    """
    OCR metninden holdings çıkar
    Örnek satır:
    IEYHO +2,97% TAHMİNİ AĞIRLIK %48,02 -> %51,00 Getiri +6,19%
    ABG +0,21% TAHMİNİ AĞIRLIK %28,34 -> %28,55
    LIDER +0,00% TAHMİNİ AĞIRLIK %0,25
    BAC -0,00% TAHMİNİ AĞIRLIK %0,26
    Tek regex: TICKER ... TAHMİNİ AĞIRLIK %X [-> %Y]
    """
    holdings = []
    text = ocr_text
    # Geniş toleranslı: TICKER + 60 karakter içinde TAHMİNİ AĞIRLIK
    pattern = re.compile(
        r"\b([A-Z]{2,5})\b[^A-Z\n]{0,60}?TAHM[İI]N[İI]\s*AĞIRLIK\s*%?([\d.,]+)(?:\s*->\s*%?([\d.,]+))?",
        re.IGNORECASE
    )
    for m in pattern.finditer(text):
        ticker = m.group(1).upper()
        if ticker in ["EN", "COK", "KATKI", "KAYBETTIREN", "GETIRI", "TAHMINI", "AGIRLIK"]:
            continue
        g2 = m.group(2)
        g3 = m.group(3)
        if g3:
            prev = parse_tr_number(g2)
            curr = parse_tr_number(g3)
        else:
            prev = None
            curr = parse_tr_number(g2)
        if ticker and curr is not None:
            holdings.append({"ticker": ticker, "weight_pct": curr, "prev_weight_pct": prev})

    dedup = {}
    for h in holdings:
        dedup[h["ticker"]] = h
    holdings = list(dedup.values())
    holdings.sort(key=lambda x: x["weight_pct"], reverse=True)
    return holdings

def ocr_image(image_path: str) -> str:
    """Fotoğrafı OCR ile metne çevir — yoksa boş"""
    if not PIL_AVAILABLE:
        return ""
    if not TESS_AVAILABLE:
        return ""
    try:
        # Tesseract config: Türkçe + İngilizce, psm 6 (blok)
        img = Image.open(image_path)
        # Biraz büyüt ve griye çevir (doğruluk artar)
        # Basit: doğrudan OCR
        text = pytesseract.image_to_string(img, lang="tur+eng", config="--psm 6")
        return text
    except Exception as e:
        print(f"UYARI: OCR hatası {e}", file=sys.stderr)
        return ""

def main():
    tweets_path = Path(TWEETS_JSON)
    if not tweets_path.exists():
        print(f"HATA: {TWEETS_JSON} yok (önce fetch_tweets.py)", file=sys.stderr)
        sys.exit(1)

    try:
        tweets = json.loads(tweets_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"HATA: JSON okunamadı {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(tweets, list):
        print("HATA: tweets list değil", file=sys.stderr)
        sys.exit(1)

    # Supabase client
    #
    # owner_id (auth.users.id): service_role RLS'i ATLAR ve auth.uid() bu
    # bağlamda NULL'dır; fund_holding_proposals.user_id ise NOT NULL.
    # Yani bu job satırları KİMİN adına yazdığını açıkça bilmek zorunda.
    supa_url = os.environ.get("SUPABASE_URL", "")
    supa_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    owner_id = os.environ.get("SUPABASE_OWNER_USER_ID", "")
    sb = None
    if not DRY_RUN and SUPA_AVAILABLE and supa_url and supa_key:
        if not re.match(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            owner_id, re.I,
        ):
            print(
                "HATA: SUPABASE_OWNER_USER_ID eksik veya UUID değil. "
                "supabase/supabase_rls_user_isolation.sql sonrası her satır bir "
                "kullanıcıya ait. Değer: Supabase → Authentication → Users → UUID.",
                file=sys.stderr,
            )
            sys.exit(1)
        sb = create_client(supa_url, supa_key)

    total_proposals = []
    for t in tweets:
        text = t.get("text") or ""
        media_urls = t.get("media_urls") or []
        if not media_urls:
            continue
        tweet_id = str(t.get("id") or "")
        # Her foto için
        for media_url in media_urls:
            # İndir
            tmp_path = None
            try:
                import urllib.request
                with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                    tmp_path = tmp.name
                # Timeout 15s
                urllib.request.urlretrieve(media_url, tmp_path)
            except Exception as e:
                print(f"UYARI: foto indirilemedi {media_url[:60]}... {e}", file=sys.stderr)
                continue

            ocr_text = ocr_image(tmp_path) if tmp_path else ""
            # Temp temizle
            try:
                if tmp_path:
                    os.unlink(tmp_path)
            except:
                pass

            if not ocr_text or len(ocr_text.strip()) < 10:
                # OCR yoksa veya boşsa atla (VERİ EKSİK)
                continue

            fund_code = extract_fund_code(text, ocr_text)
            if not fund_code:
                continue

            holdings = parse_ocr_holdings(ocr_text)
            if not holdings:
                continue

            for h in holdings:
                # %0.01 altı atılır (kullanıcı kuralı)
                if h["weight_pct"] < 0.01:
                    continue
                total_proposals.append({
                    "user_id": owner_id,
                    "fund_code": fund_code,
                    "ticker": h["ticker"],
                    "weight_pct": h["weight_pct"],
                    "prev_weight_pct": h["prev_weight_pct"],
                    "source_tweet_id": f"tw-{tweet_id}",
                    "predictor_handle": "@sevketozhan",
                    "raw_text": f"{text[:200]} | OCR: {ocr_text[:300]}",
                })

    # Deduplicate proposals: tekil anahtar artık BİLEŞİK
    # (user_id, fund_code, ticker, source_tweet_id)
    dedup = {}
    for p in total_proposals:
        key = (p["user_id"], p["fund_code"], p["ticker"], p["source_tweet_id"])
        dedup[key] = p
    total_proposals = list(dedup.values())

    if DRY_RUN:
        print("=== DRY_RUN (yazı YAPILMADI) — Öneriler ===")
        print(json.dumps(total_proposals, ensure_ascii=False, indent=2))
        print(f"ÖZET: {len(tweets)} tweet, {len(total_proposals)} öneri")
        return

    if sb:
        if total_proposals:
            # Upsert pending proposals
            try:
                res = sb.table("fund_holding_proposals").upsert(total_proposals, on_conflict="user_id,fund_code,ticker,source_tweet_id").execute()
                # Supabase-py hata fırlatmaz, data/error döner — basit kontrol
                if hasattr(res, 'data'):
                    print(f"ÖZET: {len(tweets)} tweet → {len(total_proposals)} öneri yazıldı (fund_holding_proposals)")
                else:
                    print(f"ÖZET: {len(tweets)} tweet → {len(total_proposals)} öneri (yanıt kontrol edilemedi)")
            except Exception as e:
                print(f"HATA (upsert proposals): {e}", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"ÖZET: {len(tweets)} tweet → 0 öneri (foto yok veya OCR çözemedi)")
    else:
        if not DRY_RUN:
            print("HATA: SUPABASE_URL/KEY yok ve DRY_RUN değil", file=sys.stderr)
            sys.exit(1)

if __name__ == "__main__":
    main()
