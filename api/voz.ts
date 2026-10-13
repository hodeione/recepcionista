import { Limitador, origenPermitido } from './_lib/agente.js'
import { MAX_CARACTERES, firmaValida, peticionVoz, proveedor } from './_lib/voz.js'

/**
 * POST /api/voz  { texto }  → audio/mpeg  (desde la web)
 * GET  /api/voz?t=…&f=…     → audio/mpeg  (enlace firmado, para Twilio)
 * GET  /api/voz             → { configured, proveedor }
 */

// Una frase por petición: 150 por IP cada 10 minutos y 3.000 por hora en total por instancia.
const limitador = new Limitador(150, 10 * 60_000, 3000, 60 * 60_000)

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

async function sintetizar(texto: string, cache: string): Promise<Response> {
  const p = proveedor()
  if (!p) return json(503, { error: 'La voz realista no está activada.', codigo: 'sin_clave' })
  const { url, init } = peticionVoz(texto, p)
  let res: Response
  try {
    res = await fetch(url, init)
  } catch {
    return json(502, { error: 'El servicio de voz no responde.', codigo: 'red' })
  }
  if (!res.ok || !res.body) {
    const codigo = res.status === 401 ? 'sin_clave' : res.status === 429 || res.status === 402 ? 'sin_saldo' : 'voz'
    return json(502, { error: 'El servicio de voz ha fallado.', codigo, estado: res.status })
  }
  // El audio pasa tal cual, en streaming: empieza a sonar antes de terminar de generarse.
  return new Response(res.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': cache } })
}

export async function GET(request: Request): Promise<Response> {
  const u = new URL(request.url)
  const t = u.searchParams.get('t')
  if (t === null) return json(200, { configured: proveedor() !== null, proveedor: proveedor() })
  const f = u.searchParams.get('f') ?? ''
  if (t.length > MAX_CARACTERES || !firmaValida(t, f)) return json(403, { error: 'Enlace no válido.' })
  // Mismo texto, mismo audio: el saludo y las frases fijas se sirven desde la caché de Vercel.
  return sintetizar(t, 'public, max-age=86400, s-maxage=2592000, immutable')
}

export async function POST(request: Request): Promise<Response> {
  if (!origenPermitido(request.headers.get('origin'), request.headers.get('host'))) return json(403, { error: 'Origen no permitido.' })
  let texto = ''
  try {
    const b = (await request.json()) as { texto?: unknown }
    texto = typeof b.texto === 'string' ? b.texto.trim() : ''
  } catch {
    return json(400, { error: 'Petición no válida.' })
  }
  if (!texto || texto.length > MAX_CARACTERES) return json(400, { error: 'Texto vacío o demasiado largo.' })
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim() || 'desconocida'
  if (!limitador.comprobar(ip).ok) return json(429, { error: 'Demasiadas peticiones de voz.', codigo: 'limite' })
  return sintetizar(texto, 'no-store')
}
