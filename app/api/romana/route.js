import { NextResponse } from 'next/server';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzYlgUhYz8qMIA1zKGnPSwj1YBxHWzGRajJS-KUPyVS3uCghY1OUHmu1XHAXYzdLFyXNQ/exec';

async function callAppsScript(payload) {
  const body = JSON.stringify(payload);

  const response = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: body,
    redirect: 'follow',
  });

  const text = await response.text();

  // Intentar parsear como JSON directamente
  try {
    return JSON.parse(text);
  } catch {
    // Apps Script a veces responde con HTML redirect (302)
    if (text.includes('<HTML>') || text.includes('Moved Temporarily')) {
      const match = text.match(/HREF="([^"]+)"/);
      if (match) {
        const redirectUrl = match[1].replace(/&amp;/g, '&');
        const res2 = await fetch(redirectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: body,
        });
        const text2 = await res2.text();
        try {
          return JSON.parse(text2);
        } catch {
          return { ok: false, error: 'Respuesta no JSON del servidor', debug: text2.slice(0, 200) };
        }
      }
    }
    return { ok: false, error: 'Error de comunicacion', debug: text.slice(0, 200) };
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (!body.action) {
      return NextResponse.json({ ok: false, error: 'Falta action' }, { status: 400 });
    }

    const result = await callAppsScript(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}