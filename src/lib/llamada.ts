import type { DateTime } from 'luxon'
import type { AlmacenDemo, LineaLlamada, RegistroLlamada, Resultado } from './almacen'
import { ErrorIA, MotorClaude } from './dialogo/claude'
import { MotorLocal } from './dialogo/local'
import type { Evento, Motor } from './dialogo/tipos'
import { fechaCorta } from './es/hablar'
import type { Negocio } from './negocio'
import type { Conector } from './reservas/conector'
import { tono, type Microfono } from './voz/microfono'
import type { Oido } from './voz/reconocimiento'
import type { Sintetizador } from './voz/sintesis'

/**
 * Una llamada de principio a fin: suena, la recepcionista saluda y a partir
 * de ahí se alternan escuchar → pensar → hablar hasta que alguien cuelga.
 * El texto de Claude se va diciendo por frases mientras llega, y si la IA
 * falla a mitad de llamada, sigue el motor local sin cortar.
 */

export type EstadoLlamada = 'sonando' | 'hablando' | 'escuchando' | 'pensando' | 'terminada'

export interface OpcionesLlamada {
  negocio: Negocio
  conector: Conector
  almacen: AlmacenDemo
  ahora: () => DateTime
  ia: boolean
  oido: Oido | null
  mic: Microfono | null
  voz: Sintetizador
  alCambiar: () => void
}

export class Llamada {
  readonly id = `L${Date.now().toString(36).toUpperCase()}`
  estado: EstadoLlamada = 'sonando'
  lineas: LineaLlamada[] = []
  parcial = ''
  aviso = ''
  motor: Motor
  eventos: Evento[] = []
  registro: RegistroLlamada | null = null
  private inicio = Date.now()
  private vivo = true
  private ocupado = false
  /** El motor está generando la respuesta (no se puede interrumpir con otra frase). */
  private pensando = false
  private turnoId = 0
  private escuchando = false
  private silencios = 0
  private abort: AbortController | null = null
  private oido: Oido | null

  constructor(private o: OpcionesLlamada) {
    this.oido = o.oido
    this.motor = o.ia ? new MotorClaude(o.negocio, o.conector, o.ahora, this.id) : new MotorLocal(o.negocio, o.conector, o.ahora, this.id)
  }

  get segundos() {
    return Math.round((Date.now() - this.inicio) / 1000)
  }

  get activa() {
    return this.vivo
  }

  /** Sin reconocimiento de voz (o con el micro silenciado), se contesta escribiendo. */
  get soloTexto() {
    return !this.oido || Boolean(this.o.mic?.silenciado)
  }

  private cambio(estado?: EstadoLlamada) {
    if (estado && this.vivo) this.estado = estado
    this.o.alCambiar()
  }

  private linea(quien: LineaLlamada['quien'], texto: string, unir = false) {
    const t = (Date.now() - this.inicio) / 1000
    const ultima = this.lineas.at(-1)
    if (unir && ultima?.quien === quien) ultima.texto += ' ' + texto
    else this.lineas.push({ quien, texto, t })
    this.cambio()
  }

  async empezar() {
    this.cambio('sonando')
    await tono('llamada').catch(() => {})
    if (!this.vivo) return
    this.inicio = Date.now()
    await this.decir(this.motor.saludo())
    void this.bucle()
  }

  private async decir(texto: string) {
    if (!this.vivo) return
    this.linea('recepcionista', texto)
    this.o.voz.hablar(texto)
    this.cambio('hablando')
    await this.o.voz.fin()
  }

  private async bucle() {
    if (this.escuchando) return
    this.escuchando = true
    try {
      while (this.vivo && !this.ocupado) {
        this.cambio('escuchando')
        if (this.soloTexto) return
        this.parcial = ''
        let texto: string | null
        try {
          texto = await this.oido!.escuchar((p) => {
            this.parcial = p
            this.cambio()
          })
        } catch (err) {
          this.aviso = err instanceof Error ? err.message : 'El micrófono ha fallado.'
          this.oido = null
          this.cambio()
          return
        }
        this.parcial = ''
        if (!this.vivo || this.ocupado) return
        if (!texto) {
          if (this.soloTexto) return
          this.silencios++
          if (this.silencios === 2) await this.decir('¿Sigue ahí? No le oigo bien.')
          if (this.silencios >= 4) {
            await this.decir('Parece que no se oye nada. Le cuelgo; vuelva a llamar cuando quiera.')
            return this.terminar()
          }
          continue
        }
        this.silencios = 0
        await this.turno(texto)
      }
    } finally {
      this.escuchando = false
    }
  }

  /** El cliente escribe en vez de hablar. */
  async escribir(texto: string) {
    const t = texto.trim()
    if (!t || !this.vivo || this.pensando) return
    // Si estaba hablando, se le corta: como cuando alguien te interrumpe al teléfono.
    this.oido?.parar()
    this.o.voz.cancelar()
    await this.turno(t)
    if (this.vivo && !this.ocupado) void this.bucle()
  }

