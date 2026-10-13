import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Llamada } from '../lib/llamada'
import type { Negocio } from '../lib/negocio'
import type { Microfono } from '../lib/voz/microfono'
import * as I from './Iconos'

interface Props {
  negocio: Negocio
  llamada: Llamada | null
  mic: Microfono
  preparando: string | null
  error: string
  etiquetaMotor: string
  onLlamar: () => void
  onNueva: () => void
  onAjustes: () => void
  ajustes: React.ReactNode
}

const ESTADOS: Record<string, string> = {
  sonando: 'Llamando…',
  hablando: 'Hablando',
  escuchando: 'Escuchando',
  pensando: 'Pensando',
  terminada: 'Llamada finalizada',
}

export default function Telefono(p: Props) {
  const l = p.llamada
  return (
    <div className="relative mx-auto w-full max-w-[380px]">
      <div className="relative flex h-[min(740px,calc(100svh-7.5rem))] min-h-[580px] flex-col overflow-hidden rounded-[2.6rem] border border-line bg-[#0b0c0f] shadow-[0_40px_120px_-30px_rgba(200,255,0,0.18),0_0_0_10px_#15171c,0_0_0_11px_#2a2d34]">
        <BarraEstado />
        {!l && <Reposo {...p} />}
        {l && l.estado !== 'terminada' && <EnLlamada {...p} llamada={l} />}
        {l && l.estado === 'terminada' && <Fin {...p} llamada={l} />}
        {p.ajustes}
      </div>
    </div>
  )
}

function BarraEstado() {
  const [hora, setHora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 20_000)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="flex items-center justify-between px-7 pt-4 pb-1 font-mono text-[11px] text-soft/80">
      <span>{hora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
      <span className="h-5 w-24 rounded-full bg-black" aria-hidden />
      <span className="flex items-center gap-1" aria-hidden>
        <span className="flex items-end gap-[2px]">
          {[4, 6, 8, 10].map((h) => (
            <span key={h} className="w-[3px] rounded-sm bg-soft/80" style={{ height: h }} />
          ))}
        </span>
        5G
      </span>
    </div>
  )
}

function Avatar({ grande = false }: { grande?: boolean }) {
  return (
    <div className={`grid place-items-center rounded-full bg-gradient-to-br from-[#1d2128] to-[#0f1115] ring-1 ring-line ${grande ? 'h-28 w-28' : 'h-12 w-12'}`}>
      <I.Luna width={grande ? 46 : 22} height={grande ? 46 : 22} className="text-acid" />
    </div>
  )
}

function Reposo(p: Props) {
  return (
    <div className="flex flex-1 flex-col items-center px-7 pt-10 pb-8 text-center">
      <Avatar grande />
      <h2 className="mt-5 font-display text-4xl tracking-wide">{p.negocio.nombre}</h2>
      <p className="font-mono text-sm text-mute">{p.negocio.telefono}</p>
      <p className="mt-3 rounded-full border border-line px-3 py-1 font-mono text-[11px] text-soft">Recepcionista IA · 24 h</p>

      <div className="mt-auto w-full">
        {p.error && <p className="mb-4 rounded-xl border border-ko/40 bg-ko/10 px-3 py-2 text-left text-sm text-[#ffb3b3]">{p.error}</p>}
        {p.preparando ? (
          <p className="mb-5 font-mono text-xs text-acid" role="status">
            {p.preparando}
          </p>
        ) : (
          <p className="mb-5 text-sm text-mute">Pulsa para llamar. Te pedirá permiso para usar el micrófono.</p>
        )}
        <button
          onClick={p.onLlamar}
          disabled={Boolean(p.preparando)}
          className="group relative mx-auto grid h-20 w-20 place-items-center rounded-full bg-ok text-ink transition hover:scale-105 disabled:opacity-50"
          aria-label={`Llamar a ${p.negocio.nombre}`}
        >
          <span className="absolute inset-0 rounded-full bg-ok/40 [animation:onda_1.8s_ease-out_infinite]" aria-hidden />
          <I.Telefono width={30} height={30} strokeWidth={2} />
        </button>
        <button onClick={p.onAjustes} className="mt-6 inline-flex items-center gap-2 font-mono text-xs text-mute hover:text-soft">
          <I.Ajustes width={16} height={16} /> {p.etiquetaMotor}
        </button>
      </div>
    </div>
  )
}

