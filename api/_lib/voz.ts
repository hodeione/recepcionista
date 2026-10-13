import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Voz realista con IA en la nube. Usa ElevenLabs si hay ELEVENLABS_API_KEY
 * (la más humana y con la latencia más baja) y si no OpenAI con
 * OPENAI_API_KEY. Devuelve MP3. Sin ninguna clave, la web usa la voz del
 * navegador.
 */

export const MAX_CARACTERES = 500

export type Proveedor = 'elevenlabs' | 'openai'

export function proveedor(env: NodeJS.ProcessEnv = process.env): Proveedor | null {
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs'
  if (env.OPENAI_API_KEY) return 'openai'
  return null
}

/** Voz por defecto de ElevenLabs: una de las voces predefinidas, que con el modelo multilingüe habla castellano. Cámbiala con ELEVENLABS_VOZ por una de España de la biblioteca de voces. */
export const VOZ_ELEVENLABS = 'EXAVITQu4vr4xnSDxMaL'

export interface PeticionVoz {
  url: string
  init: RequestInit
}

/** Construye la petición al proveedor (separado para poder probarlo sin red). */
export function peticionVoz(texto: string, p: Proveedor, env: NodeJS.ProcessEnv = process.env): PeticionVoz {
  if (p === 'elevenlabs') {
    const voz = env.ELEVENLABS_VOZ || VOZ_ELEVENLABS
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voz)}/stream?output_format=mp3_44100_64`,
      init: {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY!, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({
          text: texto,
          // Flash v2.5: multilingüe y con ~75 ms de latencia, pensado para conversación.
          model_id: env.ELEVENLABS_MODELO || 'eleven_flash_v2_5',
          language_code: 'es',
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true, speed: 1.03 },
        }),
      },
    }
  }
  return {
    url: 'https://api.openai.com/v1/audio/speech',
    init: {
      method: 'POST',
      headers: { authorization: `Bearer ${env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: env.OPENAI_VOZ || 'coral',
        input: texto,
        instructions: 'Habla en castellano de España, con acento peninsular. Eres la recepcionista de un restaurante al teléfono: cálida, cercana, sonriente y eficiente, con ritmo natural.',
        response_format: 'mp3',
      }),
    },
  }
}

/* ------------------------------------------------- enlaces firmados (Twilio) */

const secreto = (env: NodeJS.ProcessEnv) => env.VOZ_SECRETO || env.TWILIO_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''

/** Firma un texto para que Twilio pueda pedir su audio por GET sin abrir la voz a cualquiera. */
export function firmar(texto: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac('sha256', secreto(env)).update(texto).digest('base64url').slice(0, 32)
}

export function firmaValida(texto: string, firma: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!secreto(env)) return false
  const a = Buffer.from(firmar(texto, env))
  const b = Buffer.from(firma)
  return a.length === b.length && timingSafeEqual(a, b)
}
