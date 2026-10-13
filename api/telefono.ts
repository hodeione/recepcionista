import { POST as turnoClaude } from './llamada.js'
import { cabecerasCookie, desempaquetar, inicio, peticionDeTwilio, turno, twiml, type EstadoTelefono } from './_lib/telefono.js'

/**
 * POST /api/telefono            Twilio: «A call comes in» (webhook de voz del número)
 * POST /api/telefono?paso=turno Twilio: lo que ha dicho quien llama (SpeechResult)
 *
 * Variables: TWILIO_AUTH_TOKEN (obligatoria, para validar que la petición
 * viene de Twilio), TELEFONO_EQUIPO (a dónde pasar llamadas), TWILIO_VOZ,
 * RESERVAS_N8N_URL y RESERVAS_N8N_CLAVE (sistema de reservas real).
 */

/** Estado de las llamadas en curso en esta instancia; las cookies son la copia de seguridad. */
const enCurso = new Map<string, { estado: EstadoTelefono; hasta: number }>()

function respuesta(cuerpo: string, estado?: EstadoTelefono) {
  const h = new Headers({ 'content-type': 'text/xml; charset=utf-8', 'cache-control': 'no-store' })
  if (estado) for (const c of cabecerasCookie(estado)) h.append('set-cookie', c)
  return new Response(cuerpo, { headers: h })
}

export async function POST(request: Request): Promise<Response> {
  const token = process.env.TWILIO_AUTH_TOKEN ?? ''
  if (!token) return new Response('Falta TWILIO_AUTH_TOKEN', { status: 503 })
  const url = new URL(request.url)
  // Vercel termina el TLS: la URL que firmó Twilio es la pública en https.
  const publica = `https://${request.headers.get('x-forwarded-host') ?? url.host}${url.pathname}${url.search}`
  const params = Object.fromEntries(new URLSearchParams(await request.text())) as Record<string, string>
  if (!peticionDeTwilio(token, publica, params, request.headers.get('x-twilio-signature'))) return new Response('Firma no válida', { status: 403 })

  const base = `https://${request.headers.get('x-forwarded-host') ?? url.host}`
  const llamada = params.CallSid ?? 'desconocida'
  const ent = {
    llamada,
    telefono: params.From,
    // Claude se consulta a través de la misma función que usa la web (mismas instrucciones y límites).
    fetchIA: ((_u: unknown, init?: RequestInit) =>
      turnoClaude(new Request(`${base}/api/llamada`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base, 'x-forwarded-for': `telefono-${llamada}` }, body: init?.body as string }))) as typeof fetch,
  }

  const ahora = Date.now()
  for (const [k, v] of enCurso) if (v.hasta < ahora) enCurso.delete(k)

  const r = url.searchParams.get('paso') === 'turno'
    ? await turno(params.SpeechResult ?? '', enCurso.get(llamada)?.estado ?? desempaquetar(request.headers.get('cookie')), ent)
    : inicio(ent)

  if (r.colgar) enCurso.delete(llamada)
  else enCurso.set(llamada, { estado: r.estado, hasta: ahora + 60 * 60_000 })
  return respuesta(twiml({ texto: r.texto, base, colgar: r.colgar, transferirA: r.transferir ? process.env.TELEFONO_EQUIPO : undefined }), r.estado)
}
