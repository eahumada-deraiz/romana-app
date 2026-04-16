import { NextResponse } from 'next/server';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbylxIflniEH9FNg__KIPW7Ated9RaUNzIEiE_mHm9jg08akdH8QbfRs0CErlaLHnJwz6w/exec';

export async function POST(request) {
  try {
    const body = await request.json();

    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'registrar_pesaje',
        data: body.data,
        pdf_base64: body.pdf_base64 || null,
        pdf_nombre: body.pdf_nombre || 'ticket.pdf',
      }),
      redirect: 'follow',
    });

    // Apps Script redirects, so we need to follow
    const text = await response.text();
    
    try {
      const result = JSON.parse(text);
      return NextResponse.json(result);
    } catch {
      // Sometimes Apps Script returns HTML on redirect
      // Try fetching the redirected URL
      if (text.includes('Moved Temporarily') || text.includes('<HTML>')) {
        return NextResponse.json({ ok: false, error: 'Apps Script redirect issue. Verifica que el deploy sea accesible.' });
      }
      return NextResponse.json({ ok: true, mensaje: 'Enviado' });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
