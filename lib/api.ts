/**
 * YATIRIM TERMİNALİ v3.4 — API Yanıt Standartlaşması
 * 
 * Tüm Next.js API route'ları bu helper'ı kullanarak
 * consistent `{ success, data, error }` formatı döndürmelidir.
 */

import { NextResponse } from 'next/server';

/** Başarılı yanıt: { success: true, data, error: null } */
export function apiSuccess<Data = any>(data: Data): NextResponse {
  return new NextResponse(
    JSON.stringify({ success: true, data, error: null }),
    {
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

/** Hata yanıtı: { success: false, error, data: null } */
export function apiError(
  error: string,
  init?: { status?: number; headers?: Record<string, string> }
): NextResponse {
  return new NextResponse(
    JSON.stringify({ success: false, error, data: null }),
    {
      status: init?.status ?? 500,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
    }
  );
}