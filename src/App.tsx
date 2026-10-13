import { DateTime } from 'luxon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Ajustes, { type EstadoIA, type EstadoVozIA, type Preferencias } from './components/Ajustes'
import * as I from './components/Iconos'
import Panel from './components/Panel'
import Telefono from './components/Telefono'
import { AlmacenDemo } from './lib/almacen'
import { Llamada } from './lib/llamada'
import { TABERNA_LUNA } from './lib/negocio'
import { ConectorLocal } from './lib/reservas/conector'
import { Microfono } from './lib/voz/microfono'
import { VozNube } from './lib/voz/nube'
import { OidoNavegador, OidoWhisper, hayReconocimientoNavegador, type Oido } from './lib/voz/reconocimiento'
import { Sintetizador, cargarVoces, type InfoVoz } from './lib/voz/sintesis'

const negocio = TABERNA_LUNA
const ahora = () => DateTime.now().setZone(negocio.zonaHoraria)
const CLAVE_PREF = 'recepcionista:pref'
const DHT = 'https://h-com-bay.vercel.app'
const REPO = 'https://github.com/hodeione/recepcionista'

const EJEMPLOS = [
  'Quería mesa para cuatro el sábado a las nueve',
  '¿Tenéis cosas sin gluten?',
  'Somos dos, mañana para comer',
  'Quiero cancelar mi reserva',
  '¿Se puede ir con perro?',
  '¿Dónde estáis?',
]

function leerPref(): Preferencias {
  const def: Preferencias = { cerebro: 'auto', oido: hayReconocimientoNavegador() ? 'navegador' : 'whisper', vozId: '', velocidad: 1.05, vozModo: 'realista' }
  try {
    const p = JSON.parse(localStorage.getItem(CLAVE_PREF) ?? '{}') as Partial<Preferencias>
    return { ...def, ...p }
  } catch {
    return def
  }
}

