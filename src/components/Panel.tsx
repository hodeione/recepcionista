import type { DateTime } from 'luxon'
import { useEffect, useMemo, useState } from 'react'
import { AlmacenDemo, type RegistroLlamada } from '../lib/almacen'
import { DIAS } from '../lib/es/hablar'
import type { Negocio } from '../lib/negocio'
import { estadoDia, type Reserva } from '../lib/reservas/motor'

const RESULTADO: Record<RegistroLlamada['resultado'], [string, string]> = {
  reserva: ['Reserva', 'bg-acid text-ink'],
  cancelacion: ['Cancelación', 'bg-soft text-ink'],
  informacion: ['Consulta', 'border border-line text-soft'],
  transferida: ['Al equipo', 'bg-[#ffb020] text-ink'],
  sin_resolver: ['Sin resolver', 'border border-ko/60 text-[#ffb3b3]'],
}

const ORIGEN: Record<Reserva['origen'], string> = { ia: 'Recepcionista IA', web: 'Web', telefono: 'Teléfono', local: 'En el local' }

export default function Panel({ almacen, negocio, ahora }: { almacen: AlmacenDemo; negocio: Negocio; ahora: () => DateTime }) {
  const [, setV] = useState(0)
  useEffect(() => AlmacenDemo.alCambiar(() => setV((x) => x + 1)), [])
  const reservas = almacen.leer()
  const llamadas = almacen.llamadas()
  const hoy = ahora().startOf('day')

  const dias = useMemo(() => {
    const out: { fecha: string; etiqueta: string; abierto: boolean }[] = []
    for (let i = 0; out.length < 7 && i < 10; i++) {
      const d = hoy.plus({ days: i })
      const fecha = d.toISODate()!
      out.push({ fecha, etiqueta: i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : `${DIAS[d.weekday - 1]!.slice(0, 3)} ${d.day}`, abierto: estadoDia(negocio, fecha, hoy).abierto })
    }
    return out
  }, [hoy.toISODate(), negocio])

  const [dia, setDia] = useState(dias[0]!.fecha)
  const nuevas = reservas.filter((r) => r.origen === 'ia' && r.estado === 'confirmada')

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
      <section className="min-w-0 rounded-3xl border border-line bg-card p-5 sm:p-6">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-3xl tracking-wide">Llamadas</h3>
          <span className="font-mono text-xs text-mute">{llamadas.length} registradas</span>
        </div>
        {llamadas.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">Aún no hay llamadas. Llama desde el teléfono y aparecerán aquí al momento, con la transcripción y lo que se hizo.</p>
        ) : (
          <ul className="scroll-fino mt-4 max-h-[560px] space-y-2 overflow-y-auto pr-1">
            {llamadas.map((l) => (
              <ItemLlamada key={l.id} l={l} />
            ))}
          </ul>
        )}
      </section>

      <section className="min-w-0 rounded-3xl border border-line bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-display text-3xl tracking-wide">Reservas</h3>
          <span className="font-mono text-xs text-mute">{nuevas.length ? `${nuevas.length} hechas por la recepcionista` : 'mismo motor que Taberna Luna'}</span>
        </div>
        <div className="scroll-fino mt-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist">
          {dias.map((d) => {
            const n = reservas.filter((r) => r.fecha === d.fecha && r.estado === 'confirmada').length
            const ia = reservas.some((r) => r.fecha === d.fecha && r.origen === 'ia')
            return (
              <button
                key={d.fecha}
                role="tab"
                aria-selected={dia === d.fecha}
                onClick={() => setDia(d.fecha)}
                className={`relative shrink-0 rounded-full border px-3 py-1.5 font-mono text-xs capitalize transition ${dia === d.fecha ? 'border-acid bg-acid text-ink' : 'border-line text-soft hover:border-mute'} ${!d.abierto ? 'opacity-50' : ''}`}
              >
                {d.etiqueta} <span className="opacity-70">{d.abierto ? n : '·'}</span>
                {ia && dia !== d.fecha && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-acid" aria-label="Con reservas de la recepcionista" />}
              </button>
            )
          })}
        </div>
        <ListaDia reservas={reservas} fecha={dia} negocio={negocio} abierto={dias.find((d) => d.fecha === dia)?.abierto ?? true} />
        <div className="mt-4 flex justify-end">
          <button onClick={() => almacen.reiniciar()} className="font-mono text-[11px] text-mute underline-offset-4 hover:text-soft hover:underline">
            Reiniciar la demo
          </button>
        </div>
      </section>
    </div>
  )
}