  private async turno(texto: string) {
    const id = ++this.turnoId
    this.ocupado = true
    this.pensando = true
    this.linea('cliente', texto)
    this.cambio('pensando')
    this.abort = new AbortController()
    let hablado = false
    let primera = true
    try {
      const r = await this.motor.responder(
        texto,
        (frase) => {
          if (!this.vivo) return
          this.linea('recepcionista', frase, !primera)
          primera = false
          hablado = true
          this.o.voz.hablar(frase)
          this.cambio('hablando')
        },
        this.abort.signal,
      )
      this.pensando = false
      if (!hablado && r.decir && this.vivo) {
        this.linea('recepcionista', r.decir)
        this.o.voz.hablar(r.decir)
        this.cambio('hablando')
      }
      this.eventos.push(...r.eventos)
      for (const e of r.eventos) {
        if (e.tipo === 'reserva') this.linea('sistema', `Reserva ${e.reserva.codigo} creada: ${e.reserva.personas} pers. · ${fechaCorta(e.reserva.fecha)} · ${e.reserva.hora} · mesa ${e.reserva.mesa.toUpperCase()}`)
        if (e.tipo === 'cancelacion') this.linea('sistema', `Reserva ${e.reserva.codigo} cancelada`)
        if (e.tipo === 'transferir') this.linea('sistema', `Pasa la llamada al equipo: ${e.motivo}`)
      }
      await this.o.voz.fin()
      // Le han interrumpido con otra frase: ese turno nuevo manda.
      if (id !== this.turnoId) return
      this.ocupado = false
      if (r.colgar) await this.terminar()
    } catch (err) {
      this.pensando = false
      this.ocupado = false
      if (!this.vivo) return
      if (err instanceof ErrorIA || (err instanceof Error && this.motor.nombre === 'claude')) {
        // La IA falla (sin saldo, sin red…): sigue la llamada con el motor local.
        const codigo = err instanceof ErrorIA ? err.codigo : 'red'
        this.linea('sistema', codigo === 'sin_saldo' ? 'La cuenta de IA no tiene saldo: sigue el motor local.' : `La IA no responde (${codigo}): sigue el motor local.`)
        this.motor = new MotorLocal(this.o.negocio, this.o.conector, this.o.ahora, this.id)
        this.o.voz.cancelar()
        await this.decir('Perdone, he tenido un pequeño problema técnico. ¿Me repite qué necesitaba?')
        return
      }
      this.linea('sistema', `Error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  interrumpir() {
    this.o.voz.cancelar()
  }

  /** Cambia entre voz y texto con el micrófono silenciado. */
  silenciar(si: boolean) {
    if (!this.o.mic) return
    this.o.mic.silenciado = si
    if (si) this.oido?.parar()
    else if (!this.ocupado && this.vivo) void this.bucle()
    this.cambio()
  }

  async colgar() {
    await this.terminar()
  }

  private async terminar() {
    if (!this.vivo) return
    this.vivo = false
    this.oido?.parar()
    this.abort?.abort()
    this.o.voz.cancelar()
    this.estado = 'terminada'
    this.registro = this.crearRegistro()
    this.o.almacen.guardarLlamada(this.registro)
    this.o.alCambiar()
    await tono('colgar').catch(() => {})
  }

  private crearRegistro(): RegistroLlamada {
    const reservas = this.eventos.filter((e) => e.tipo === 'reserva')
    const cancelaciones = this.eventos.filter((e) => e.tipo === 'cancelacion')
    const transferida = this.eventos.find((e) => e.tipo === 'transferir')
    const habla = this.lineas.filter((l) => l.quien === 'cliente').length
    const resultado: Resultado = transferida ? 'transferida' : reservas.length ? 'reserva' : cancelaciones.length ? 'cancelacion' : habla > 0 ? 'informacion' : 'sin_resolver'
    const claude = this.motor instanceof MotorClaude ? this.motor : null
    const partes: string[] = []
    for (const e of reservas) if (e.tipo === 'reserva') partes.push(`Reserva para ${e.reserva.personas} el ${fechaCorta(e.reserva.fecha)} a las ${e.reserva.hora} a nombre de ${e.reserva.nombre}${e.reserva.notas ? ` (${e.reserva.notas})` : ''}.`)
    for (const e of cancelaciones) if (e.tipo === 'cancelacion') partes.push(`Canceló la reserva ${e.reserva.codigo}.`)
    if (transferida?.tipo === 'transferir') partes.push(transferida.motivo)
    const resumen = claude?.resumen || partes.join(' ') || (habla ? 'Consulta informativa.' : 'Colgó sin hablar.')
    return {
      id: this.id,
      inicio: new Date(this.inicio).toISOString(),
      duracion: this.segundos,
      motor: this.motor.nombre,
      lineas: this.lineas,
      resultado,
      codigos: [...reservas, ...cancelaciones].map((e) => (e.tipo === 'reserva' || e.tipo === 'cancelacion' ? e.reserva.codigo : '')),
      resumen,
      tokens: claude ? { entrada: claude.uso.entrada, salida: claude.uso.salida } : undefined,
    }
  }
}
