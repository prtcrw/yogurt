import { constants, existsSync, readFileSync, realpathSync } from 'node:fs'
import { access, open, stat, statfs } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import type { RuntimePath, RuntimePreferences, RuntimeState } from '../shared/runtime'
import { atomic } from './projects/files'

export const runtimeDefaults: RuntimePreferences = { modelsDirectory: '', speechModel: '', summaryModel: '', workDirectory: '', voiceDirectory: '', codexBinary: '', claudeBinary: '', ffmpegBinary: '' }
export const directoryPaths: RuntimePath[] = ['modelsDirectory', 'workDirectory', 'voiceDirectory']
export const executablePaths: RuntimePath[] = ['codexBinary', 'claudeBinary', 'ffmpegBinary']
const labels: Record<RuntimePath, string> = { modelsDirectory: 'Model download folder', speechModel: 'Whisper speech model', summaryModel: 'Local summary model', workDirectory: 'Processing cache folder', voiceDirectory: 'Speaker model folder', codexBinary: 'Codex CLI', claudeBinary: 'Claude Code CLI', ffmpegBinary: 'FFmpeg' }

export function readRuntime(file: string): RuntimePreferences {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    return Object.fromEntries(Object.keys(runtimeDefaults).map(key => [key, typeof data[key] === 'string' ? data[key] : ''])) as RuntimePreferences
  } catch { return { ...runtimeDefaults } }
}
export function effectiveRuntime(saved: RuntimePreferences, profile: string): RuntimePreferences {
  const workDirectory = saved.workDirectory || join(profile, 'projects/jobs')
  return { ...saved, modelsDirectory: saved.modelsDirectory || join(profile, 'models'), workDirectory,
    voiceDirectory: saved.voiceDirectory || join(workDirectory, 'voice-models'), codexBinary: saved.codexBinary || 'codex', claudeBinary: saved.claudeBinary || 'claude', ffmpegBinary: saved.ffmpegBinary || 'ffmpeg' }
}
export async function validateModel(path: string, kind: 'speech' | 'summary') {
  await access(path, constants.R_OK)
  if (!(await stat(path)).isFile()) throw new Error('Choose a model file')
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(4); const { bytesRead } = await file.read(header, 0, 4, 0)
    const valid = bytesRead === 4 && (kind === 'summary' ? header.toString() === 'GGUF' : header.readUInt32LE() === 0x67676d6c)
    if (!valid) throw new Error(kind === 'speech' ? 'Choose a Whisper GGML .bin model, not a GGUF language model' : 'Choose a GGUF language model for local summaries')
  } finally { await file.close() }
}
export async function validateRuntime(value: RuntimePreferences): Promise<RuntimePreferences> {
  const next = { ...runtimeDefaults }
  for (const key of Object.keys(next) as RuntimePath[]) {
    if (typeof value[key] !== 'string' || value[key].length > 4096 || value[key].includes('\0')) throw new Error(`Invalid ${labels[key]} path`)
    const path = value[key].trim()
    if (!path) continue
    if (!isAbsolute(path)) throw new Error(`${labels[key]} must be an absolute path; leave blank for automatic selection`)
    try {
      if (directoryPaths.includes(key)) {
        if (!(await stat(path)).isDirectory()) throw new Error('Choose an existing folder')
        await access(path, constants.R_OK | constants.W_OK | constants.X_OK)
      } else if (executablePaths.includes(key)) {
        if (!(await stat(path)).isFile()) throw new Error('Choose an executable file')
        await access(path, constants.X_OK)
      } else await validateModel(path, key === 'speechModel' ? 'speech' : 'summary')
      next[key] = realpathSync(path)
    } catch (e) { throw new Error(`${labels[key]}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return next
}
export class RuntimePreferencesStore {
  readonly startup: RuntimePreferences
  constructor(readonly file: string, readonly profile: string) { this.startup = readRuntime(file) }
  read() { return readRuntime(this.file) }
  effective() { return effectiveRuntime(this.startup, this.profile) }
  async save(value: RuntimePreferences) { await atomic(this.file, JSON.stringify(await validateRuntime(value), null, 2)); return this.state() }
  async state(): Promise<RuntimeState> {
    const saved = this.read(), effective = this.effective()
    const restartRequired = Object.keys(saved).some(key => saved[key as RuntimePath] !== this.startup[key as RuntimePath])
    const status = await Promise.all((Object.keys(effective) as RuntimePath[]).filter(key => !executablePaths.includes(key)).map(async key => {
      const path = effective[key]
      try { const info = await stat(path); return { label: labels[key], path, exists: true, ...(info.isFile() ? { bytes: info.size } : {}) } }
      catch { return { label: labels[key], path, exists: false } }
    }))
    let path = effective.workDirectory
    while (!existsSync(path) && dirname(path) !== path) path = dirname(path)
    let freeBytes: number | undefined
    try { const disk = await statfs(path); freeBytes = disk.bavail * disk.bsize } catch {}
    return { saved, effective, restartRequired, status, freeBytes }
  }
}
