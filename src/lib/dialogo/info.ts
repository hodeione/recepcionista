import { ALERGENOS, type Negocio, type Plato } from '../negocio'
import { normalizar } from '../es/numeros'
import { DIAS, horaHablada, lista } from '../es/hablar'

/** Respuestas informativas a partir de los datos del negocio: nunca se inventa nada. */

export function diasAbiertos(n: Negocio): string {
  const abiertos = [1, 2, 3, 4, 5, 6, 7].filter((d) => !n.cerrado.includes(d))
  if (abiertos.length === 7) return 'todos los días'
  // Días seguidos, con la semana circular: «de martes a domingo», «de jueves a lunes»
  const sig = (d: number) => (d % 7) + 1
  const ant = (d: number) => ((d + 5) % 7) + 1
  const inicio = abiertos.find((d) => !abiertos.includes(ant(d)))
  if (inicio !== undefined) {
    let fin = inicio
    let largo = 1
    while (abiertos.includes(sig(fin)) && sig(fin) !== inicio) {
      fin = sig(fin)
      largo++
    }
    if (largo === abiertos.length && largo > 2) return `de ${DIAS[inicio - 1]} a ${DIAS[fin - 1]}`
  }
  return `los ${lista(abiertos.map((d) => DIAS[d - 1]!))}`
}

const sinArticulo = (h: string) => horaHablada(h).replace(/^las? /, '')

export function horarioHablado(n: Negocio): string {
  const partes: string[] = []
  const c = n.horas.comida
  const d = n.horas.cena
  if (c.length) partes.push(`para comer, entre ${horaHablada(c[0]!)} y ${horaHablada(c.at(-1)!)}`)
  if (d.length) partes.push(`para cenar, entre ${horaHablada(d[0]!)} y ${horaHablada(d.at(-1)!)} de la noche`)
  const cerrados = n.cerrado.map((x) => `los ${DIAS[x - 1]}${DIAS[x - 1]!.endsWith('s') ? '' : 's'}`)
  return `Abrimos ${diasAbiertos(n)}. Se puede reservar ${lista(partes)}.${cerrados.length ? ` ${capital(lista(cerrados))} cerramos por descanso.` : ''}`
}

/** «de una a tres» para frases compactas. */
export const rangoTurno = (horas: string[]) => (horas.length ? `de ${sinArticulo(horas[0]!)} a ${sinArticulo(horas.at(-1)!)}` : '')

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Platos que se mencionan en la frase (por sus palabras significativas). */
export function platosMencionados(n: Negocio, texto: string): Plato[] {
  const t = normalizar(texto)
  return n.carta.filter((p) =>
    normalizar(p.nombre)
      .split(' ')
      .filter((w) => w.length > 4 && !['salvaje', 'jugosa', 'crema', 'fundente', 'botella'].includes(w))
      .some((w) => t.includes(w)),
  )
}

const precio = (p: number) => (Number.isInteger(p) ? `${p} euros` : `${String(p).replace('.', ',')} euros`)
const minus = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export function sobrePlatos(platos: Plato[]): string {
  return platos
    .slice(0, 2)
    .map((p) => {
      const al = p.alergenos.length ? `lleva ${lista(p.alergenos.map((a) => ALERGENOS[a] ?? a))}` : 'no lleva ningún alérgeno de declaración obligatoria'
      return `${capital(minus(p.nombre))} cuesta ${precio(p.precio)} y ${al}.`
    })
    .join(' ')
}

export function resumenCarta(n: Negocio): string {
  const por = new Map<string, Plato[]>()
  for (const p of n.carta) por.set(p.categoria, [...(por.get(p.categoria) ?? []), p])
  const elegir = (cat: string, k: number) => (por.get(cat) ?? []).slice(0, k).map((p) => minus(p.nombre))
  const fuertes = [...elegir('Del mar', 2), ...elegir('De la tierra', 1)]
  const postre = elegir('Postres', 1)
  return `Somos cocina de mercado. Para picar hay ${lista(elegir('Para picar', 2))}; de principal, ${lista(fuertes)}; y de postre, ${postre[0] ?? 'tartas caseras'}. ¿Quiere que le cuente algo de algún plato?`
}

export function sobreDieta(n: Negocio, dieta: string): string {
  if (dieta === 'sin gluten' || dieta === 'vegetariano' || dieta === 'vegano') {
    const aptos = n.carta.filter((p) => p.etiquetas.includes(dieta) && p.categoria !== 'Bebidas')
    if (!aptos.length) return `En la carta no tenemos platos marcados como ${dieta === 'vegano' ? 'veganos' : dieta}. Si reserva, lo anoto para que cocina lo tenga en cuenta.`
    const ejemplos = lista(aptos.slice(0, 3).map((p) => minus(p.nombre)))
    const apto = dieta === 'sin gluten' ? 'sin gluten' : `apt${aptos.length >= 6 ? 'a' : 'os'} para ${dieta === 'vegetariano' ? 'vegetarianos' : 'veganos'}`
    const frase = aptos.length >= 6 ? `buena parte de la carta es ${apto}` : `tenemos ${aptos.length} platos ${apto}`
    return `Sí, ${frase}: por ejemplo, ${ejemplos}. Si reserva, lo dejo anotado para cocina.`
  }
  const nombre = ALERGENOS[dieta] ?? dieta
  const sin = n.carta.filter((p) => !p.alergenos.includes(dieta) && p.categoria !== 'Bebidas')
  return `Tenemos ${sin.length} platos sin ${nombre}, como ${lista(sin.slice(0, 3).map((p) => minus(p.nombre)))}. Todos los platos tienen la información de alérgenos, y si reserva lo anoto para que cocina tenga cuidado.`
}
