import { createHmac, timingSafeEqual } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { DateTime } from 'luxon'
import { ErrorIA, MotorClaude } from '../../src/lib/dialogo/claude.js'
import { MotorLocal } from '../../src/lib/dialogo/local.js'
import type { Evento } from '../../src/lib/dialogo/tipos.js'
import { TABERNA_LUNA, type Negocio } from '../../src/lib/negocio.js'
import { ConectorLocal, almacenEnMemoria, reservasDemo, type Conector } from '../../src/lib/reservas/conector.js'
import type { Reserva } from '../../src/lib/reservas/motor.js'
import { ConectorN8n } from '../../src/lib/reservas/n8n.js'
import { paraVoz } from '../../src/lib/voz/sintesis.js'
import { firmar, proveedor } from './voz.js'

/**
 * La recepcionista en una línea de teléfono real con Twilio, sin servidor
 * propio: Twilio transcribe lo que dice quien llama (<Gather input="speech">)
 * y en cada turno llama a esta función, que decide la respuesta con el mismo
 * motor que la web y contesta con TwiML (voz realista con <Play> o voz
 * neuronal de Twilio con <Say>). El estado de la llamada viaja en cookies,
 * que Twilio conserva durante toda la llamada.
 */

export interface EstadoTelefono {
  v: 1
  motor: 'local' | 'claude'
  datos: unknown
  /** Reservas creadas o canceladas en esta llamada (para el conector de demostración). */
  cambios: Reserva[]
  silencios: number
}

/* ------------------------------------------------------ firma de Twilio */

/** X-Twilio-Signature: HMAC-SHA1 con el Auth Token de la URL más los parámetros POST ordenados. */
export function firmaTwilio(token: string, url: string, params: Record<string, string>): string {
  const datos = url + Object.keys(params).sort().map((k) => k + params[k]).join('')
  return createHmac('sha1', token).update(datos, 'utf8').digest('base64')
}

