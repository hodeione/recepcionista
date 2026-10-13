/**
 * Detector de voz por energía con umbral adaptativo: aprende el ruido de
 * fondo y marca el principio y el final de cada frase. El final llega tras
 * `silencioFinMs` de silencio, que es cuando la recepcionista contesta.
 */
export interface OpcionesVad {
  silencioFinMs?: number
  minVozMs?: number
  maxFraseMs?: number
}

export type EventoVad = { tipo: 'inicio' } | { tipo: 'fin'; audio: Float32Array; frecuencia: number } | { tipo: 'descartada' }

export class DetectorVoz {
  private ruido = 0.004
  private enVoz = false
  private vozMs = 0
  private silencioMs = 0
  private trozos: Float32Array[] = []
  private previo: Float32Array[] = []
  private o: Required<OpcionesVad>

  constructor(
    private salida: (e: EventoVad) => void,
    o: OpcionesVad = {},
  ) {
    this.o = { silencioFinMs: 800, minVozMs: 250, maxFraseMs: 20_000, ...o }
  }

  /** Umbral actual: bastante por encima del ruido, con un mínimo para salas silenciosas. */
  get umbral() {
    return Math.max(this.ruido * 3.2, 0.012)
  }

  procesar(muestras: Float32Array, frecuencia: number) {
    let s = 0
    for (let i = 0; i < muestras.length; i++) s += muestras[i]! * muestras[i]!
    const rms = Math.sqrt(s / muestras.length)
    const ms = (muestras.length / frecuencia) * 1000
    const copia = muestras.slice()

    if (!this.enVoz) {
      // El ruido de fondo se aprende solo cuando no se habla.
      this.ruido = this.ruido * 0.95 + Math.min(rms, this.umbral) * 0.05
      this.previo.push(copia)
      // Se guardan ~300 ms previos para no comerse el principio de la palabra.
      while (this.previo.length * ms > 300) this.previo.shift()
      if (rms > this.umbral) {
        this.vozMs += ms
        if (this.vozMs >= 60) {
          this.enVoz = true
          this.silencioMs = 0
          this.trozos = [...this.previo]
          this.previo = []
          this.salida({ tipo: 'inicio' })
        }
      } else this.vozMs = 0
      return
    }

    this.trozos.push(copia)
    if (rms > this.umbral * 0.8) {
      this.silencioMs = 0
      this.vozMs += ms
    } else this.silencioMs += ms
    const total = this.trozos.length * ms
    if (this.silencioMs >= this.o.silencioFinMs || total >= this.o.maxFraseMs) {
      const voz = this.vozMs
      const audio = unir(this.trozos)
      this.reiniciar()
      if (voz >= this.o.minVozMs) this.salida({ tipo: 'fin', audio, frecuencia })
      else this.salida({ tipo: 'descartada' })
    }
  }

  reiniciar() {
    this.enVoz = false
    this.vozMs = 0
    this.silencioMs = 0
    this.trozos = []
    this.previo = []
  }
}

function unir(trozos: Float32Array[]): Float32Array {
  const n = trozos.reduce((s, t) => s + t.length, 0)
  const out = new Float32Array(n)
  let o = 0
  for (const t of trozos) {
    out.set(t, o)
    o += t.length
  }
  return out
}

/** Remuestrea a 16 kHz (lo que espera Whisper) con un filtro paso bajo sencillo. */
export function a16k(audio: Float32Array, frecuencia: number): Float32Array {
  if (frecuencia === 16_000) return audio
  const razon = frecuencia / 16_000
  const n = Math.floor(audio.length / razon)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    // Media de las muestras que caen en cada salida: evita el aliasing más gordo.
    const ini = Math.floor(i * razon)
    const fin = Math.min(audio.length, Math.floor((i + 1) * razon))
    let s = 0
    for (let j = ini; j < fin; j++) s += audio[j]!
    out[i] = s / Math.max(1, fin - ini)
  }
  return out
}
