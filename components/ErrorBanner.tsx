'use client';

import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  /** null ise banner gösterilmez. */
  message: string | null;
  onDismiss: () => void;
}

/**
 * P0 — YAZMA HATASI BANNER'I
 *
 * Supabase yazması başarısız olduğunda kullanıcı SESSİZ kalmaz: kırmızı banner
 * "Değişiklikler kaydedilemedi: <sebep>" gösterir. (Eski davranışta hata
 * yalnızca console'a düşerdi ve arayüz kaydedilmiş gibi görünürdü.)
 */
export default function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="border border-rose-700 bg-rose-950/70 text-rose-100 rounded-lg px-4 py-3 flex items-start gap-3 font-mono text-xs"
    >
      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
      <div className="flex-1">
        <div className="font-bold text-rose-300">⚠️ Değişiklikler kaydedilemedi</div>
        <div className="text-rose-200/90 mt-1 break-words">{message}</div>
        <div className="text-rose-300/70 mt-1 text-[10px]">
          Veriler yalnızca bu oturumun belleğinde; sayfayı yenilerseniz kaybolur.
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Uyarıyı kapat"
        className="text-rose-300 hover:text-rose-100 shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