export function peticionDeTwilio(token: string, url: string, params: Record<string, string>, firma: string | null): boolean {
  if (!token || !firma) return false
  const a = Buffer.from(firmaTwilio(token, url, params))
  const b = Buffer.from(firma)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ------------------------------------------------- estado en las cookies */

const COOKIE = 'rcp'
const TROZO = 3500
const MAX_TROZOS = 8

export function empaquetar(e: EstadoTelefono): string[] {
  const z = deflateRawSync(Buffer.from(JSON.stringify(e))).toString('base64url')
  const trozos: string[] = []
  for (let i = 0; i < z.length && trozos.length < MAX_TROZOS; i += TROZO) trozos.push(z.slice(i, i + TROZO))
  // Si no cabe (llamada larguísima), se guarda sin la conversación de la IA.
  if (trozos.join('').length < z.length) return empaquetar({ ...e, motor: 'local', datos: null })
  return trozos
}

export function cabecerasCookie(e: EstadoTelefono): string[] {
  const t = empaquetar(e)
  const out = t.map((v, i) => `${COOKIE}${i}=${v}; Path=/api/telefono; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`)
  for (let i = t.length; i < MAX_TROZOS; i++) out.push(`${COOKIE}${i}=; Path=/api/telefono; Max-Age=0`)
  return out
}

export function desempaquetar(cookie: string | null): EstadoTelefono | null {
  if (!cookie) return null
  const partes = new Map<number, string>()
  for (const c of cookie.split(';')) {
    const m = c.trim().match(new RegExp(`^${COOKIE}(\\d)=(.*)$`))
    if (m && m[2]) partes.set(Number(m[1]), m[2])
  }
  if (!partes.size) return null
  let z = ''
  for (let i = 0; i < MAX_TROZOS && partes.has(i); i++) z += partes.get(i)
  try {
    const e = JSON.parse(inflateRawSync(Buffer.from(z, 'base64url')).toString()) as EstadoTelefono
    return e?.v === 1 ? e : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ TwiML */

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface OpcionesTwiml {
  texto: string
  /** URL base pública (https://dht-recepcionista.vercel.app). */
  base: string
  colgar?: boolean
  /** Número al que pasar la llamada si hay que transferirla. */
  transferirA?: string
  env?: NodeJS.ProcessEnv
}

/** Lo que dice la recepcionista: voz realista si está configurada, si no la voz neuronal de Twilio. */
export function decir(texto: string, base: string, env: NodeJS.ProcessEnv = process.env): string {
  const t = paraVoz(texto)
  if (proveedor(env)) return `<Play>${xml(`${base}/api/voz?t=${encodeURIComponent(t)}&f=${firmar(t, env)}`)}</Play>`
  return `<Say voice="${xml(env.TWILIO_VOZ || 'Polly.Lucia-Neural')}" language="es-ES">${xml(t)}</Say>`
}

export function twiml(o: OpcionesTwiml): string {
  const env = o.env ?? process.env
  const voz = decir(o.texto, o.base, env)
  if (o.colgar) {
    const pasar = o.transferirA ? `<Dial timeout="25">${xml(o.transferirA)}</Dial>` : ''
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${voz}${pasar}<Hangup/></Response>`
  }
  // Se escucha mientras habla (se le puede interrumpir) y también si no dice nada (para insistir o colgar).
  const accion = xml(`${o.base}/api/telefono?paso=turno`)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="speech" language="es-ES" speechTimeout="auto" speechModel="phone_call" actionOnEmptyResult="true" action="${accion}" method="POST">${voz}</Gather></Response>`
}

/* ------------------------------------------------------------------ turno */

export interface Entorno {
  negocio?: Negocio
  ahora?: () => DateTime
  env?: NodeJS.ProcessEnv
  /** Cómo hablar con Claude (en producción, la propia función /api/llamada). */
  fetchIA?: typeof fetch
  llamada: string
  telefono?: string
}

function conector(e: EstadoTelefono, negocio: Negocio, ahora: () => DateTime, env: NodeJS.ProcessEnv): { c: Conector; real: boolean } {
  if (env.RESERVAS_N8N_URL && env.RESERVAS_N8N_CLAVE) return { c: new ConectorN8n(env.RESERVAS_N8N_URL, env.RESERVAS_N8N_CLAVE, negocio, ahora), real: true }
  // Sin sistema de reservas conectado: la misma ocupación de ejemplo que la web, más lo hecho en esta llamada.
  const base = reservasDemo(negocio, ahora())
  for (const r of e.cambios) {
    const i = base.findIndex((x) => x.codigo === r.codigo)
    if (i >= 0) base[i] = r
    else base.push(r)
  }
  return { c: new ConectorLocal(negocio, almacenEnMemoria(base), ahora), real: false }
}

function crearMotor(motor: 'local' | 'claude', c: Conector, ent: Required<Pick<Entorno, 'negocio' | 'ahora' | 'env'>> & Entorno) {
  return motor === 'claude'
    ? new MotorClaude(ent.negocio, c, ent.ahora, ent.llamada, ent.fetchIA, ent.telefono)
    : new MotorLocal(ent.negocio, c, ent.ahora, ent.llamada, ent.telefono)
}

export interface Resultado {
  texto: string
  colgar: boolean
  transferir: boolean
  estado: EstadoTelefono
  eventos: Evento[]
}

/** Primera respuesta al descolgar. */
export function inicio(ent: Entorno): Resultado {
  const negocio = ent.negocio ?? TABERNA_LUNA
  const ahora = ent.ahora ?? (() => DateTime.now().setZone(negocio.zonaHoraria))
  const env = ent.env ?? process.env
  const motor: 'local' | 'claude' = env.ANTHROPIC_API_KEY && ent.fetchIA ? 'claude' : 'local'
  const e: EstadoTelefono = { v: 1, motor, datos: null, cambios: [], silencios: 0 }
  const m = crearMotor(motor, conector(e, negocio, ahora, env).c, { ...ent, negocio, ahora, env })
  const texto = m.saludo()
  return { texto, colgar: false, transferir: false, estado: { ...e, datos: m.exportar() }, eventos: [] }
}

/** Un turno: lo que ha dicho quien llama (vacío si se ha quedado callado). */
export async function turno(dicho: string, previo: EstadoTelefono | null, ent: Entorno): Promise<Resultado> {
  const negocio = ent.negocio ?? TABERNA_LUNA
  const ahora = ent.ahora ?? (() => DateTime.now().setZone(negocio.zonaHoraria))
  const env = ent.env ?? process.env
  if (!previo) {
    // Sin estado (cookie perdida): se retoma con naturalidad en vez de colgar.
    const r = inicio(ent)
    if (!dicho.trim()) return r
    previo = r.estado
  }
  const e: EstadoTelefono = { ...previo, cambios: [...previo.cambios] }

  if (!dicho.trim()) {
    e.silencios++
    if (e.silencios >= 3) return { texto: 'Parece que no se oye bien. Le cuelgo; vuelva a llamar cuando quiera. ¡Hasta luego!', colgar: true, transferir: false, estado: e, eventos: [] }
    return { texto: e.silencios === 1 ? '¿Hola? ¿Sigue ahí?' : 'Perdone, no le oigo. ¿Me lo repite?', colgar: false, transferir: false, estado: e, eventos: [] }
  }
  e.silencios = 0

  const { c } = conector(e, negocio, ahora, env)
  let m = crearMotor(e.motor, c, { ...ent, negocio, ahora, env })
  m.importar(e.datos)
  let r
  let prefijo = ''
  try {
    r = await m.responder(dicho)
  } catch (err) {
    if (!(err instanceof ErrorIA) && e.motor !== 'claude') throw err
    // La IA no está disponible: sigue el motor local desde cero, como en la web.
    e.motor = 'local'
    m = crearMotor('local', c, { ...ent, negocio, ahora, env })
    prefijo = 'Perdone, he tenido un pequeño problema técnico. '
    r = await m.responder(dicho)
  }
  for (const ev of r.eventos) {
    if (ev.tipo === 'reserva' || ev.tipo === 'cancelacion') {
      const i = e.cambios.findIndex((x) => x.codigo === ev.reserva.codigo)
      if (i >= 0) e.cambios[i] = ev.reserva
      else e.cambios.push(ev.reserva)
    }
  }
  e.datos = m.exportar()
  const transferir = r.eventos.some((ev) => ev.tipo === 'transferir')
  const texto = (prefijo + (r.decir || '¿Me lo puede repetir, por favor?')).trim()
  return { texto, colgar: Boolean(r.colgar) || transferir, transferir, estado: e, eventos: r.eventos }
}
