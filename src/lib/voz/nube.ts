import type { Sintetizador, Voz } from './sintesis.js'

/**
 * Voz realista: cada frase se pide a /api/voz (ElevenLabs u OpenAI) en
 * cuanto llega, así que la siguiente se descarga mientras suena la
 * anterior. Se reproduce con Web Audio, que se desbloquea con el toque de
 * «Llamar» (iOS no deja sonar audio que no venga de un gesto).
 * Si el servicio falla, esa frase y las siguientes las dice el navegador.
 */
export class VozNube implements Voz {
  private ctx: AudioContext | null = null
  private cola: { texto: string; audio: Promise<ArrayBuffer | null> }[] = []
  private sonando = false
  private fuente: AudioBufferSourceNode | null = null
  private generacion = 0
  private esperas: (() => void)[] = []
  /** Tras un fallo de cuenta (sin clave o sin saldo) no se vuelve a intentar en esta sesión. */
  desactivada = false
  alCambiar: (hablando: boolean) => void = () => {}

  constructor(
    private respaldo: Sintetizador,
    private f: typeof fetch = (...a) => fetch(...a),
  ) {}

  get hablando() {
    return this.sonando || this.cola.length > 0
  }

  /** Llamar dentro de un gesto del usuario (el toque de «Llamar»). */
  desbloquear() {
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
  }

  hablar(frase: string) {
    const texto = frase.trim()
    if (!texto) return
    const audio = this.desactivada ? Promise.resolve(null) : this.pedir(texto)
    this.cola.push({ texto, audio })
    if (!this.sonando) void this.reproducir(this.generacion)
  }

  private async pedir(texto: string): Promise<ArrayBuffer | null> {
    try {
      const r = await this.f('/api/voz', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto }) })
      if (!r.ok) {
        const c = (await r.json().catch(() => ({}))) as { codigo?: string }
        if (c.codigo === 'sin_clave' || c.codigo === 'sin_saldo') this.desactivada = true
        return null
      }
      return await r.arrayBuffer()
    } catch {
      return null
    }
  }

  private async reproducir(gen: number) {
    this.sonando = true
    this.alCambiar(true)
    while (this.cola.length && gen === this.generacion) {
      const item = this.cola.shift()!
      const datos = await item.audio
      if (gen !== this.generacion) break
      const ok = datos ? await this.sonar(datos, gen) : false
      if (!ok && gen === this.generacion) {
        this.respaldo.hablar(item.texto)
        await this.respaldo.fin()
      }
    }
    if (gen !== this.generacion) return
    this.sonando = false
    this.alCambiar(false)
    this.esperas.splice(0).forEach((f) => f())
  }

  private async sonar(datos: ArrayBuffer, gen: number): Promise<boolean> {
    try {
      this.ctx ??= new AudioContext()
      const buffer = await this.ctx.decodeAudioData(datos)
      if (gen !== this.generacion) return true
      await new Promise<void>((ok) => {
        const s = this.ctx!.createBufferSource()
        s.buffer = buffer
        s.connect(this.ctx!.destination)
        s.onended = () => ok()
        this.fuente = s
        s.start()
      })
      this.fuente = null
      return true
    } catch {
      return false
    }
  }

  fin(): Promise<void> {
    if (!this.hablando) return Promise.resolve()
    return new Promise((ok) => this.esperas.push(ok))
  }

  cancelar() {
    this.generacion++
    this.cola = []
    try {
      this.fuente?.stop()
    } catch {
      /* ya había terminado */
    }
    this.fuente = null
    this.respaldo.cancelar()
    const habia = this.sonando
    this.sonando = false
    if (habia) this.alCambiar(false)
    this.esperas.splice(0).forEach((f) => f())
  }
}
