import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { cabecerasCookie, desempaquetar, firmaTwilio, inicio, peticionDeTwilio, turno, twiml, type EstadoTelefono } from '../api/_lib/telefono'
import { firmaValida, firmar, peticionVoz, proveedor } from '../api/_lib/voz'

const AHORA = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })
const ENV = {} as NodeJS.ProcessEnv

/** Simula lo que hace Twilio: guarda las cookies de cada respuesta y las devuelve en la siguiente. */
function cookies(estado: EstadoTelefono) {
  return cabecerasCookie(estado)
    .map((c) => c.split(';')[0]!)
    .filter((c) => !c.endsWith('='))
    .join('; ')
}

describe('firma de Twilio', () => {
  it('coincide con el ejemplo de la documentación de Twilio', () => {
    const params = { CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234', From: '+14158675309', To: '+18005551212' }
    expect(firmaTwilio('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=')
  })

  it('rechaza peticiones manipuladas o sin firma', () => {
    const url = 'https://dht-recepcionista.vercel.app/api/telefono?paso=turno'
    const p = { CallSid: 'CA1', SpeechResult: 'hola' }
    const f = firmaTwilio('secreto', url, p)
    expect(peticionDeTwilio('secreto', url, p, f)).toBe(true)
    expect(peticionDeTwilio('secreto', url, { ...p, SpeechResult: 'adiós' }, f)).toBe(false)
    expect(peticionDeTwilio('secreto', url, p, null)).toBe(false)
    expect(peticionDeTwilio('', url, p, f)).toBe(false)
  })
})

describe('estado en cookies', () => {
  it('ida y vuelta, también con estados grandes', () => {
    const e: EstadoTelefono = { v: 1, motor: 'claude', datos: { mensajes: Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `frase ${i} `.repeat(20) })) }, cambios: [], silencios: 1 }
    expect(desempaquetar(cookies(e))).toEqual(e)
    expect(desempaquetar('otra=1; rcp0=basura')).toBeNull()
    expect(desempaquetar(null)).toBeNull()
  })
})

describe('TwiML', () => {
  it('escucha mientras habla con la voz neuronal de Twilio', () => {
    const x = twiml({ texto: 'Hola & bienvenido <3', base: 'https://x.app', env: ENV })
    expect(x).toContain('<Gather input="speech" language="es-ES"')
    expect(x).toContain('actionOnEmptyResult="true" action="https://x.app/api/telefono?paso=turno"')
    expect(x).toContain('<Say voice="Polly.Lucia-Neural" language="es-ES">Hola &amp; bienvenido &lt;3</Say>')
  })

  it('usa la voz realista con un enlace firmado y pasa la llamada al equipo', () => {
    const env = { ELEVENLABS_API_KEY: 'k', VOZ_SECRETO: 's' } as NodeJS.ProcessEnv
    const x = twiml({ texto: 'Le paso con el equipo.', base: 'https://x.app', colgar: true, transferirA: '+34944123456', env })
    const url = x.match(/<Play>(.*?)<\/Play>/)![1]!.replace(/&amp;/g, '&')
    const u = new URL(url)
    expect(firmaValida(u.searchParams.get('t')!, u.searchParams.get('f')!, env)).toBe(true)
    expect(x).toContain('<Dial timeout="25">+34944123456</Dial><Hangup/>')
  })
})

describe('voz realista', () => {
  it('elige proveedor y construye la petición', () => {
    expect(proveedor({} as NodeJS.ProcessEnv)).toBeNull()
    expect(proveedor({ OPENAI_API_KEY: 'o' } as NodeJS.ProcessEnv)).toBe('openai')
    expect(proveedor({ OPENAI_API_KEY: 'o', ELEVENLABS_API_KEY: 'e' } as NodeJS.ProcessEnv)).toBe('elevenlabs')
    const el = peticionVoz('Hola', 'elevenlabs', { ELEVENLABS_API_KEY: 'e', ELEVENLABS_VOZ: 'abc' } as NodeJS.ProcessEnv)
    expect(el.url).toContain('/v1/text-to-speech/abc/stream')
    expect(JSON.parse(String(el.init.body))).toMatchObject({ text: 'Hola', model_id: 'eleven_flash_v2_5', language_code: 'es' })
    const oa = peticionVoz('Hola', 'openai', { OPENAI_API_KEY: 'o' } as NodeJS.ProcessEnv)
    expect(JSON.parse(String(oa.init.body))).toMatchObject({ model: 'gpt-4o-mini-tts', input: 'Hola' })
  })
  it('las firmas dependen del texto y del secreto', () => {
    const env = { VOZ_SECRETO: 'a' } as NodeJS.ProcessEnv
    expect(firmaValida('hola', firmar('hola', env), env)).toBe(true)
    expect(firmaValida('adiós', firmar('hola', env), env)).toBe(false)
    expect(firmaValida('hola', firmar('hola', env), { VOZ_SECRETO: 'b' } as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe('llamada telefónica simulada', () => {
  const ent = { llamada: 'CA1', telefono: '+34600111222', ahora: () => AHORA, env: ENV }

  it('reserva de principio a fin con el teléfono de quien llama', async () => {
    let r = inicio(ent)
    expect(r.texto).toMatch(/^Taberna Luna, buenas tardes/)
    const decir = async (t: string) => {
      r = await turno(t, desempaquetar(cookies(r.estado)), ent)
      return r
    }
    expect((await decir('quería mesa para dos mañana a las nueve')).texto).toMatch(/nombre de quién/)
    expect((await decir('Mikel Urrutia')).texto).toMatch(/alergia/)
    expect((await decir('no')).texto).toMatch(/Le confirmo/)
    const fin = await decir('sí')
    expect(fin.eventos[0]).toMatchObject({ tipo: 'reserva', reserva: { nombre: 'Mikel Urrutia', telefono: '+34600111222', hora: '21:00' } })
    expect(fin.estado.cambios).toHaveLength(1)
    expect((await decir('no, gracias, adiós')).colgar).toBe(true)
  })

  it('insiste si no oye nada y acaba colgando', async () => {
    let r = inicio(ent)
    r = await turno('', r.estado, ent)
    expect(r.texto).toMatch(/Sigue ahí/)
    r = await turno('', r.estado, ent)
    r = await turno('', r.estado, ent)
    expect(r.colgar).toBe(true)
  })

  it('si la IA falla, sigue el motor local', async () => {
    const fetchIA = (async () => new Response('{"tipo":"error","codigo":"sin_saldo","error":"x"}\n')) as unknown as typeof fetch
    const conIA = { ...ent, env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv, fetchIA }
    const r0 = inicio(conIA)
    expect(r0.estado.motor).toBe('claude')
    const r = await turno('¿dónde estáis?', r0.estado, conIA)
    expect(r.texto).toMatch(/^Perdone, he tenido un pequeño problema técnico\. Estamos en Calle Somera 12/)
    expect(r.estado.motor).toBe('local')
  })

  it('sin estado (cookie perdida) retoma la conversación', async () => {
    const r = await turno('¿a qué hora abrís?', null, ent)
    expect(r.texto).toMatch(/de martes a domingo/)
  })
})