function ItemLlamada({ l }: { l: RegistroLlamada }) {
  const [abierta, setAbierta] = useState(false)
  const [etiqueta, clase] = RESULTADO[l.resultado]
  const hora = new Date(l.inicio).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  return (
    <li className="entra rounded-2xl border border-line bg-card2">
      <button onClick={() => setAbierta(!abierta)} className="w-full p-3.5 text-left" aria-expanded={abierta}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] ${clase}`}>{etiqueta}</span>
          <span className="font-mono text-xs text-mute">
            {hora} · {Math.floor(l.duracion / 60)}:{String(l.duracion % 60).padStart(2, '0')} · {l.motor === 'claude' ? 'Claude' : 'motor local'}
          </span>
          <span className="ml-auto font-mono text-[11px] text-mute">{abierta ? 'ocultar' : 'transcripción'}</span>
        </div>
        <p className="mt-1.5 text-sm text-soft">{l.resumen}</p>
      </button>
      {abierta && (
        <div className="space-y-1.5 border-t border-line px-3.5 py-3">
          {l.lineas.map((x, i) => (
            <p key={i} className="flex gap-2 text-[13px] leading-snug">
              <span className="w-10 shrink-0 font-mono text-[10.5px] text-mute/70">{Math.floor(x.t / 60)}:{String(Math.floor(x.t % 60)).padStart(2, '0')}</span>
              <span className={x.quien === 'cliente' ? 'text-acid' : x.quien === 'sistema' ? 'font-mono text-[11px] text-mute' : 'text-soft'}>
                {x.quien === 'cliente' ? 'Cliente: ' : x.quien === 'recepcionista' ? 'IA: ' : ''}
                {x.texto}
              </span>
            </p>
          ))}
          {l.tokens && (
            <p className="pt-1 font-mono text-[10.5px] text-mute">
              {l.tokens.entrada.toLocaleString('es-ES')} tokens de entrada · {l.tokens.salida.toLocaleString('es-ES')} de salida
            </p>
          )}
        </div>
      )}
    </li>
  )
}

function ListaDia({ reservas, fecha, negocio, abierto }: { reservas: Reserva[]; fecha: string; negocio: Negocio; abierto: boolean }) {
  const delDia = reservas.filter((r) => r.fecha === fecha).sort((a, b) => a.hora.localeCompare(b.hora) || a.nombre.localeCompare(b.nombre))
  if (!abierto) return <p className="mt-6 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">Cerrado por descanso.</p>
  const plazas = negocio.mesas.reduce((s, m) => s + m.plazas, 0)
  return (
    <div className="mt-4">
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['comida', 'cena'] as const).map((t) => {
          const c = delDia.filter((r) => r.turno === t && r.estado === 'confirmada').reduce((s, r) => s + r.personas, 0)
          return (
            <div key={t} className="rounded-xl border border-line px-3 py-2">
              <div className="flex justify-between font-mono text-[11px] text-mute capitalize">
                <span>{t}</span>
                <span>{c} comensales</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-acid/80" style={{ width: `${Math.min(100, (c / plazas) * 100 * 1.4)}%` }} />
              </div>
            </div>
          )
        })}
      </div>
      {delDia.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-mute">Sin reservas para este día.</p>
      ) : (
        <ul className="scroll-fino max-h-[430px] divide-y divide-line overflow-y-auto rounded-2xl border border-line">
          {delDia.map((r) => (
            <li key={r.codigo} className={`flex items-start gap-3 px-3.5 py-2.5 text-sm ${r.origen === 'ia' ? 'bg-acid/[0.06]' : ''} ${r.estado === 'cancelada' ? 'opacity-45' : ''}`}>
              <span className="w-11 shrink-0 pt-0.5 font-mono text-xs text-soft">{r.hora}</span>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-soft ${r.estado === 'cancelada' ? 'line-through' : ''}`}>
                  {r.nombre} <span className="text-mute">· {r.personas} pers.</span>
                </p>
                {r.notas && <p className="truncate text-xs text-mute">{r.notas}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-mono text-[10.5px] text-mute">mesa {r.mesa.toUpperCase()}</span>
                {r.origen === 'ia' ? (
                  <span className="rounded-full bg-acid px-1.5 py-px font-mono text-[10px] text-ink">{r.estado === 'cancelada' ? 'cancelada' : r.codigo}</span>
                ) : (
                  <span className="font-mono text-[10px] text-mute/70">{r.estado === 'cancelada' ? 'cancelada' : ORIGEN[r.origen]}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
