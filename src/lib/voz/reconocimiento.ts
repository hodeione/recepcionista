import type { Microfono } from './microfono'
import { DetectorVoz, a16k } from './vad'

/**
 * El «oído» de la recepcionista. Dos opciones:
 * - navegador: el reconocimiento de voz de Chrome, Edge o Safari. Rápido y
 *   con texto en vivo, pero el audio lo procesa el servidor del navegador.
 * - whisper: Whisper ejecutándose en tu equipo (WebGPU o WebAssembly). El
 *   audio no sale del navegador; tarda un poco más en dar el texto.
 */
export interface Oido {
  readonly tipo: 'navegador' | 'whisper'
  /** Escucha una frase. Devuelve null si no se dijo nada o se canceló. */
  escuchar(alParcial: (texto: string) => void): Promise<string | null>
  parar(): void
}

type SR = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}

const ConstructorSR = (): (new () => SR) | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const hayReconocimientoNavegador = () => ConstructorSR() !== null

export class ErrorMicrofono extends Error {}

export class OidoNavegador implements Oido {
  readonly tipo = 'navegador' as const
  private actual: SR | null = null

  escuchar(alParcial: (texto: string) => void): Promise<string | null> {
    const C = ConstructorSR()
    if (!C) return Promise.reject(new ErrorMicrofono('Este navegador no reconoce la voz. Usa Whisper o escribe.'))
    return new Promise((ok, ko) => {
      const r = new C()
      this.actual = r
      r.lang = 'es-ES'
      r.interimResults = true
      // Continuo: así una pausa a mitad de frase («quería reservar… para el viernes») no corta.
      r.continuous = true
      r.maxAlternatives = 1
      let final = ''
      let interino = ''
      let cierre: ReturnType<typeof setTimeout> | undefined
      let terminado = false
      const programar = (ms: number) => {
        clearTimeout(cierre)
        cierre = setTimeout(() => r.stop(), ms)
      }
      programar(9000) // nadie habla en 9 s: se considera silencio
      r.onresult = (e) => {
        interino = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!
          if (res.isFinal) final += ' ' + res[0].transcript
          else interino += ' ' + res[0].transcript
        }
        alParcial((final + ' ' + interino).replace(/\s+/g, ' ').trim())
        // Con texto definitivo y sin nada a medias, se contesta tras una pausa corta.
        programar(interino.trim() ? 1600 : 650)
      }
      r.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          terminado = true
          clearTimeout(cierre)
          ko(new ErrorMicrofono('No hay permiso para usar el micrófono.'))
        } else if (e.error === 'network') {
          terminado = true
          clearTimeout(cierre)
          ko(new ErrorMicrofono('El reconocimiento de voz del navegador necesita conexión. Prueba con Whisper.'))
        }
        // no-speech, aborted…: termina en onend con lo que haya
      }
      r.onend = () => {
        clearTimeout(cierre)
        this.actual = null
        if (terminado) return
        const texto = (final + ' ' + interino).replace(/\s+/g, ' ').trim()
        ok(texto || null)
      }
      r.start()
    })
  }

  parar() {
    this.actual?.abort()
    this.actual = null
  }
}

export interface ProgresoModelo {
  cargado: number
  total: number
  listo: boolean
  dispositivo?: 'webgpu' | 'wasm'
}

export class OidoWhisper implements Oido {
  readonly tipo = 'whisper' as const
  private worker: Worker | null = null
  private listo: Promise<void> | null = null
  private sec = 0
  private pendientes = new Map<number, (t: string) => void>()
  private cancelar: (() => void) | null = null

  constructor(
    private mic: Microfono,
    private alProgreso: (p: ProgresoModelo) => void = () => {},
  ) {}

  /** Descarga y prepara el modelo (unos 80-140 MB la primera vez; luego queda en caché). */
  preparar(): Promise<void> {
    if (this.listo) return this.listo
    this.listo = new Promise((ok, ko) => {
      const w = new Worker(new URL('../../worker.ts', import.meta.url), { type: 'module' })
      this.worker = w
      const archivos: Record<string, { cargado: number; total: number }> = {}
      w.onmessage = (e: MessageEvent) => {
        const m = e.data
        if (m.type === 'progress') {
          archivos[m.file] = { cargado: m.loaded, total: m.total }
          const v = Object.values(archivos)
          this.alProgreso({ cargado: v.reduce((s, x) => s + x.cargado, 0), total: v.reduce((s, x) => s + x.total, 0), listo: false })
        } else if (m.type === 'ready') {
          this.alProgreso({ cargado: 1, total: 1, listo: true, dispositivo: m.device })
          ok()
        } else if (m.type === 'text') {
          this.pendientes.get(m.id)?.(m.text)
          this.pendientes.delete(m.id)
        } else if (m.type === 'error') {
          if (m.stage === 'load') {
            this.listo = null
            ko(new Error(m.message))
          } else if (m.id !== undefined) {
            this.pendientes.get(m.id)?.('')
            this.pendientes.delete(m.id)
          }
        }
      }
      void detectarGpu().then((g) => w.postMessage({ type: 'load', device: g.disponible ? 'webgpu' : 'wasm', shaderF16: g.f16 }))
    })
    return this.listo
  }

  async escuchar(alParcial: (texto: string) => void): Promise<string | null> {
    await this.preparar()
    return new Promise((ok) => {
      let quitar = () => {}
      let silencio: ReturnType<typeof setTimeout> | undefined
      const terminar = (t: string | null) => {
        clearTimeout(silencio)
        quitar()
        this.cancelar = null
        ok(t)
      }
      this.cancelar = () => terminar(null)
      const vad = new DetectorVoz((ev) => {
        if (ev.tipo === 'inicio') {
          clearTimeout(silencio)
          alParcial('…')
        } else if (ev.tipo === 'descartada') {
          alParcial('')
        } else {
          quitar()
          alParcial('Transcribiendo…')
          const id = ++this.sec
          this.pendientes.set(id, (texto) => terminar(limpiarWhisper(texto) || null))
          const audio = a16k(ev.audio, ev.frecuencia)
          this.worker!.postMessage({ type: 'run', id, audio }, [audio.buffer])
        }
      })
      quitar = this.mic.escuchar((x, f) => vad.procesar(x, f))
      silencio = setTimeout(() => terminar(null), 10_000)
    })
  }

  parar() {
    this.cancelar?.()
  }

  cerrar() {
    this.worker?.terminate()
    this.worker = null
    this.listo = null
  }
}

/** Whisper a veces «alucina» frases típicas de subtítulos cuando oye ruido. */
export function limpiarWhisper(t: string): string {
  const s = t.replace(/\[.*?\]|\(.*?\)/g, '').trim()
  if (/^(subt[ií]tulos|gracias por ver|amara\.org|suscr[ií]bete)/i.test(s)) return ''
  return s
}

async function detectarGpu(): Promise<{ disponible: boolean; f16: boolean }> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu
    const a = gpu ? await gpu.requestAdapter() : null
    return { disponible: Boolean(a), f16: Boolean(a?.features.has('shader-f16')) }
  } catch {
    return { disponible: false, f16: false }
  }
}
