'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface Props {
  masked: boolean;
  onToggle: () => void;
}

/**
 * P2 — GİZLİLİK MASKESİ BUTONU (👁)
 * Tek tık: ekrandaki tüm TL tutar/adetler ** olur. Durum localStorage'da kalıcı.
 */
export default function PrivacyToggle({ masked, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      title={masked ? 'Gizlilik maskesi AÇIK — değerleri göster' : 'Gizlilik maskesi KAPALI — TL tutarlarını ve adetleri gizle'}
      aria-pressed={masked}
      aria-label={masked ? 'Gizlilik maskesini kapat' : 'Gizlilik maskesini aç'}
      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-mono font-bold transition-colors ${
        masked
          ? 'bg-violet-950 text-violet-300 border-violet-700 hover:bg-violet-900'
          : 'bg-slate-900 text-slate-400 border-slate-700 hover:text-slate-200'
      }`}
    >
      {masked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      {masked ? 'GİZLİ' : 'GÖSTER'}
    </button>
  );
}