export default function App() {
  const almacen = useMemo(() => new AlmacenDemo(negocio, ahora), [])
  const conector = useMemo(() => new ConectorLocal(negocio, almacen, ahora), [almacen])
  const voz = useRef(new Sintetizador())
  const vozNube = useRef(new VozNube(voz.current))
  const mic = useRef(new Microfono())
  const whisper = useRef<OidoWhisper | null>(null)

  const [pref, setPref] = useState(leerPref)
  const [voces, setVoces] = useState<InfoVoz[]>([])
  const [ia, setIa] = useState<EstadoIA>({ comprobado: false, configured: false, motivo: null })
  const [vozIA, setVozIA] = useState<EstadoVozIA>({ comprobado: false, configured: false, proveedor: null })
  const [llamada, setLlamada] = useState<Llamada | null>(null)
  const [, setVersion] = useState(0)
  const [preparando, setPreparando] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [verAjustes, setVerAjustes] = useState(false)

  useEffect(() => {
    void cargarVoces().then(setVoces)
    fetch('/api/llamada')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { configured: boolean; motivo: string | null }) => setIa({ comprobado: true, configured: d.configured, motivo: d.motivo }))
      .catch(() => setIa({ comprobado: true, configured: false, motivo: 'sin_clave' }))
    fetch('/api/voz')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { configured: boolean; proveedor: string | null }) => setVozIA({ comprobado: true, configured: d.configured, proveedor: d.proveedor }))
      .catch(() => setVozIA({ comprobado: true, configured: false, proveedor: null }))
  }, [])

  useEffect(() => {
    voz.current.vozId = pref.vozId
    voz.current.velocidad = pref.velocidad
    try {
      localStorage.setItem(CLAVE_PREF, JSON.stringify(pref))
    } catch {
      /* sin almacenamiento */
    }
  }, [pref])

  const cambiar = (p: Partial<Preferencias>) => setPref((x) => ({ ...x, ...p }))
  const usaIA = pref.cerebro === 'auto' && ia.configured
  const usaVozIA = pref.vozModo === 'realista' && vozIA.configured
  const vozActual = () => (usaVozIA && !vozNube.current.desactivada ? vozNube.current : voz.current)
  const etiquetaMotor = `${usaIA ? 'Claude Haiku 5.5' : 'Motor local'} · ${pref.oido === 'navegador' ? 'voz del navegador' : pref.oido === 'whisper' ? 'Whisper local' : 'solo texto'}`

  const llamar = useCallback(async () => {
    setError('')
    setVerAjustes(false)
    // iOS solo deja sonar audio que salga de un toque: se «desbloquea» aquí, en silencio.
    vozNube.current.desbloquear()
    if (typeof speechSynthesis !== 'undefined') {
      const u = new SpeechSynthesisUtterance('.')
      u.volume = 0
      speechSynthesis.speak(u)
    }
    let oido: Oido | null = null
    if (pref.oido !== 'texto') {
      try {
        setPreparando('Pidiendo permiso para el micrófono…')
        await mic.current.abrir()
        if (pref.oido === 'whisper') {
          whisper.current ??= new OidoWhisper(mic.current, (p) => {
            if (!p.listo) setPreparando(`Descargando Whisper · ${p.total ? Math.round((p.cargado / p.total) * 100) : 0} % (solo la primera vez)`)
          })
          setPreparando('Preparando Whisper…')
          await whisper.current.preparar()
          oido = whisper.current
        } else oido = new OidoNavegador()
      } catch (e) {
        setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Sin permiso para el micrófono: la llamada sigue por texto. Puedes darlo en el candado de la barra de direcciones.' : `No se pudo usar el micrófono (${e instanceof Error ? e.message : e}). La llamada sigue por texto.`)
        oido = null
      }
    }
    setPreparando(null)
    const l = new Llamada({ negocio, conector, almacen, ahora, ia: usaIA, oido, mic: mic.current.abierto ? mic.current : null, voz: vozActual(), alCambiar: () => setVersion((v) => v + 1) })
    setLlamada(l)
    void l.empezar()
  }, [pref.oido, usaIA, usaVozIA, conector, almacen])

  // Al salir de la página no se queda el micrófono abierto.
  useEffect(() => () => mic.current.cerrar(), [])
  useEffect(() => {
    if (llamada?.estado === 'terminada') mic.current.cerrar()
  }, [llamada?.estado])

  const probarVoz = () => {
    vozNube.current.desbloquear()
    const v = vozActual()
    v.cancelar()
    v.hablar(`Hola, soy ${negocio.asistente}, la recepcionista de ${negocio.nombre}. ¿En qué puedo ayudarle?`)
  }

  const activa = llamada?.activa && llamada.estado !== 'sonando'

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line/60 bg-ink/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <a href={DHT} className="flex items-center gap-2.5" aria-label="DH Technology">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-acid font-display text-lg text-ink">DH</span>
            <span className="font-display text-xl tracking-wider">
              Recepcionista <span className="text-acid">IA</span>
            </span>
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#panel" className="hidden rounded-full px-3 py-1.5 text-mute hover:text-soft sm:block">
              Panel
            </a>
            <a href="#como" className="hidden rounded-full px-3 py-1.5 text-mute hover:text-soft sm:block">
              Cómo funciona
            </a>
            <a href={REPO} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-soft hover:border-mute">
              <I.GitHub /> <span className="hidden sm:inline">Código</span>
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
          <div>
            <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">DH Technology · IA de voz</p>
            <h1 className="mt-4 font-display text-[clamp(3rem,6.2vw,5.4rem)] leading-[0.88] tracking-wide">
              Tu restaurante coge el teléfono. <span className="text-acid">Siempre.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft/90">
              Una recepcionista con IA que atiende llamadas, mira las mesas libres de verdad, reserva, cancela y responde dudas de la carta o los alérgenos. Pruébala: llama a <strong className="text-white">Taberna Luna</strong> desde aquí y mira cómo aparece la reserva en el panel.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px]">
              <Chip>{usaIA ? 'Cerebro: Claude Haiku 5.5' : 'Cerebro: motor local'}</Chip>
              <Chip>Oído: {pref.oido === 'navegador' ? 'reconocimiento del navegador' : pref.oido === 'whisper' ? 'Whisper en tu equipo' : 'texto'}</Chip>
              <Chip>Voz: {usaVozIA ? `realista (${vozIA.proveedor === 'openai' ? 'OpenAI' : 'ElevenLabs'})` : (voces.find((v) => v.id === pref.vozId)?.nombre ?? voces[0]?.nombre ?? 'del navegador')}</Chip>
            </div>
            <div className="mt-8">
              <p className="font-mono text-[11px] tracking-wider text-mute uppercase">{activa ? 'Toca para decirlo (o dilo en voz alta)' : 'Durante la llamada, prueba a decir'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EJEMPLOS.map((e) => (
                  <button
                    key={e}
                    disabled={!activa}
                    onClick={() => void llamada?.escribir(e)}
                    className="rounded-full border border-line bg-card px-3.5 py-1.5 text-left text-sm text-soft transition enabled:hover:border-acid/60 enabled:hover:text-white disabled:cursor-default"
                  >
                    «{e}»
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Telefono
            negocio={negocio}
            llamada={llamada}
            mic={mic.current}
            preparando={preparando}
            error={error}
            etiquetaMotor={etiquetaMotor}
            onLlamar={() => void llamar()}
            onNueva={() => setLlamada(null)}
            onAjustes={() => setVerAjustes(true)}
            ajustes={
              verAjustes && (
                <Ajustes pref={pref} cambiar={cambiar} voces={voces} ia={ia} vozIA={vozIA} hayNavegador={hayReconocimientoNavegador()} onProbarVoz={probarVoz} onCerrar={() => setVerAjustes(false)} />
              )
            }
          />
        </section>

        <section id="panel" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
          <Titulo eyebrow="Lo que ve el dueño" titulo="Panel del restaurante, en vivo">
            Cada llamada queda registrada con su transcripción y su resultado. Las reservas entran en el mismo sistema que las de la web, con mesa asignada.
          </Titulo>
          <Panel almacen={almacen} negocio={negocio} ahora={ahora} />
        </section>

        <ComoFunciona />

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="grid gap-8 rounded-3xl border border-acid/30 bg-gradient-to-br from-acid/[0.07] to-transparent p-7 sm:p-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">Para tu negocio</p>
              <h2 className="mt-3 font-display text-5xl leading-none tracking-wide">Que no se te escape ni una reserva</h2>
              <p className="mt-4 max-w-xl text-soft/90">
                La configuramos con tu horario, tus mesas, tu carta y tus preguntas frecuentes, y la conectamos a tu sistema de reservas y a tu número de teléfono. Atiende a la vez todas las llamadas que entren, a cualquier hora, y te pasa las que necesitan a una persona.
              </p>
              <ul className="mt-5 grid gap-2 text-sm text-soft sm:grid-cols-2">
                {['Restaurantes, bares y sidrerías', 'Peluquerías y centros de estética', 'Clínicas, fisios y dentistas', 'Talleres y servicios con cita'].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-acid" /> {x}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col justify-center gap-3">
              <a href={DHT} className="rounded-full bg-acid py-3.5 text-center font-medium text-ink transition hover:brightness-110">
                Hablar con DH Technology
              </a>
              <a href={REPO} className="flex items-center justify-center gap-2 rounded-full border border-line py-3.5 text-center text-soft hover:border-mute">
                <I.GitHub /> Ver el código en GitHub
              </a>
              <p className="text-center font-mono text-[11px] text-mute">Con Claude Haiku 5.5, una llamada cuesta menos de un céntimo.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line/60">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 font-mono text-xs text-mute sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Hecho por <a href={DHT} className="text-soft hover:text-acid">DH Technology</a> · Taberna Luna es un restaurante de demostración.
          </p>
          <p>Las reservas de la demo se guardan solo en tu navegador.</p>
        </div>
      </footer>
    </>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-line bg-card px-3 py-1 text-soft">{children}</span>
}

function Titulo({ eyebrow, titulo, children }: { eyebrow: string; titulo: string; children: React.ReactNode }) {
  return (
    <div className="mb-8 max-w-2xl">
      <p className="font-mono text-xs tracking-[0.2em] text-acid uppercase">{eyebrow}</p>
      <h2 className="mt-3 font-display text-5xl leading-none tracking-wide">{titulo}</h2>
      <p className="mt-3 text-soft/85">{children}</p>
    </div>
  )
}

const PASOS = [
  {
    n: '01',
    titulo: 'Oído',
    texto: 'El reconocimiento de voz del navegador, con texto en vivo, o Whisper ejecutándose en tu equipo con WebGPU: el audio no sale del navegador. Un detector de voz propio decide cuándo has terminado de hablar.',
    tags: ['Web Speech API', 'Whisper · transformers.js', 'VAD adaptativo'],
  },
  {
    n: '02',
    titulo: 'Cerebro',
    texto: 'Claude Haiku 5.5 con cinco herramientas (disponibilidad, reservar, buscar, cancelar y colgar) y la ficha del negocio. Sin clave o sin saldo, atiende un motor de diálogo propio que entiende fechas, horas y comensales en castellano hablado.',
    tags: ['Claude Haiku 5.5', 'Tool use · streaming', 'Motor de reglas propio'],
  },
  {
    n: '03',
    titulo: 'Reservas',
    texto: 'Las mismas reglas que el sistema de Taberna Luna: mesa libre todo el turno, mesa mínima según comensales, ritmo de llegadas y antelación. Un conector usa directamente su API de agentes en n8n.',
    tags: ['Mismo motor que reservas-n8n', 'Conector n8n', 'Alternativas cercanas'],
  },
  {
    n: '04',
    titulo: 'Voz',
    texto: 'Voz realista con IA (ElevenLabs u OpenAI) que suena como una persona, generada frase a frase mientras Claude escribe: la siguiente se descarga mientras suena la anterior. Sin clave, la voz del navegador. Horas, fechas y códigos se escriben para el oído.',
    tags: ['ElevenLabs · OpenAI', 'Frases en streaming', 'Web Audio'],
  },
]

function ComoFunciona() {
  return (
    <section id="como" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-14 sm:px-6">
      <Titulo eyebrow="Por dentro" titulo="Cómo funciona">
        Todo corre en tu navegador salvo Claude y la voz realista, que pasan por funciones sin servidor que solo reenvían el texto. Sin base de datos, sin grabaciones. Y la misma recepcionista puede contestar un número de teléfono real con Twilio.
      </Titulo>
      <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {PASOS.map((p) => (
          <li key={p.n} className="flex flex-col rounded-3xl border border-line bg-card p-6">
            <span className="font-mono text-xs text-acid">{p.n}</span>
            <h3 className="mt-2 font-display text-3xl tracking-wide">{p.titulo}</h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-soft/85">{p.texto}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <span key={t} className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-mute">
                  {t}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {[
          ['115', 'pruebas automáticas: castellano hablado, conversaciones enteras, la API y el teléfono'],
          ['0 €', 'sin IA: el motor local atiende gratis y al instante'],
          ['< 1 cént.', 'por llamada con Claude Haiku 5.5'],
        ].map(([n, t]) => (
          <div key={n} className="rounded-3xl border border-line p-6">
            <p className="font-display text-5xl text-acid">{n}</p>
            <p className="mt-1 text-sm text-soft/85">{t}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
