/**
 * Micrófono con cancelación de eco y medidor de nivel. Además reparte las
 * muestras a quien las pida (el detector de voz de Whisper).
 */
export class Microfono {
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private proc: ScriptProcessorNode | null = null
  private oyentes = new Set<(muestras: Float32Array, frecuencia: number) => void>()
  /** Nivel RMS suavizado entre 0 y 1, para dibujar. */
  nivel = 0
  silenciado = false

  get abierto() {
    return this.stream !== null
  }

  async abrir() {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    this.ctx = new AudioContext()
    const fuente = this.ctx.createMediaStreamSource(this.stream)
    // ScriptProcessor está en desuso pero funciona en todos los navegadores sin un fichero aparte.
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1)
    this.proc.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0)
      let s = 0
      for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!
      const rms = Math.sqrt(s / x.length)
      this.nivel = this.silenciado ? 0 : Math.max(rms * 6, this.nivel * 0.85)
      if (!this.silenciado) for (const f of this.oyentes) f(x, this.ctx!.sampleRate)
    }
    fuente.connect(this.proc)
    // Sin conectar a la salida, Chrome no llama a onaudioprocess. La salida va en silencio.
    const mudo = this.ctx.createGain()
    mudo.gain.value = 0
    this.proc.connect(mudo).connect(this.ctx.destination)
  }

  escuchar(f: (muestras: Float32Array, frecuencia: number) => void) {
    this.oyentes.add(f)
    return () => this.oyentes.delete(f)
  }

  cerrar() {
    this.proc?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.ctx?.close()
    this.stream = null
    this.ctx = null
    this.proc = null
    this.nivel = 0
    this.oyentes.clear()
  }
}

/** Tonos de teléfono generados al vuelo (sin ficheros de audio). */
export async function tono(tipo: 'llamada' | 'colgar'): Promise<void> {
  const ctx = new AudioContext()
  const g = ctx.createGain()
  g.connect(ctx.destination)
  const o = ctx.createOscillator()
  o.connect(g)
  const t = ctx.currentTime
  g.gain.setValueAtTime(0, t)
  if (tipo === 'llamada') {
    // Tono de llamada europeo: 425 Hz, 1,5 s sonando y pausa (aquí, uno y medio)
    o.frequency.value = 425
    for (const ini of [0, 1.6]) {
      g.gain.setTargetAtTime(0.08, t + ini, 0.01)
      g.gain.setTargetAtTime(0, t + ini + 0.9, 0.01)
    }
    o.start(t)
    o.stop(t + 2.2)
    await new Promise((ok) => setTimeout(ok, 2200))
  } else {
    o.frequency.value = 425
    for (let i = 0; i < 3; i++) {
      g.gain.setTargetAtTime(0.06, t + i * 0.4, 0.01)
      g.gain.setTargetAtTime(0, t + i * 0.4 + 0.2, 0.01)
    }
    o.start(t)
    o.stop(t + 1.2)
    await new Promise((ok) => setTimeout(ok, 1200))
  }
  void ctx.close()
}
