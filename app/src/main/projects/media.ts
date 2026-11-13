import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createTranscriber } from '../asr/transcribe'
import { createWhisperServer, whisperServerPath, vadModelPath } from '../asr/server'
import type { ProjectSegment } from '../../shared/projects'
export const voiceModel = 'fluidaudio-wespeaker256-d653a34'
export type VoiceTurn = { speaker: string; startMs: number; endMs: number; embedding: number[]; quality: number }
export function audioHelper(): string {
  const candidates = [process.resourcesPath && join(process.resourcesPath, 'bin/yogurt-project-audio'),
    join(__dirname, '../../resources/bin/yogurt-project-audio'), join(__dirname, '../../../resources/bin/yogurt-project-audio'), join(process.cwd(), 'resources/bin/yogurt-project-audio')].filter((s): s is string => !!s)
  const path = candidates.find(existsSync)
  if (!path) throw new Error('The project audio helper is missing. Build it with pnpm -C app project-audio.')
  return path
}
export async function helper(args: string[], signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(audioHelper(), args, { stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    let error = ''
    const stop = () => { if (p.pid) { try { process.kill(-p.pid, 'SIGTERM'); setTimeout(() => { if (p.exitCode === null && p.signalCode === null) { try { process.kill(-p.pid!, 'SIGKILL') } catch {} } }, 3000).unref() } catch {} } }
    signal.addEventListener('abort', stop, { once: true })
    p.stderr.on('data', (b: Buffer) => { error = (error + b).slice(-2000) })
    p.on('error', reject)
    p.on('close', code => { signal.removeEventListener('abort', stop); code || signal.aborted ? reject(new Error(signal.aborted ? 'Job cancelled' : error || 'Audio helper stopped')) : resolve() })
    if (signal.aborted) stop()
  })
}
/** AVFoundation handles common Mac formats; an optional installed FFmpeg adds other containers/codecs. */
export async function decodeFile(source: string, wav: string, signal: AbortSignal, ffmpegBinary?: string) {
  try { await helper(['decode', source, wav], signal); return } catch (error) {
    if (signal.aborted) throw error
    const binary = ffmpegBinary || (['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find(existsSync) ?? 'ffmpeg')
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, ['-nostdin', '-v', 'error', '-y', '-i', source, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le', '-f', 'wav', '-write_bext', '0', '-bitexact', wav], { stdio: ['ignore', 'ignore', 'pipe'], signal })
      let message = ''
      child.stderr.on('data', (b: Buffer) => { message = (message + b).slice(-1000) })
      child.on('error', () => reject(new Error('The Mac could not decode this format. Install FFmpeg (brew install ffmpeg) for additional codecs, or convert the file to WAV/M4A.')))
      child.on('close', code => code || signal.aborted ? reject(new Error(signal.aborted ? 'Cancelled' : 'Could not decode this recording. ' + message)) : resolve())
    })
  }
}
export async function transcribeFile(source: string, wav: string, model: string, signal: AbortSignal,
  progress: (value: string) => void, options: { ffmpegBinary?: string; language?: string } = {}): Promise<ProjectSegment[]> {
  progress('Decoding recording'); await decodeFile(source, wav, signal, options.ffmpegBinary)
  const server = createWhisperServer({ binary: whisperServerPath(), model, vadModel: vadModelPath() })
  const transcribe = createTranscriber({ url: () => server.url(), language: () => options.language || 'auto' })
  const file = await open(wav, 'r')
  const abort = () => server.kill()
  signal.addEventListener('abort', abort, { once: true })
  try {
    const segments: ProjectSegment[] = []
    let offset = 44, startMs = 0
    while (!signal.aborted) {
      const buffer = Buffer.alloc(16000 * 2 * 25)
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset)
      if (!bytesRead) break
      const samples = new Float32Array(Math.floor(bytesRead / 2))
      for (let i = 0; i < samples.length; i++) samples[i] = buffer.readInt16LE(i * 2) / 32768
      progress(`Transcribing · ${Math.floor(startMs / 60000)} min`)
      const lines = await transcribe({ track: 'them', startMs, samples })
      for (const line of lines) segments.push({ id: `S${String(segments.length + 1).padStart(5, '0')}`, startMs: line.startMs, endMs: line.endMs, text: line.text, speaker: null })
      offset += bytesRead; startMs += samples.length / 16
    }
    if (signal.aborted) throw new Error('Job cancelled')
    if (!segments.length) throw new Error('No speech was transcribed; the original audio was kept')
    return segments
  } finally { await file.close(); await server.stop(); signal.removeEventListener('abort', abort) }
}
export async function diarize(wav: string, output: string, models: string, signal: AbortSignal): Promise<VoiceTurn[]> {
  await helper(['diarize', wav, output, models], signal)
  const result = JSON.parse(await readFile(output, 'utf8'))
  if (result.model !== voiceModel || !Array.isArray(result.segments)) throw new Error('Unexpected speaker model output')
  return result.segments
}

/** A bounded listening sample for explicit voice confirmation; no full recording in renderer memory. */
export async function voiceSample(wav: string, target: string, startMs: number, endMs: number) {
  const file = await open(wav, 'r')
  try {
    const offset = 44 + Math.max(0, Math.floor(startMs * 16)) * 2
    const size = Math.min(16000 * 2 * 5, Math.max(0, Math.floor((endMs - startMs) * 16)) * 2)
    const header = Buffer.alloc(44); await file.read(header, 0, 44, 0)
    const bytes = Buffer.alloc(size); const { bytesRead } = await file.read(bytes, 0, size, offset)
    if (bytesRead < 32000) throw new Error('Voice sample is too short')
    header.writeUInt32LE(bytesRead + 36, 4); header.writeUInt32LE(bytesRead, 40)
    await writeFile(target, Buffer.concat([header, bytes.subarray(0, bytesRead)]), { mode: 0o600 })
  } finally { await file.close() }
}
