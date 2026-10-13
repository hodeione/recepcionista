import type { InfoVoz } from '../lib/voz/sintesis'
import * as I from './Iconos'

export interface Preferencias {
  cerebro: 'auto' | 'local'
  oido: 'navegador' | 'whisper' | 'texto'
  vozId: string
  velocidad: number
  /** Voz realista con IA (ElevenLabs u OpenAI) o la del navegador. */
  vozModo: 'realista' | 'navegador'
}

export interface EstadoIA {
  comprobado: boolean
  configured: boolean
  motivo: string | null
}

export interface EstadoVozIA {
  comprobado: boolean
  configured: boolean
  proveedor: string | null
}

interface Props {
  vozIA: EstadoVozIA
  pref: Preferencias
  cambiar: (p: Partial<Preferencias>) => void
  voces: InfoVoz[]
  ia: EstadoIA
  hayNavegador: boolean
  onProbarVoz: () => void
  onCerrar: () => void
}

export default function Ajustes({ pref, cambiar, voces, ia, vozIA, hayNavegador, onProbarVoz, onCerrar }: Props) {
  const motivoIA = !ia.comprobado ? 'Comprobando…' : ia.configured ? 'Disponible' : ia.motivo === 'sin_saldo' ? 'Sin saldo en la cuenta' : 'Sin clave de API en el servidor'
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[#0b0c0f]/97 backdrop-blur" role="dialog" aria-label="Ajustes de la llamada">
      <div className="flex items-center justify-between px-6 pt-12 pb-4">
        <h3 className="font-display text-3xl tracking-wide">Ajustes</h3>
        <button onClick={onCerrar} className="grid h-9 w-9 place-items-center rounded-full border border-line text-soft hover:border-mute" aria-label="Cerrar ajustes">
          <I.Cerrar width={18} height={18} />
        </button>
      </div>
      <div className="scroll-fino flex-1 space-y-6 overflow-y-auto px-6 pb-8">
        <Grupo titulo="Cerebro">
          <Opcion activa={pref.cerebro === 'auto'} onClick={() => cambiar({ cerebro: 'auto' })} titulo="Claude Haiku 5.5" detalle={`Entiende cualquier forma de pedirlo. ${motivoIA}.`} aviso={ia.comprobado && !ia.configured ? 'Mientras no esté disponible, atiende el motor local.' : undefined} />
          <Opcion activa={pref.cerebro === 'local'} onClick={() => cambiar({ cerebro: 'local' })} titulo="Motor local" detalle="Reglas propias en tu navegador. Instantáneo y gratis." />
        </Grupo>
        <Grupo titulo="Oído">
          <Opcion activa={pref.oido === 'navegador'} onClick={() => cambiar({ oido: 'navegador' })} titulo="Reconocimiento del navegador" detalle={hayNavegador ? 'El más rápido, con texto en vivo. El audio lo procesa el servicio del navegador.' : 'Este navegador no lo tiene: usa Whisper.'} desactivada={!hayNavegador} />
          <Opcion activa={pref.oido === 'whisper'} onClick={() => cambiar({ oido: 'whisper' })} titulo="Whisper en tu equipo" detalle="Privado: el audio no sale del navegador. Descarga unos 80-140 MB la primera vez." />
          <Opcion activa={pref.oido === 'texto'} onClick={() => cambiar({ oido: 'texto' })} titulo="Solo texto" detalle="Escribes en lugar de hablar. Ella sigue hablando." />
        </Grupo>
        <Grupo titulo="Voz">
          <Opcion
            activa={pref.vozModo === 'realista'}
            onClick={() => cambiar({ vozModo: 'realista' })}
            titulo="Voz realista con IA"
            detalle={`Suena como una persona: ${vozIA.proveedor === 'openai' ? 'OpenAI' : 'ElevenLabs'}, generada frase a frase. ${!vozIA.comprobado ? 'Comprobando…' : vozIA.configured ? 'Disponible.' : 'Aún no está activada en el servidor.'}`}
            aviso={vozIA.comprobado && !vozIA.configured ? 'Mientras tanto se usa la voz del navegador.' : undefined}
          />
          <Opcion activa={pref.vozModo === 'navegador'} onClick={() => cambiar({ vozModo: 'navegador' })} titulo="Voz del navegador" detalle="Gratis y sin conexión. Suena más robótica salvo las voces «Natural» de Edge." />
          {pref.vozModo === 'navegador' && voces.length > 0 && (
            <>
              <select
                value={pref.vozId || voces[0]!.id}
                onChange={(e) => cambiar({ vozId: e.target.value })}
                className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-sm text-soft outline-none focus:border-acid/60"
                aria-label="Voz de la recepcionista"
              >
                {voces.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre} · {v.idioma}
                  </option>
                ))}
              </select>
              <label className="mt-3 flex items-center gap-3 font-mono text-xs text-mute">
                Velocidad
                <input type="range" min={0.8} max={1.4} step={0.05} value={pref.velocidad} onChange={(e) => cambiar({ velocidad: Number(e.target.value) })} className="flex-1 accent-[#c8ff00]" />
                {pref.velocidad.toFixed(2)}×
              </label>
              <button onClick={onProbarVoz} className="mt-3 rounded-full border border-line px-4 py-2 font-mono text-xs text-soft hover:border-mute">
                Probar voz
              </button>
              <p className="mt-2 text-xs text-mute">Las voces «Natural» de Edge y la de Google en Chrome son las que mejor suenan.</p>
            </>
          )}
          {pref.vozModo === 'realista' && (
            <button onClick={onProbarVoz} className="rounded-full border border-line px-4 py-2 font-mono text-xs text-soft hover:border-mute">
              Probar voz
            </button>
          )}
        </Grupo>
      </div>
    </div>
  )
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-2 font-mono text-[11px] tracking-wider text-mute uppercase">{titulo}</h4>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Opcion({ activa, onClick, titulo, detalle, aviso, desactivada }: { activa: boolean; onClick: () => void; titulo: string; detalle: string; aviso?: string; desactivada?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={desactivada}
      aria-pressed={activa}
      className={`block w-full rounded-xl border px-3.5 py-3 text-left transition disabled:opacity-40 ${activa ? 'border-acid/70 bg-acid/5' : 'border-line bg-card hover:border-mute'}`}
    >
      <span className="flex items-center gap-2 text-sm font-medium text-soft">
        <span className={`h-2 w-2 rounded-full ${activa ? 'bg-acid' : 'bg-line'}`} />
        {titulo}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-mute">{detalle}</span>
      {aviso && activa && <span className="mt-1 block text-xs text-acid/90">{aviso}</span>}
    </button>
  )
}