function Orbe({ llamada, mic }: { llamada: Llamada; mic: Microfono }) {
  const anillo = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const paso = () => {
      const n = llamada.estado === 'escuchando' ? Math.min(1, mic.nivel) : 0
      if (anillo.current) anillo.current.style.transform = `scale(${1 + n * 0.55})`
      raf = requestAnimationFrame(paso)
    }
    raf = requestAnimationFrame(paso)
    return () => cancelAnimationFrame(raf)
  }, [llamada, mic])
  const e = llamada.estado
  return (
    <div className="relative grid h-24 w-24 place-items-center" aria-hidden>
      {e === 'sonando' && (
        <>
          <span className="absolute inset-0 rounded-full border border-acid/50 [animation:onda_1.6s_ease-out_infinite]" />
          <span className="absolute inset-0 rounded-full border border-acid/50 [animation:onda_1.6s_ease-out_0.8s_infinite]" />
        </>
      )}
      {e === 'hablando' && <span className="absolute inset-1 rounded-full bg-acid/25 [animation:latido_0.9s_ease-in-out_infinite]" />}
      {e === 'pensando' && <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-acid [animation:giro_0.9s_linear_infinite]" />}
      <div ref={anillo} className={`absolute inset-3 rounded-full transition-colors ${e === 'escuchando' ? 'bg-acid/20 ring-1 ring-acid/60' : 'bg-white/5'}`} />
      <Avatar />
    </div>
  )
}

function EnLlamada(p: Props & { llamada: Llamada }) {
  const l = p.llamada
  const lista = useRef<HTMLDivElement>(null)
  const [texto, setTexto] = useState('')
  const [, tic] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tic((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight, behavior: 'smooth' })
  }, [l.lineas.length, l.lineas.at(-1)?.texto, l.parcial])

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    const t = texto.trim()
    if (!t) return
    setTexto('')
    void l.escribir(t)
  }
  const mm = String(Math.floor(l.segundos / 60)).padStart(2, '0')
  const ss = String(l.segundos % 60).padStart(2, '0')
  const silenciado = l.soloTexto

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col items-center px-6 pt-4 pb-3">
        <Orbe llamada={l} mic={p.mic} />
        <p className="mt-2 font-display text-2xl tracking-wide">{p.negocio.nombre}</p>
        <p className="font-mono text-xs text-mute" role="status" aria-live="polite">
          {l.estado === 'sonando' ? ESTADOS.sonando : `${mm}:${ss} · ${silenciado && l.estado === 'escuchando' ? 'Escribe tu respuesta' : ESTADOS[l.estado]}`}
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-wider text-mute/70 uppercase">{l.motor.nombre === 'claude' ? 'Claude Haiku 5.5' : 'Motor local'}</p>
      </div>

      <div ref={lista} className="scroll-fino flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pb-3" aria-label="Transcripción de la llamada">
        {l.lineas.map((x, i) =>
          x.quien === 'sistema' ? (
            <p key={i} className="entra mx-auto my-1 max-w-[90%] rounded-lg border border-acid/30 bg-acid/5 px-2.5 py-1 text-center font-mono text-[10.5px] leading-snug text-acid">
              {x.texto}
            </p>
          ) : (
            <p
              key={i}
              className={`entra max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${x.quien === 'cliente' ? 'self-end rounded-br-md bg-acid text-ink' : 'self-start rounded-bl-md bg-card2 text-soft'}`}
            >
              {x.texto}
            </p>
          ),
        )}
        {l.parcial && <p className="max-w-[85%] self-end rounded-2xl rounded-br-md border border-dashed border-acid/50 px-3.5 py-2 text-[14px] text-acid/80 italic">{l.parcial}</p>}
        {l.aviso && <p className="mx-auto max-w-[90%] rounded-lg bg-ko/10 px-2.5 py-1 text-center text-xs text-[#ffb3b3]">{l.aviso} Puedes seguir escribiendo.</p>}
      </div>

      <form onSubmit={enviar} className="mx-4 mb-3 flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 focus-within:border-acid/60">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={silenciado ? 'Escribe lo que dirías…' : 'O escribe aquí…'}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-mute/70 sin-anillo"
          aria-label="Escribir en vez de hablar"
          disabled={l.estado === 'sonando' || l.estado === 'pensando'}
        />
        <button type="submit" className="grid h-8 w-8 place-items-center rounded-full bg-acid text-ink disabled:opacity-40" disabled={!texto.trim()} aria-label="Enviar">
          <I.Enviar width={16} height={16} />
        </button>
      </form>

      <div className="flex items-center justify-center gap-6 px-6 pb-7">
        <BotonRedondo etiqueta={silenciado ? 'Activar micro' : 'Silenciar'} onClick={() => l.silenciar(!p.mic.silenciado)} activo={silenciado} disabled={!p.mic.abierto}>
          {silenciado ? <I.MicroNo /> : <I.Micro />}
        </BotonRedondo>
        <button onClick={() => void l.colgar()} className="grid h-16 w-16 place-items-center rounded-full bg-ko text-white transition hover:scale-105" aria-label="Colgar">
          <I.Colgar width={28} height={28} strokeWidth={2} />
        </button>
        <BotonRedondo etiqueta="Interrumpir" onClick={() => l.interrumpir()} disabled={l.estado !== 'hablando'}>
          <I.Parar />
        </BotonRedondo>
      </div>
    </div>
  )
}

