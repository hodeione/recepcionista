/// <reference lib="webworker" />
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/*
 * Whisper en un hilo aparte (adaptado de hodeione/susurro).
 *   -> { type: 'load', device, shaderF16 }
 *   -> { type: 'run', id, audio }           audio mono a 16 kHz
 *   <- progress, ready, text { id, text }, error
 */

env.allowLocalModels = false

const REPO = 'onnx-community/whisper-base'
type Device = 'webgpu' | 'wasm'
type In = { type: 'load'; device: Device; shaderF16: boolean } | { type: 'run'; id: number; audio: Float32Array }

const post = (m: unknown) => (self as DedicatedWorkerGlobalScope).postMessage(m)
let asr: AutomaticSpeechRecognitionPipeline | null = null
let cargando: Promise<void> | null = null

async function load(device: Device, shaderF16: boolean) {
  if (asr) return post({ type: 'ready', device })
  const t0 = performance.now()
  asr = (await pipeline('automatic-speech-recognition', REPO, {
    device,
    dtype: device === 'wasm' ? { encoder_model: 'q8', decoder_model_merged: 'q8' } : { encoder_model: shaderF16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' },
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status === 'progress' && p.file && p.total) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total })
    },
  })) as AutomaticSpeechRecognitionPipeline
  await asr(new Float32Array(16_000), { language: 'es' })
  post({ type: 'ready', device, ms: Math.round(performance.now() - t0) })
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      cargando ??= load(m.device, m.shaderF16)
      await cargando
    } else if (m.type === 'run') {
      if (cargando) await cargando
      if (!asr) throw new Error('El modelo no está cargado.')
      const out = (await asr(m.audio, { language: 'es', task: 'transcribe' })) as { text: string }
      post({ type: 'text', id: m.id, text: out.text.trim() })
    }
  } catch (err) {
    cargando = null
    post({ type: 'error', stage: m.type, message: err instanceof Error ? err.message : String(err), id: m.type === 'run' ? m.id : undefined })
  }
}
