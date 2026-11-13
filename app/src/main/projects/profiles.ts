import { randomUUID } from 'node:crypto'
import type { VoiceProfile } from '../../shared/projects'
const normalized = (v: number[]) => {
  if (v.length < 16 || v.some(x => !Number.isFinite(x))) throw new Error('Invalid speaker embedding')
  const norm = Math.hypot(...v)
  if (norm < 1e-8) throw new Error('Empty speaker embedding')
  return v.map(x => x / norm)
}
const cosine = (a: number[], b: number[]) => a.length === b.length ? a.reduce((s, x, i) => s + x * b[i], 0) : -1
export function matchVoice(embedding: number[], model: string, profiles: VoiceProfile[], threshold = .82, margin = .08) {
  const v = normalized(embedding)
  const candidates = profiles.filter(p => p.model === model && p.confirmed).map(p => {
    const samples = p.samples.filter(s => s.length === v.length).map(normalized)
    const centroid = samples.length ? normalized(v.map((_, i) => samples.reduce((s, a) => s + a[i], 0) / samples.length)) : []
    return { id: p.id, name: p.name, score: cosine(v, centroid) }
  }).sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return best && best.score >= threshold && best.score - (candidates[1]?.score ?? -1) >= margin ? best : null
}
export function confirmVoice(name: string, embedding: number[], model: string, profiles: VoiceProfile[]): VoiceProfile {
  name = name.trim()
  if (!name || name.length > 200) throw new Error('Enter a speaker name')
  const sample = normalized(embedding)
  const existing = profiles.find(p => p.name.toLocaleLowerCase() === name.toLocaleLowerCase() && p.model === model)
  if (existing && existing.samples.some(s => s.length !== sample.length)) throw new Error('Speaker embedding model dimensions changed')
  return { id: existing?.id ?? randomUUID(), name, model, confirmed: true,
    samples: [...(existing?.samples ?? []), sample].slice(-12) }
}
