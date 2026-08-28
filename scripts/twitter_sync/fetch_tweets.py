#!/usr/bin/env python3
"""
YATIRIM TERMİNALİ — twitter-sync / ADIM 1: Tweetleri Çek

twitter-cli (Python) ile @handle'ın son N tweetini çeker, YAML çıktısını
data/tweets.json dosyasına yazar. Node tarafındaki sync.ts bu dosyayı okur.

Çevre değişkenleri (GitHub Actions secrets'tan gelir):
  TWITTER_AUTH_TOKEN   (zorunlu)
  TWITTER_CT0          (opsiyonel)
  TWITTER_SYNC_HANDLE  (varsayılan: sevketozhan)
  TWITTER_SYNC_COUNT   (varsayılan: 50)

GÜVENLİK (Rule 2): Hiçbir kimlik bilgisi log'a / çıktıya yazılmaz.
  - stdout'a yalnızca adet ve dosya yolu yazılır.
  - twitter-cli hata verirse stderr içeriği BASTIRILIR (token sızıntısı riski).
"""

import json
import os
import subprocess
import sys

try:
    import yaml
except ImportError:  # pyyaml eksik
    print("HATA: pyyaml eksik — 'pip install pyyaml' (workflow'da otomatik kurulur).", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    handle = os.environ.get("TWITTER_SYNC_HANDLE", "sevketozhan").strip().lstrip("@")
    count = int(os.environ.get("TWITTER_SYNC_COUNT", "50"))

    if not os.environ.get("TWITTER_AUTH_TOKEN"):
        print("HATA: TWITTER_AUTH_TOKEN tanımlı değil (GitHub Secrets).", file=sys.stderr)
        sys.exit(2)

    # Kullanıcı doğruladı: 'twitter user-posts <handle> -n <N>' → YAML çıktı.
    # 'twitter search' KULLANILMAZ (HTTP 404).
    cmd = ["twitter", "user-posts", handle, "-n", str(count)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except FileNotFoundError:
        print("HATA: 'twitter' CLI bulunamadı — 'pip install twitter-cli' gerekli.", file=sys.stderr)
        sys.exit(3)
    except subprocess.TimeoutExpired:
        print("HATA: twitter-cli 120 sn içinde yanıt vermedi.", file=sys.stderr)
        sys.exit(3)

    if proc.returncode != 0:
        # Kural 2: stderr içeriği log'a yazılmaz (kimlik bilgisi içerebilir).
        print(
            f"HATA: twitter-cli çıktı kodu {proc.returncode} ile bitti "
            "(detay gizlendi — secret sızıntısı riski; yerel debug için elle çalıştırın).",
            file=sys.stderr,
        )
        sys.exit(4)

    try:
        data = yaml.safe_load(proc.stdout)
    except yaml.YAMLError:
        print("HATA: twitter-cli çıktısı YAML olarak çözülemedi.", file=sys.stderr)
        sys.exit(5)

    # Yapı toleransı: liste ya da {tweets: [...]} / {statuses: [...]} olabilir.
    if isinstance(data, list):
        raw_tweets = data
    elif isinstance(data, dict):
        raw_tweets = data.get("tweets") or data.get("statuses") or data.get("results") or []
    else:
        raw_tweets = []

    if not isinstance(raw_tweets, list) or not raw_tweets:
        keys = list(data.keys()) if isinstance(data, dict) else type(data).__name__
        print(f"HATA: Tweet listesi bulunamadı. Yapı anahtarları: {keys}", file=sys.stderr)
        sys.exit(6)

    out = []
    for t in raw_tweets:
        if not isinstance(t, dict):
            continue
        tweet_id = str(t.get("id") or t.get("tweet_id") or t.get("id_str") or "")
        text = t.get("text") or t.get("full_text") or ""
        created_at = t.get("created_at") or t.get("timestamp") or ""
        if tweet_id and text:
            out.append({"id": tweet_id, "text": text, "created_at": created_at})

    os.makedirs("data", exist_ok=True)
    with open("data/tweets.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # stdout: yalnızca sayı ve dosya (secret YOK)
    print(f"OK: {len(out)} tweet çekildi → data/tweets.json")
    if not out:
        print("UYARI: Tweet listesi boş (kimlik doğrulama mı?)", file=sys.stderr)
        sys.exit(7)


if __name__ == "__main__":
    main()
