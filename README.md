# Recepcionista IA

**Tu restaurante coge el teléfono. Siempre.** Una recepcionista de voz con IA que atiende llamadas, consulta mesas libres de verdad, reserva, cancela y responde dudas de la carta y los alérgenos.

**Pruébala: [dht-recepcionista.vercel.app](https://dht-recepcionista.vercel.app)**. Llama a Taberna Luna desde el navegador y mira cómo aparece la reserva en el panel del restaurante.

![Llamada en curso](docs/llamada.png)

## Qué hace

- **Habla y escucha.** Pulsas llamar, suena el tono y la recepcionista te saluda. Le hablas como a una persona: «somos cuatro el sábado a las nueve, uno es celíaco».
- **Reserva de verdad.** Consulta la disponibilidad con las mismas reglas que el sistema de [Taberna Luna](https://github.com/hodeione/reservas-n8n): mesa libre todo el turno, mesa mínima según los comensales, ritmo de llegadas y antelación. Si no hay sitio, ofrece las horas más cercanas.
- **Cancela y cambia.** Entiende un código dictado letra a letra («erre, equis, siete…») o busca por nombre.
- **Responde dudas.** Horario, dirección, aparcamiento, terraza, mascotas, precios y alérgenos. Siempre con los datos del negocio, sin inventar nada.
- **Pasa la llamada a una persona** con los grupos grandes, cuando se lo piden o cuando no entiende.
- **Panel del dueño en vivo.** Cada llamada queda registrada con su transcripción, su resultado y un resumen. Las reservas entran con la mesa asignada.

![Panel del restaurante](docs/panel.png)

## Cómo funciona

```
 micrófono ──► OÍDO ──► CEREBRO ──► herramientas ──► RESERVAS
                │          │                            │
   Web Speech o Whisper   Claude Haiku 5.5        mismo motor que
   (WebGPU, en local)     o motor local           reservas-n8n
                           │
                           └──► VOZ: frases en streaming ──► altavoz
```

| Pieza | Cómo |
|---|---|
| **Oído** | El reconocimiento de voz del navegador (texto en vivo) o **Whisper ejecutándose en tu equipo** con transformers.js y WebGPU: el audio no sale del navegador. Un detector de voz propio, con umbral adaptativo al ruido de fondo, decide cuándo has terminado de hablar. |
| **Cerebro** | **Claude Haiku 5.5** con cinco herramientas estrictas: `consultar_disponibilidad`, `crear_reserva`, `buscar_reserva`, `cancelar_reserva` y `colgar`. La función de Vercel solo reenvía la conversación; las herramientas se ejecutan en el navegador, contra las reservas. |
| **Motor local** | Sin clave o sin saldo, atiende un motor de diálogo propio: entiende fechas («el jueves de la semana que viene», «el diecisiete»), horas («las diez menos cuarto», «a la una»), comensales («cuatro adultos y dos niños», «mi mujer y yo») y nombres en castellano hablado. Es instantáneo y gratis. Si la IA falla a mitad de llamada, toma el relevo sin colgar. |
| **Voz** | La síntesis del navegador, eligiendo la mejor voz en castellano (las «Natural» de Edge y la de Google en Chrome son las mejores). La respuesta de Claude se dice frase a frase mientras se genera, así que empieza a hablar antes de terminar. Horas, fechas y códigos se escriben para el oído. |

### Detalles de ingeniería

- **Streaming de punta a punta.** `/api/llamada` devuelve NDJSON: los fragmentos de texto según llegan y, al final, el mensaje completo con las llamadas a herramientas. El navegador agrupa el texto en frases y las va pasando a la voz.
- **Fecha sin errores.** Claude recibe una tabla con los próximos 14 días (`viernes 16/10 = 2026-10-16`), así no se equivoca al convertir «el viernes».
- **Conversación de solo añadir.** El historial (con los bloques de razonamiento intactos) vive en el navegador y se valida en el servidor: turnos alternos, tipos de bloque permitidos y tamaño máximo.
- **Barrera de gasto.** Límite por IP y global en la función, y detección de «sin saldo»: el servidor deja de intentarlo 10 minutos y la web pasa al motor local.
- **Conector n8n.** `src/lib/reservas/n8n.ts` habla con la [API de agentes de reservas-n8n](https://github.com/hodeione/reservas-n8n/blob/main/docs/openapi-agente.yaml), para conectar la recepcionista al sistema real del restaurante.
- **104 pruebas** con Vitest: comprensión del castellano, motor de disponibilidad, conversaciones enteras con el motor local, el bucle de herramientas de Claude con una API simulada, el detector de voz con señales sintéticas y la validación de la función.

## Cuánto cuesta

| | Coste |
|---|---|
| Motor local | 0 € |
| Claude Haiku 5.5 (0,10 $ / 0,50 $ por millón de tokens) | **menos de 1 céntimo por llamada** |
| Voz y Whisper | 0 € (en el navegador) |
| Alojamiento | Plan gratuito de Vercel |

## Ejecutarlo

```bash
npm install
npm run dev        # http://localhost:5173 (la función /api/llamada también funciona en local)
npm test           # 104 pruebas
npm run build
```

Para activar Claude, añade `ANTHROPIC_API_KEY` a las variables de entorno (en local, exportándola antes de `npm run dev`; en Vercel, en *Settings → Environment Variables*). Sin ella, todo funciona con el motor local.

## Estructura

```
api/llamada.ts                 Función de Vercel: un turno con Claude, en streaming
api/_lib/agente.ts             Instrucciones, ficha del negocio, herramientas y validación
src/lib/es/                    Castellano hablado: números, fechas, horas, nombres, intenciones
src/lib/dialogo/local.ts       Motor de diálogo sin IA (máquina de estados)
src/lib/dialogo/claude.ts      Bucle de herramientas con Claude en el navegador
src/lib/reservas/              Motor de disponibilidad y conectores (local y n8n)
src/lib/voz/                   Micrófono, detector de voz, Whisper y síntesis
src/lib/llamada.ts             Orquesta la llamada: escuchar → pensar → hablar
src/worker.ts                  Whisper en un hilo aparte
```

## Siguiente paso: teléfono real

La misma lógica sirve para una línea de verdad: un servidor pequeño recibe el audio de Twilio Media Streams, usa el `ConectorN8n` con las reservas del restaurante y responde con la misma recepcionista.

---

Hecho por [DH Technology](https://h-com-bay.vercel.app). ¿La quieres en tu negocio? Hablemos. Taberna Luna es un restaurante de demostración.

Licencia MIT.
