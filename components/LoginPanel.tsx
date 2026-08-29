'use client';

import React, { useState } from 'react';
import { LogIn, LogOut, FileText } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Props {
  userEmail: string | null;
  onSignedIn: () => void;
  onSignedOut: () => void;
}

/**
 * VERİTABANI OTURUMU PANELİ (giriş / kayıt / çıkış)
 * Ayarlar sekmesinde ve misafir "Giriş" sekmesinde ortak kullanılır.
 * RLS politikaları `TO authenticated` olduğu için oturum açmadan hiçbir veri
 * okunamaz/yazılamaz.
 */
export default function LoginPanel({ userEmail, onSignedIn, onSignedOut }: Props) {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const run = async (mode: 'in' | 'up') => {
    if (!email.trim() || !pass || busy) return;
    setBusy(true);
    setMsg('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) setMsg(`Giriş hatası: ${error.message}`);
        else { setMsg('Oturum açıldı — veriler yükleniyor…'); onSignedIn(); }
      } else {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password: pass });
        if (error) setMsg(`Kayıt hatası: ${error.message}`);
        else if (data.session) { setMsg('Hesap oluşturuldu ve oturum açıldı.'); onSignedIn(); }
        else setMsg('Hesap oluşturuldu. E-posta onayı isteniyorsa kutunuzu kontrol edin (Supabase → Authentication → "Confirm email" kapatılabilir).');
      }
    } catch (e) {
      setMsg(`Hata: ${e instanceof Error ? e.message : 'bilinmiyor'}`);
    } finally {
      setBusy(false);
    }
  };

  if (userEmail) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-3">
        <h3 className="font-bold text-slate-300 flex items-center gap-2 font-mono text-xs">
          <FileText className="w-3.5 h-3.5 text-sky-400" /> VERİTABANI OTURUMU
        </h3>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <span className="text-emerald-400 text-xs font-mono">🟢 {userEmail} — veriler kalıcı olarak saklanıyor.</span>
          <button
            onClick={async () => { await supabase.auth.signOut(); onSignedOut(); }}
            className="bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold px-3 py-1.5 rounded flex items-center gap-1.5 border border-slate-700 text-xs font-mono"
          >
            <LogOut className="w-3 h-3" /> ÇIKIŞ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-3">
      <h3 className="font-bold text-slate-300 flex items-center gap-2 font-mono text-xs">
        <FileText className="w-3.5 h-3.5 text-sky-400" /> VERİTABANI OTURUMU
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="E-posta"
          className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
        />
        <input
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          type="password"
          placeholder="Şifre (min 6)"
          className="bg-slate-950 border border-slate-700 rounded px-3 py-2 text-slate-100 text-xs font-mono focus:outline-none focus:border-sky-500"
        />
      </div>
      <div className="flex gap-2 flex-wrap items-center">
        <button
          onClick={() => run('in')}
          disabled={busy}
          className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded flex items-center gap-1.5 text-xs font-mono"
        >
          <LogIn className="w-3.5 h-3.5" /> GİRİŞ YAP
        </button>
        <button
          onClick={() => run('up')}
          disabled={busy}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-bold px-4 py-2 rounded border border-slate-700 text-xs font-mono"
        >
          HESAP OLUŞTUR
        </button>
        {msg && <span className="text-[11px] text-amber-300 font-mono">{msg}</span>}
      </div>
      <p className="text-[10px] text-slate-500 font-mono">
        Girişten sonra portföyünüz Supabase&apos;ten yüklenir; veritabanı boşsa yerleşik portföy
        sunucu üzerinden (yalnızca size) aktarılır. Şema: supabase/supabase_schema.sql (v2 — auth tabanlı RLS).
      </p>
    </div>
  );
}
