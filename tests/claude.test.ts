import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { HERRAMIENTAS, Limitador, esFaltaDeSaldo, fichaComoTexto, momentoActual, origenPermitido, validarFicha, validarMensajes } from '../api/_lib/agente'
import { ErrorIA, Frases, MotorClaude } from '../src/lib/dialogo/claude'
import { TABERNA_LUNA as N } from '../src/lib/negocio'
import { ConectorLocal, almacenEnMemoria } from '../src/lib/reservas/conector'

const AHORA = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })

/** Simula /api/llamada: cada petición devuelve el siguiente guion como NDJSON. */
function apiFalsa(guiones: unknown[][]) {
  const cuerpos: { mensajes: { role: string; content: unknown }[] }[] = []
  const f = async (_url: unknown, init?: RequestInit) => {
    cuerpos.push(JSON.parse(String(init?.body)))
    const lineas = guiones.shift() ?? []
    const texto = lineas.map((l) => JSON.stringify(l)).join('\n') + '\n'
    return new Response(texto, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
  }
  return { f: f as unknown as typeof fetch, cuerpos }
}

describe('motor con Claude', () => {
  it('ejecuta herramientas en el navegador y habla por frases', async () => {
    const almacen = almacenEnMemoria()
    const { f, cuerpos } = apiFalsa([
      [
        { tipo: 'texto', t: 'Un momento, ' },
        { tipo: 'texto', t: 'lo miro. ' },
        { tipo: 'fin', stop: 'tool_use', contenido: [{ type: 'text', text: 'Un momento, lo miro.' }, { type: 'tool_use', id: 't1', name: 'consultar_disponibilidad', input: { fecha: '2026-10-16', personas: 2, hora: '21:00' } }] },
      ],
      [
        { tipo: 'texto', t: 'Sí, tengo mesa a las nueve. ¿A nombre de quién?' },
        { tipo: 'fin', stop: 'end_turn', contenido: [{ type: 'text', text: 'Sí, tengo mesa a las nueve. ¿A nombre de quién?' }], uso: { input_tokens: 100, output_tokens: 20 } },
      ],
      [
        { tipo: 'fin', stop: 'tool_use', contenido: [{ type: 'tool_use', id: 't2', name: 'crear_reserva', input: { nombre: 'Jon', fecha: '2026-10-16', hora: '21:00', personas: 2, notas: '' } }] },
      ],
      [{ tipo: 'texto', t: 'Hecho.' }, { tipo: 'fin', stop: 'end_turn', contenido: [{ type: 'text', text: 'Hecho.' }] }],
    ])
    const motor = new MotorClaude(N, new ConectorLocal(N, almacen, () => AHORA), () => AHORA, 'L1', f)
    motor.saludo()
    const frases: string[] = []
    const r = await motor.responder('mesa para dos el viernes a las nueve', (x) => frases.push(x))
    expect(frases).toEqual(['Un momento, lo miro.', 'Sí, tengo mesa a las nueve.', '¿A nombre de quién?'])
    const herramienta = r.eventos.find((e) => e.tipo === 'herramienta')
    expect(herramienta).toMatchObject({ nombre: 'consultar_disponibilidad', salida: { dia: 'viernes 16 de octubre', horaPedida: { libre: true } } })
    // La segunda petición lleva el resultado de la herramienta y la conversación alterna bien
    expect(validarMensajes(cuerpos[1]!.mensajes)).not.toBeNull()
    const r2 = await motor.responder('a nombre de Jon')
    expect(r2.eventos[0]).toMatchObject({ tipo: 'reserva', reserva: { nombre: 'Jon', llamada: 'L1' } })
    expect(almacen.leer()).toHaveLength(1)
    expect(motor.uso.entrada).toBe(100)
  })

  it('cuelga con resumen', async () => {
    const { f } = apiFalsa([
      [
        { tipo: 'texto', t: 'Gracias por llamar.' },
        { tipo: 'fin', stop: 'tool_use', contenido: [{ type: 'text', text: 'Gracias por llamar.' }, { type: 'tool_use', id: 'c', name: 'colgar', input: { motivo: 'despedida', resumen: 'Preguntó el horario.' } }] },
      ],
    ])
    const motor = new MotorClaude(N, new ConectorLocal(N, almacenEnMemoria(), () => AHORA), () => AHORA, undefined, f)
    motor.saludo()
    const r = await motor.responder('adiós')
    expect(r.colgar).toBe(true)
    expect(motor.resumen).toBe('Preguntó el horario.')
  })

  it('convierte los errores del servidor en ErrorIA', async () => {
    const f = (async () => new Response('{"tipo":"error","codigo":"sin_saldo","error":"x"}\n')) as unknown as typeof fetch
    const motor = new MotorClaude(N, new ConectorLocal(N, almacenEnMemoria(), () => AHORA), () => AHORA, undefined, f)
    motor.saludo()
    await expect(motor.responder('hola')).rejects.toBeInstanceOf(ErrorIA)
  })

  it('agrupa el texto en frases sin cortar códigos', () => {
    const out: string[] = []
    const fr = new Frases((x) => out.push(x))
    for (const t of ['El código es R, X, 7, K, 2. ', 'Le espe', 'ramos el viernes. ¿Algo', ' más?']) fr.añadir(t)
    fr.terminar()
    expect(out).toEqual(['El código es R, X, 7, K, 2.', 'Le esperamos el viernes.', '¿Algo más?'])
  })
})

describe('función /api/llamada', () => {
  it('valida y recorta la ficha', () => {
    const f = validarFicha({ ...N, nombre: '<b>Taberna</b> Luna', horas: { comida: ['13:00', 'mal'], cena: [] } })!
    expect(f.nombre).toBe('bTaberna/b Luna')
    expect(f.horas.comida).toEqual(['13:00'])
    expect(validarFicha({})).toBeNull()
    expect(fichaComoTexto(validarFicha(N)!)).toContain('Chuletón de vaca madurada (De la tierra), 58 €')
  })

  it('valida la conversación', () => {
    expect(validarMensajes([{ role: 'user', content: 'hola' }])).not.toBeNull()
    expect(validarMensajes([{ role: 'assistant', content: 'hola' }])).toBeNull()
    expect(validarMensajes([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toBeNull()
    expect(validarMensajes([{ role: 'user', content: [{ type: 'image', source: {} }] }])).toBeNull()
    expect(validarMensajes([{ role: 'user', content: 'x'.repeat(3000) }])).toBeNull()
  })

  it('da la fecha con una tabla de próximos días', () => {
    const m = momentoActual('Europe/Madrid', AHORA)
    expect(m).toContain('18:00 del martes 13 de octubre de 2026')
    expect(m).toContain('viernes 16/10 = 2026-10-16')
  })

  it('herramientas estrictas', () => {
    for (const h of HERRAMIENTAS) {
      expect(h.strict).toBe(true)
      expect(h.input_schema.additionalProperties).toBe(false)
      expect(h.input_schema.required).toEqual(Object.keys(h.input_schema.properties as object))
    }
  })

  it('detecta la falta de saldo y limita el uso', () => {
    expect(esFaltaDeSaldo(new Error('400 Your credit balance is too low to access the Anthropic API'))).toBe(true)
    expect(esFaltaDeSaldo(new Error('overloaded'))).toBe(false)
    const l = new Limitador(2, 1000, 100, 1000)
    expect(l.comprobar('a', 0).ok).toBe(true)
    expect(l.comprobar('a', 1).ok).toBe(true)
    expect(l.comprobar('a', 2).ok).toBe(false)
    expect(l.comprobar('a', 1500).ok).toBe(true)
    expect(origenPermitido('https://dht-recepcionista.vercel.app', 'x')).toBe(true)
    expect(origenPermitido('https://malo.com', 'dht-recepcionista.vercel.app')).toBe(false)
  })
})
