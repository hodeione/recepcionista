import { DateTime } from 'luxon'
import type { Negocio } from './negocio'
import { reservasDemo, type Almacen } from './reservas/conector'
import type { Reserva } from './reservas/motor'

/**
 * Datos de la demo en el navegador: reservas y registro de llamadas. Cada día
 * se regenera la ocupación de ejemplo; las reservas hechas por la
 * recepcionista y las llamadas se conservan.
 */

export type Resultado = 'reserva' | 'cancelacion' | 'informacion' | 'transferida' | 'sin_resolver'

export interface LineaLlamada {
  quien: 'cliente' | 'recepcionista' | 'sistema'
  texto: string
  /** Segundos desde el inicio de la llamada. */
  t: number
}

export interface RegistroLlamada {
  id: string
  inicio: string
  duracion: number
  motor: 'claude' | 'local'
  lineas: LineaLlamada[]
  resultado: Resultado
  codigos: string[]
  resumen: string
  tokens?: { entrada: number; salida: number }
}

interface Datos {
  version: 1
  dia: string
  reservas: Reserva[]
  llamadas: RegistroLlamada[]
}

const CLAVE = 'recepcionista:v1'
const EVENTO = 'recepcionista:cambio'

export class AlmacenDemo implements Almacen {
  private datos: Datos

  constructor(
    private negocio: Negocio,
    private ahora: () => DateTime,
  ) {
    this.datos = this.cargar()
  }

  private cargar(): Datos {
    const hoy = this.ahora().toISODate()!
    let previo: Datos | null = null
    try {
      const crudo = localStorage.getItem(CLAVE)
      if (crudo) previo = JSON.parse(crudo) as Datos
    } catch {
      /* navegación privada o datos corruptos: se empieza de cero */
    }
    if (previo?.version === 1 && previo.dia === hoy) return previo
    const propias = (previo?.reservas ?? []).filter((r) => r.origen === 'ia' && r.fecha >= hoy)
    const datos: Datos = { version: 1, dia: hoy, reservas: [...reservasDemo(this.negocio, this.ahora()), ...propias], llamadas: previo?.llamadas ?? [] }
    this.escribir(datos)
    return datos
  }

  private escribir(d: Datos) {
    try {
      localStorage.setItem(CLAVE, JSON.stringify(d))
    } catch {
      /* sin almacenamiento: la demo sigue funcionando en memoria */
    }
    window.dispatchEvent(new Event(EVENTO))
  }

  leer() {
    return this.datos.reservas
  }

  guardar(reservas: Reserva[]) {
    this.datos = { ...this.datos, reservas }
    this.escribir(this.datos)
  }

  llamadas() {
    return this.datos.llamadas
  }

  guardarLlamada(l: RegistroLlamada) {
    this.datos = { ...this.datos, llamadas: [l, ...this.datos.llamadas.filter((x) => x.id !== l.id)].slice(0, 30) }
    this.escribir(this.datos)
  }

  /** Vuelve a la ocupación de ejemplo y borra llamadas. */
  reiniciar() {
    try {
      localStorage.removeItem(CLAVE)
    } catch {
      /* nada */
    }
    this.datos = { version: 1, dia: this.ahora().toISODate()!, reservas: reservasDemo(this.negocio, this.ahora()), llamadas: [] }
    this.escribir(this.datos)
  }

  static alCambiar(f: () => void) {
    window.addEventListener(EVENTO, f)
    return () => window.removeEventListener(EVENTO, f)
  }
}
