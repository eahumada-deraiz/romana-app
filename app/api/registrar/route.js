import { NextResponse } from 'next/server';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYlgUhYz8qMIA1zKGnPSwj1YBxHWzGRajJS-KUPyVS3uCghY1OUHmu1XHAXYzdLFyXNQ/exec';

export async function POST(request) {
  try {
    const body = await request.json();

    const payload = JSON.stringify({
      action: 'registrar_pesaje',
      data: body.data,
      pdf_base64: body.pdf_base64 || null,
      pdf_nombre: body.pdf_nombre || 'ticket.pdf',
    });

    // Apps Script always redirects POST requests (302)
    // We need to handle this manually
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: payload,
      redirect: 'follow',
    });

    const text = await response.text();

    // Try to parse as JSON
    try {
      const result = JSON.parse(text);
      return NextResponse.json(result);
    } catch {
      // If we got HTML back, the redirect wasn't followed properly
      // Try manual redirect approach
      if (text.includes('<HTML>') || text.includes('Moved Temporarily')) {
        // Extract redirect URL
        const match = text.match(/HREF="([^"]+)"/);
        if (match) {
          const redirectUrl = match[1].replace(/&amp;/g, '&');
          const res2 = await fetch(redirectUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: payload,
          });
          const text2 = await res2.text();
          try {
            const result2 = JSON.parse(text2);
            return NextResponse.json(result2);
          } catch {
            return NextResponse.json({ ok: true, mensaje: 'Enviado (redirect)', raw: text2.slice(0, 200) });
          }
        }
      }
      return NextResponse.json({ ok: true, mensaje: 'Enviado', debug: text.slice(0, 300) });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
