import { describe, expect, it } from 'vitest'
import { limpiarWhisper } from '../src/lib/voz/reconocimiento'
import { paraVoz, puntuar } from '../src/lib/voz/sintesis'
import { DetectorVoz, a16k, type EventoVad } from '../src/lib/voz/vad'

const FS = 48_000
const BLOQUE = 2048

/** Señal sintética: silencio con algo de ruido o «voz» (seno de 220 Hz) por tramos. */
function senal(tramos: [('voz' | 'silencio'), number][]): Float32Array[] {
  const out: Float32Array[] = []
  let n = 0
  let semilla = 1
  const ruido = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647 - 0.5) * 0.004
  for (const [tipo, ms] of tramos) {
    const total = Math.round((ms / 1000) * FS)
    for (let i = 0; i < total; i += BLOQUE) {
      const b = new Float32Array(BLOQUE)
      for (let k = 0; k < BLOQUE; k++, n++) b[k] = tipo === 'voz' ? 0.2 * Math.sin((2 * Math.PI * 220 * n) / FS) : ruido()
      out.push(b)
    }
  }
  return out
}

function pasar(bloques: Float32Array[]) {
  const eventos: EventoVad[] = []
  const vad = new DetectorVoz((e) => eventos.push(e))
  for (const b of bloques) vad.procesar(b, FS)
  return eventos
}

describe('detector de voz', () => {
  it('marca inicio y fin de una frase tras el silencio', () => {
    const ev = pasar(senal([['silencio', 1000], ['voz', 1200], ['silencio', 1200]]))
    expect(ev.map((e) => e.tipo)).toEqual(['inicio', 'fin'])
    const fin = ev[1] as Extract<EventoVad, { tipo: 'fin' }>
    // Incluye la frase entera más el margen previo y el silencio final
    expect(fin.audio.length / FS).toBeGreaterThan(1.2)
    expect(fin.audio.length / FS).toBeLessThan(2.6)
  })

  it('una pausa corta no corta la frase', () => {
    const ev = pasar(senal([['silencio', 500], ['voz', 600], ['silencio', 400], ['voz', 600], ['silencio', 1200]]))
    expect(ev.filter((e) => e.tipo === 'fin')).toHaveLength(1)
  })

  it('descarta golpes demasiado cortos', () => {
    const ev = pasar(senal([['silencio', 800], ['voz', 90], ['silencio', 1200]]))
    expect(ev.some((e) => e.tipo === 'fin')).toBe(false)
  })

  it('el silencio con ruido de fondo no dispara nada', () => {
    expect(pasar(senal([['silencio', 3000]]))).toEqual([])
  })

  it('remuestrea a 16 kHz', () => {
    const x = new Float32Array(48_000).fill(0.5)
    const y = a16k(x, 48_000)
    expect(y.length).toBe(16_000)
    expect(y[100]).toBeCloseTo(0.5)
  })
})

describe('síntesis de voz', () => {
  const v = (name: string, lang: string) => ({ name, lang, localService: true })
  it('prefiere voces naturales en castellano de España', () => {
    const natural = puntuar(v('Microsoft Elvira Online (Natural) - Spanish (Spain)', 'es-ES'))
    const google = puntuar(v('Google español', 'es-ES'))
    const sistema = puntuar(v('Microsoft Helena - Spanish (Spain)', 'es-ES'))
    const mexico = puntuar(v('Microsoft Sabina - Spanish (Mexico)', 'es-MX'))
    expect(natural).toBeGreaterThan(google)
    expect(google).toBeGreaterThan(sistema)
    expect(sistema).toBeGreaterThan(mexico)
    expect(puntuar(v('Microsoft Zira', 'en-US'))).toBe(-1)
  })
  it('adapta el texto al oído', () => {
    expect(paraVoz('Cuesta 24 €')).toBe('Cuesta 24 euros')
    expect(paraVoz('Llame al 944 12 34 56')).toBe('Llame al 944, 12, 34, 56')
  })
})

describe('Whisper', () => {
  it('quita alucinaciones típicas', () => {
    expect(limpiarWhisper('Subtítulos realizados por la comunidad de Amara.org')).toBe('')
    expect(limpiarWhisper('[Música] Quería reservar')).toBe('Quería reservar')
  })
})
