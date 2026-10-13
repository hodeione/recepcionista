import { DateTime } from 'luxon'
import { describe, expect, it } from 'vitest'
import { MotorLocal } from '../src/lib/dialogo/local'
import { TABERNA_LUNA as N } from '../src/lib/negocio'
import { ConectorLocal, almacenEnMemoria } from '../src/lib/reservas/conector'
import type { Reserva } from '../src/lib/reservas/motor'

const AHORA = DateTime.fromISO('2026-10-13T18:00', { zone: 'Europe/Madrid' })

function llamada(reservas: Reserva[] = []) {
  const almacen = almacenEnMemoria(reservas)
  const conector = new ConectorLocal(N, almacen, () => AHORA)
  const motor = new MotorLocal(N, conector, () => AHORA, 'test')
  const decir = async (t: string) => {
    const r = await motor.responder(t)
    return r
  }
  return { motor, almacen, decir }
}

describe('conversaciones con el motor local', () => {
  it('saluda presentándose', () => {
    expect(llamada().motor.saludo()).toMatch(/^Taberna Luna, buenas tardes\. Le atiende Luna/)
  })

  it('reserva completa en pocas frases', async () => {
    const { decir, almacen } = llamada()
    expect((await decir('Hola, quería reservar una mesa para el viernes')).decir).toMatch(/cuántas personas/)
    expect((await decir('somos cuatro')).decir).toMatch(/Para el viernes 16 .*hora/)
    expect((await decir('a las nueve y media')).decir).toMatch(/nombre de quién/)
    expect((await decir('Ane Etxeberria')).decir).toMatch(/alergia/)
    expect((await decir('uno es celíaco')).decir).toMatch(/Le confirmo: mesa para cuatro personas, el viernes 16 a las nueve y media, a nombre de Ane Etxeberria\. Y anoto: celiaquía/)
    const fin = await decir('sí, perfecto')
    expect(fin.decir).toMatch(/confirmada\. El código es/)
    expect(fin.eventos[0]).toMatchObject({ tipo: 'reserva', reserva: { personas: 4, hora: '21:30', notas: 'Celiaquía', llamada: 'test' } })
    expect(almacen.leer()).toHaveLength(1)
    const adios = await decir('no, nada más, gracias')
    expect(adios.colgar).toBe(true)
  })

  it('todo en una frase', async () => {
    const { decir } = llamada()
    const r = await decir('Buenas, soy Mikel, quería mesa para dos mañana a las nueve')
    expect(r.decir).toMatch(/alergia/)
    expect((await decir('no')).decir).toMatch(/mañana a las nueve, a nombre de Mikel/)
  })

  it('ofrece alternativas si está completo y acepta una', async () => {
    const llenas: Reserva[] = N.mesas
      .filter((m) => m.min <= 2 && m.plazas >= 2)
      .map((m, i) => ({ codigo: `Z${i}ZZZ`, nombre: 'X', fecha: '2026-10-16', hora: '21:00', turno: 'cena', personas: 2, mesa: m.id, notas: '', estado: 'confirmada', origen: 'web', creada: '' }))
    const { decir } = llamada(llenas)
    const r = await decir('mesa para dos el viernes a las nueve')
    expect(r.decir).toMatch(/A las nueve ya lo tengo completo\. Le puedo ofrecer/)
    const r2 = await decir('la primera')
    expect(r2.decir).toMatch(/nombre de quién/)
  })

  it('si la cena está llena y ofrece comida, lo dice', async () => {
    // Todas las mesas ocupadas para cenar el viernes
    const llenas: Reserva[] = N.mesas.map((m, i) => ({ codigo: `C${i}CCC`, nombre: 'X', fecha: '2026-10-16', hora: '21:00', turno: 'cena', personas: m.min, mesa: m.id, notas: '', estado: 'confirmada', origen: 'web', creada: '' }))
    const { decir } = llamada(llenas)
    const r = await decir('mesa para dos el viernes a las nueve')
    expect(r.decir).toMatch(/Le puedo ofrecer para comer a las dos, a las dos y media o a las tres/)
    expect((await decir('a las dos')).decir).toMatch(/a las dos\. ¿A nombre/)
  })

  it('avisa de que los lunes cierra', async () => {
    const { decir } = llamada()
    expect((await decir('quiero reservar el lunes')).decir).toMatch(/cerramos por descanso\. ¿Le viene bien otro día/)
  })

  it('corrige una hora sin servicio', async () => {
    const { decir } = llamada()
    const r = await decir('reserva para dos el sábado a las siete de la tarde')
    expect(r.decir).toMatch(/no damos mesas/)
  })

  it('responde preguntas y vuelve a la reserva', async () => {
    const { decir } = llamada()
    await decir('quería reservar para el sábado')
    const r = await decir('¿tenéis parking?')
    expect(r.decir).toMatch(/Mercado de La Ribera.*cuántas personas/)
  })

  it('preguntas sueltas', async () => {
    const { decir } = llamada()
    expect((await decir('¿a qué hora abrís?')).decir).toMatch(/de martes a domingo/)
    expect((await decir('¿cuánto cuesta el chuletón?')).decir).toMatch(/58 euros/)
    expect((await decir('¿tenéis algo para celíacos?')).decir).toMatch(/sin gluten/)
    expect((await decir('¿dónde estáis?')).decir).toMatch(/Calle Somera 12/)
  })

  it('cancela con el código dictado', async () => {
    const { decir, almacen } = llamada([
      { codigo: 'RX7K2', nombre: 'Lucía Martín', fecha: '2026-10-17', hora: '14:00', turno: 'comida', personas: 3, mesa: 's3', notas: '', estado: 'confirmada', origen: 'web', creada: '' },
    ])
    expect((await decir('quiero cancelar una reserva')).decir).toMatch(/código/)
    expect((await decir('erre equis siete ka dos')).decir).toMatch(/Lucía Martín para tres personas, el sábado 17 a las dos/)
    const r = await decir('sí')
    expect(r.eventos[0]).toMatchObject({ tipo: 'cancelacion' })
    expect(almacen.leer()[0]!.estado).toBe('cancelada')
  })

  it('cambia una reserva: cancela y hace otra', async () => {
    const { decir } = llamada([
      { codigo: 'RX7K2', nombre: 'Lucía Martín', fecha: '2026-10-17', hora: '14:00', turno: 'comida', personas: 3, mesa: 's3', notas: '', estado: 'confirmada', origen: 'web', creada: '' },
    ])
    await decir('quería cambiar mi reserva de día')
    await decir('a nombre de Lucía')
    expect((await decir('sí')).decir).toMatch(/Vamos con la nueva/)
    expect((await decir('el domingo a las dos')).decir).toMatch(/alergia/)
  })

  it('con una sola hora libre pregunta si le viene bien', async () => {
    // Domingo a mediodía: todas las mesas ocupadas desde las 13:30 (hasta las 15:00)
    const ocupadas: Reserva[] = N.mesas.map((m, i) => ({ codigo: `D${i}DDD`, nombre: 'X', fecha: '2026-10-18', hora: '13:30', turno: 'comida', personas: m.min, mesa: m.id, notas: '', estado: 'confirmada', origen: 'web', creada: '' }))
    const { decir } = llamada(ocupadas)
    const r = await decir('mesa para dos el domingo para comer')
    expect(r.decir).toMatch(/solo me queda mesa a las tres\. ¿Le viene bien\?/)
    expect((await decir('sí')).decir).toMatch(/a las tres\. ¿A nombre/)
  })

  it('una petición dicha se anota, no se responde como pregunta', async () => {
    const { decir } = llamada()
    await decir('mesa para dos el viernes a las nueve')
    const r = await decir('venimos con un bebé, necesitamos trona')
    expect(r.decir).toMatch(/^Lo anoto: necesita trona\. .*nombre de quién/)
    expect(r.decir).not.toMatch(/Si me dice que vienen niños/)
  })

  it('grupos grandes van al equipo', async () => {
    const { decir } = llamada()
    const r = await decir('quería reservar para quince personas el sábado')
    expect(r.decir).toMatch(/grupos de más de 10/)
    expect(r.eventos[0]).toMatchObject({ tipo: 'transferir' })
  })

  it('cancela buscando por nombre', async () => {
    const { decir } = llamada([
      { codigo: 'QWERT', nombre: 'Gorka Mendieta', fecha: '2026-10-18', hora: '21:00', turno: 'cena', personas: 2, mesa: 's1', notas: '', estado: 'confirmada', origen: 'telefono', creada: '' },
    ])
    await decir('al final no vamos a poder ir')
    expect((await decir('está a nombre de Gorka')).decir).toMatch(/Gorka Mendieta para dos personas, el domingo 18 a las nueve/)
  })

  it('pregunta qué día del fin de semana', async () => {
    const { decir } = llamada()
    expect((await decir('quería reservar para el fin de semana')).decir).toMatch(/sábado o el domingo/)
    expect((await decir('el domingo')).decir).toMatch(/cuántas personas/)
  })

  it('responde si abre un día concreto', async () => {
    const { decir } = llamada()
    expect((await decir('¿abrís el lunes?')).decir).toMatch(/El lunes 19 está cerrado|cerrado/)
    expect((await decir('¿y el martes estáis abiertos?')).decir).toMatch(/abrimos/)
  })

  it('saluda si solo le saludan', async () => {
    const { decir } = llamada()
    expect((await decir('hola buenas')).decir).toMatch(/en qué puedo ayudarle/i)
  })

  it('pasa con una persona si se lo piden o no entiende', async () => {
    const { decir } = llamada()
    const r = await decir('¿me pasas con el encargado?')
    expect(r.colgar).toBe(true)
    expect(r.eventos[0]).toMatchObject({ tipo: 'transferir' })
    const otra = llamada()
    await otra.decir('patata')
    await otra.decir('cosa rara')
    expect((await otra.decir('blablabla')).eventos[0]).toMatchObject({ tipo: 'transferir' })
  })
})