function BotonRedondo({ etiqueta, children, onClick, activo, disabled }: { etiqueta: string; children: React.ReactNode; onClick: () => void; activo?: boolean; disabled?: boolean }) {
  return (
    <div className="flex w-16 flex-col items-center gap-1">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={etiqueta}
        aria-pressed={activo}
        className={`grid h-12 w-12 place-items-center rounded-full border transition disabled:opacity-30 ${activo ? 'border-soft bg-soft text-ink' : 'border-line bg-card text-soft hover:border-mute'}`}
      >
        {children}
      </button>
      <span className="font-mono text-[10px] text-mute">{etiqueta}</span>
    </div>
  )
}

const RESULTADOS: Record<string, string> = {
  reserva: 'Reserva hecha',
  cancelacion: 'Reserva cancelada',
  informacion: 'Consulta resuelta',
  transferida: 'Pasada al equipo',
  sin_resolver: 'Sin resolver',
}

function Fin(p: Props & { llamada: Llamada }) {
  const r = p.llamada.registro
  return (
    <div className="flex flex-1 flex-col items-center px-7 pt-10 pb-8 text-center">
      <Avatar grande />
      <p className="mt-5 font-display text-3xl tracking-wide">Llamada finalizada</p>
      {r && (
        <>
          <p className="font-mono text-sm text-mute">
            {Math.floor(r.duracion / 60)}:{String(r.duracion % 60).padStart(2, '0')} min · {r.motor === 'claude' ? 'Claude' : 'motor local'}
          </p>
          <div className="mt-6 w-full rounded-2xl border border-line bg-card p-4 text-left">
            <p className="font-mono text-[11px] tracking-wider text-acid uppercase">{RESULTADOS[r.resultado]}</p>
            <p className="mt-1 text-sm text-soft">{r.resumen}</p>
            {r.codigos.filter(Boolean).length > 0 && <p className="mt-2 font-mono text-xs text-mute">Código: {r.codigos.filter(Boolean).join(', ')}</p>}
          </div>
        </>
      )}
      <div className="mt-auto flex w-full flex-col gap-3">
        <button onClick={p.onLlamar} className="rounded-full bg-ok py-3 font-medium text-ink transition hover:brightness-110">
          Volver a llamar
        </button>
        <a href="#panel" onClick={p.onNueva} className="rounded-full border border-line py-3 text-sm text-soft hover:border-mute">
          Ver en el panel del restaurante
        </a>
      </div>
    </div>
  )
}
