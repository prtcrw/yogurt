import { existsSync, readFileSync } from 'node:fs'
import { open, readdir, realpath, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ModelCandidate, ModelSearchState } from '../shared/runtime'
import { atomic } from './projects/files'
import type { RuntimePreferencesStore } from './runtimePreferences'
import { validateModel } from './runtimePreferences'

/** Only small GGUF metadata is read; tensor data and tokenizer arrays are never loaded. */
export function ggufIdentity(buffer: Buffer): { name?: string; architecture?: string } {
  const result: { name?: string; architecture?: string } = {}
  try {
    if (buffer.length < 24 || buffer.toString('ascii', 0, 4) !== 'GGUF' || ![2, 3].includes(buffer.readUInt32LE(4))) return result
    const count = Number(buffer.readBigUInt64LE(16)); let offset = 24
    const u32 = () => { const value = buffer.readUInt32LE(offset); offset += 4; return value }
    const u64 = () => { const value = Number(buffer.readBigUInt64LE(offset)); offset += 8; if (!Number.isSafeInteger(value)) throw new Error('Invalid length'); return value }
    const string = () => { const size = u64(); if (size > buffer.length - offset) throw new Error('Metadata exceeds prefix'); const value = buffer.toString('utf8', offset, offset + size); offset += size; return value }
    const skip = (type: number) => {
      const sizes: Record<number, number> = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 }
      if (type === 8) { const size = u64(); offset += size }
      else if (type === 9) {
        const element = u32(), length = u64()
        if (!sizes[element]) throw new Error('Large metadata array; stop reading')
        offset += sizes[element] * length
      } else if (sizes[type]) offset += sizes[type]
      else throw new Error('Unknown metadata')
      if (offset > buffer.length) throw new Error('Metadata exceeds prefix')
    }
    for (let i = 0; i < Math.min(count, 256); i++) {
      const key = string(), type = u32()
      if (type === 8 && ['general.name', 'general.architecture'].includes(key)) {
        const value = string(); if (key === 'general.name') result.name = value; else result.architecture = value
      } else skip(type)
      if (result.name && result.architecture) break
    }
  } catch { /* a bounded prefix is sufficient; filename is the fallback */ }
  return result
}
export async function discoverModels(roots: string[], limits = { files: 3000, directories: 2500, depth: 7 }): Promise<{ candidates: ModelCandidate[]; searched: string[] }> {
  const candidates: ModelCandidate[] = [], searched: string[] = [], visited = new Set<string>(), found = new Set<string>()
  let files = 0, directories = 0
  async function walk(path: string, depth: number) {
    if (depth > limits.depth || files >= limits.files || directories >= limits.directories) return
    let canonical: string
    try { canonical = await realpath(path) } catch { return }
    if (visited.has(canonical)) return
    visited.add(canonical); directories++
    let entries
    try { entries = await readdir(path, { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files >= limits.files || directories >= limits.directories) break
      const target = join(path, entry.name)
      if (entry.isDirectory()) { if (!entry.name.startsWith('.')) await walk(target, depth + 1); continue }
      if (!/\.(bin|gguf)$/i.test(entry.name) && !/^sha256-[a-f0-9]+$/i.test(entry.name)) continue
      files++
      try {
        const actual = await realpath(target), info = await stat(actual)
        if (!info.isFile() || info.size < 4 || found.has(actual)) continue
        const file = await open(actual, 'r'); const buffer = Buffer.alloc(Math.min(65536, info.size))
        try { await file.read(buffer, 0, buffer.length, 0) } finally { await file.close() }
        let kind: ModelCandidate['kind'], name = basename(target)
        if (buffer.toString('ascii', 0, 4) === 'GGUF') {
          const meta = ggufIdentity(buffer)
          if (/embed|nomic|bert|rerank|mmproj|vocoder|tts|clip|whisper/i.test(name + ' ' + (meta.name ?? '') + ' ' + (meta.architecture ?? ''))) continue
          kind = 'summary'; name = meta.name || name
        } else if (buffer.readUInt32LE(0) === 0x67676d6c && (/whisper|ggml-(tiny|base|small|medium|large|distil)/i.test(name) || buffer.length >= 8 && buffer.readUInt32LE(4) >= 50000 && buffer.readUInt32LE(4) < 53000)) kind = 'speech'
        else continue
        found.add(actual); candidates.push({ kind, path: actual, name, bytes: info.size })
      } catch { /* unreadable or incomplete weights are not candidates */ }
    }
  }
  for (const root of [...new Set(roots)]) {
    if (!existsSync(root)) continue
    searched.push(root); await walk(root, 0)
  }
  return { candidates: candidates.sort((a, b) => a.kind.localeCompare(b.kind) || a.bytes - b.bytes || a.path.localeCompare(b.path)), searched }
}

export class ModelDiscovery {
  private result: ModelSearchState = { scanning: false, candidates: [], searched: [], confirmed: false, localSummary: true }
  private pending?: (selection: { asr?: string; llm?: string }) => void
  private scanPromise?: Promise<ModelSearchState>
  private extraRoots: string[] = []
  constructor(private d: { preferences: RuntimePreferencesStore; roots: string[]; choiceFile: string; enabled: boolean; localSummary(): boolean }) {}
  required() { return this.d.enabled && !this.confirmed() }
  private confirmed() { try { return JSON.parse(readFileSync(this.d.choiceFile, 'utf8')).confirmed === true } catch { return false } }
  state(): ModelSearchState { return { ...this.result, confirmed: this.confirmed(), localSummary: this.d.localSummary() } }
  async scan(folder?: string): Promise<ModelSearchState> {
    if (folder) this.extraRoots.push(folder)
    if (this.scanPromise) return this.scanPromise
    this.result.scanning = true
    this.scanPromise = discoverModels([...this.d.roots, ...this.extraRoots]).then(value => { this.result = { ...this.result, ...value }; return this.state() }).finally(() => { this.result.scanning = false; this.scanPromise = undefined })
    await this.scanPromise; return this.state()
  }
  async waitForSelection() {
    const waiting = new Promise<{ asr?: string; llm?: string }>(resolve => { this.pending = resolve })
    void this.scan()
    return waiting
  }
  async choose(selection: { speech: string; summary: string }) {
    if (typeof selection.speech !== 'string' || typeof selection.summary !== 'string') throw new Error('Choose model files or the recommended downloads')
    const current = this.d.preferences.read()
    if (this.pending && Object.keys(current).some(key => !['speechModel', 'summaryModel'].includes(key) && current[key as keyof typeof current] !== this.d.preferences.startup[key as keyof typeof current])) throw new Error('Restart Yogurt Projects to apply the new storage/tool paths before continuing setup.')
    if (selection.speech) await validateModel(selection.speech, 'speech')
    if (selection.summary) await validateModel(selection.summary, 'summary')
    const saved = await this.d.preferences.save({ ...this.d.preferences.read(), speechModel: selection.speech, summaryModel: selection.summary })
    await atomic(this.d.choiceFile, JSON.stringify({ confirmed: true }))
    if (this.pending) {
      // Before the first download/inference, model selections can take effect immediately.
      this.d.preferences.startup.speechModel = saved.saved.speechModel; this.d.preferences.startup.summaryModel = saved.saved.summaryModel
      const resolve = this.pending; this.pending = undefined
      resolve({ asr: saved.saved.speechModel || undefined, llm: saved.saved.summaryModel || undefined })
    }
  }
}
