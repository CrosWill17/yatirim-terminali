/**
 * Sunucu tarafı Supabase istemcisi (API route'lar için).
 * Aynı NEXT_PUBLIC_ değişkenlerini kullanır — service_role anahtarı
 * bu projede HİÇBİR yerde kullanılmaz (RLS bilinçli olarak atlanmaz).
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured } from './supabase';

export function createServerSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/** Authorization: Bearer <access_token> başlığından doğrulanmış kullanıcıyı çözer. */
export async function getUserFromRequest(req: Request): Promise<{ id: string; email?: string } | null> {
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const client = createServerSupabase();
  if (!client) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}
