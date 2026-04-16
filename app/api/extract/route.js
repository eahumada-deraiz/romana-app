import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { pdf_base64 } = await request.json();

    if (!pdf_base64) {
      return NextResponse.json({ error: 'No PDF data' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API key no configurada en servidor' }, { status: 500 });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: pdf_base64,
                },
              },
              {
                type: 'text',
                text: `Extrae datos de este ticket/informe de pesaje. Responde SOLO con JSON puro, sin backticks, sin markdown, sin texto adicional:

{
  "informe_n": "numero del informe",
  "fecha": "DD/MM/YYYY",
  "patente": "patente vehiculo",
  "conductor": "nombre conductor",
  "observaciones": "tipo de residuo (de campo observaciones)",
  "empresa_raw": "texto COMPLETO y EXACTO del campo Empresa",
  "peso_bruto_entrada": 0,
  "peso_bruto_salida": 0,
  "peso_neto_kg": 0,
  "fecha_hora_entrada": "DD/MM/YYYY HH:MM:SS",
  "fecha_hora_salida": "DD/MM/YYYY HH:MM:SS",
  "numero_ticket_entrada": "numero",
  "numero_ticket_salida": "numero"
}

REGLAS:
- Pesos en KG como numeros enteros
- empresa_raw: copia EXACTA del campo Empresa del PDF, sin modificar
- Si un campo no existe, pon string vacio "" o 0 segun corresponda
- fecha en formato DD/MM/YYYY`
              },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || 'Error API Anthropic' },
        { status: response.status }
      );
    }

    const text = data.content
      ?.filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      return NextResponse.json({ ok: true, data: parsed });
    } catch {
      return NextResponse.json(
        { error: 'No se pudo parsear respuesta', raw: text?.slice(0, 300) },
        { status: 500 }
      );
    }
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
