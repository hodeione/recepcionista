/**
 * Voz de la recepcionista con la síntesis del propio navegador (gratis y sin
 * servidor). Elige la mejor voz en castellano disponible: las «Natural» de
 * Edge y la de Google en Chrome suenan muy bien; las de sistema, peor.
 */

export interface InfoVoz {
  id: string
  nombre: string
  idioma: string
  puntos: number
}

const FEMENINAS = /elvira|helena|laura|lucia|lucía|monica|mónica|paulina|dalia|ximena|elena|sabina|carmen|marisol|google español|irene|triana|vera|abril|esperanza|estrella|ines|inés/i

export function puntuar(v: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'localService'>): number {
  if (!/^es\b|^es-/i.test(v.lang)) return -1
  let p = 10
  if (/es-ES/i.test(v.lang)) p += 30
  if (/natural|neural|online|premium|enhanced|mejorada/i.test(v.name)) p += 50
  if (/google/i.test(v.name)) p += 35
  if (FEMENINAS.test(v.name)) p += 8
  if (/compact|eloquence|espeak/i.test(v.name)) p -= 20
  return p
}

export function vocesEspanol(): InfoVoz[] {
  if (typeof speechSynthesis === 'undefined') return []
  return speechSynthesis
    .getVoices()
    .map((v) => ({ id: v.voiceURI, nombre: v.name.replace(/^Microsoft /, '').replace(/ - Spanish.*$/, ''), idioma: v.lang, puntos: puntuar(v) }))
    .filter((v) => v.puntos >= 0)
    .sort((a, b) => b.puntos - a.puntos)
}

/** Las voces llegan tarde en Chrome: espera a que estén (o a que pase un rato). */
export function cargarVoces(): Promise<InfoVoz[]> {
  return new Promise((ok) => {
    if (typeof speechSynthesis === 'undefined') return ok([])
    const ya = vocesEspanol()
    if (ya.length) return ok(ya)
    const t = setTimeout(() => ok(vocesEspanol()), 1500)
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(t)
        ok(vocesEspanol())
      },
      { once: true },
    )
  })
}

/** Lo que la llamada necesita de una voz: decir frases en cola, esperar a que acabe y cortar. */
export interface Voz {
  readonly hablando: boolean
  hablar(frase: string): void
  fin(): Promise<void>
  cancelar(): void
  alCambiar: (hablando: boolean) => void
}

export class Sintetizador implements Voz {
  vozId = ''
  velocidad = 1.05
  private pendientes = 0
  private esperas: (() => void)[] = []
  // Chrome libera las locuciones sin referencia y entonces no llega «end».
  private vivas = new Set<SpeechSynthesisUtterance>()
  alCambiar: (hablando: boolean) => void = () => {}

  get disponible() {
    return typeof speechSynthesis !== 'undefined'
  }

  get hablando() {
    return this.pendientes > 0
  }

  hablar(frase: string) {
    if (!this.disponible || !frase.trim()) return
    const u = new SpeechSynthesisUtterance(paraVoz(frase))
    const voz = speechSynthesis.getVoices().find((v) => v.voiceURI === this.vozId) ?? speechSynthesis.getVoices().filter((v) => puntuar(v) >= 0).sort((a, b) => puntuar(b) - puntuar(a))[0]
    if (voz) {
      u.voice = voz
      u.lang = voz.lang
    } else u.lang = 'es-ES'
    u.rate = this.velocidad
    this.pendientes++
    this.vivas.add(u)
    if (this.pendientes === 1) this.alCambiar(true)
    // Sin voces instaladas (o con algún fallo del navegador) puede no llegar nunca «end»:
    // pasado el tiempo razonable de lectura se da por dicha para que la llamada siga.
    const vigilante = setTimeout(() => fin(), 1500 + (frase.length * 70) / this.velocidad)
    const fin = () => {
      clearTimeout(vigilante)
      if (!this.vivas.delete(u)) return
      this.pendientes = Math.max(0, this.pendientes - 1)
      if (this.pendientes === 0) {
        this.alCambiar(false)
        this.esperas.splice(0).forEach((f) => f())
      }
    }
    u.onend = fin
    u.onerror = fin
    speechSynthesis.speak(u)
  }

  /** Se resuelve cuando termina todo lo que hay en cola. */
  fin(): Promise<void> {
    if (!this.pendientes) return Promise.resolve()
    return new Promise((ok) => this.esperas.push(ok))
  }

  cancelar() {
    if (!this.disponible) return
    speechSynthesis.cancel()
    this.vivas.clear()
    const habia = this.pendientes > 0
    this.pendientes = 0
    if (habia) this.alCambiar(false)
    this.esperas.splice(0).forEach((f) => f())
  }
}

/** Ajustes para que suene natural: los sintetizadores leen mal algunas cosas. */
export function paraVoz(frase: string): string {
  return frase
    .replace(/(\d+)\s?€/g, '$1 euros')
    .replace(/\bC\/\s?/g, 'calle ')
    .replace(/\bnº\s?/gi, 'número ')
    .replace(/(\d{3}) (\d{2}) (\d{2}) (\d{2})/g, '$1, $2, $3, $4')
}
