import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Project, ProjectJob, ProjectSegment } from '../../shared/projects'
import { atomic, context, inside, retainAudio, sha256, transcriptMarkdown } from './files'
import { confirmVoice, matchVoice } from './profiles'
import { diarize, decodeFile, transcribeFile, voiceModel, voiceSample } from './media'
import type { Generate } from './providers'
import { ProjectStore } from './store'

const fold = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim()
type Claim = { kind: string; text: string; evidence: Array<{ segment_id: string; quote: string }> }
export function evidenceClaims(raw: string, segments: ProjectSegment[]): { claims: Claim[]; review: string[] } {
  const body = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
  if (!Array.isArray(body.claims)) throw new Error('The summary provider did not return structured claims; audio was kept')
  const claims: Claim[] = [], review: string[] = Array.isArray(body.review) ? body.review.filter((v: unknown) => typeof v === 'string') : []
  for (const claim of body.claims) {
    const valid = typeof claim?.text === 'string' && typeof claim.kind === 'string' && ['discussion', 'decision', 'action', 'question'].includes(claim.kind)
      && Array.isArray(claim.evidence) && claim.evidence.length && claim.evidence.every((e: { segment_id: string; quote: string }) => {
        const source = segments.find(s => s.id === e?.segment_id)
        return source && typeof e.quote === 'string' && fold(e.quote).length >= 8 && fold(source.text).includes(fold(e.quote))
      })
    if (valid) claims.push(claim)
    else review.push(`Rejected an unsupported or malformed claim: ${String(claim?.text ?? '').slice(0, 500)}`)
  }
  return { claims, review }
}
export type WorkflowDeps = {
  store: ProjectStore; directory: string; changed(): void
  generate: Generate; asrModel(): string | undefined
  transcribe?: typeof transcribeFile; voices?: typeof diarize
  recording?(): boolean
  execution?(run: () => Promise<void>, stop: AbortController): Promise<void>
}
export class Workflows {
  private active?: { id: string; stop: AbortController }
  private stopped = false
  constructor(private d: WorkflowDeps) {
    // Persisted checkpoints survive a restart. Never silently repeat running inference.
    for (const j of d.store.jobs()) if (j.state === 'running') d.store.update(j.id, { state: 'failed', error: 'The app stopped during processing. Retry from the saved transcript.', stage: 'Interrupted' })
  }
  private update(id: string, values: Partial<ProjectJob>) { this.d.store.update(id, values); this.d.changed() }
  async import(projectId: string, source: string): Promise<ProjectJob> {
    const p = this.d.store.project(projectId)
    if (!/\.(mp4|mov|mkv|webm|wav|mp3|m4a|aac|flac|aiff|ogg)$/i.test(source)) throw new Error('Choose an audio or video file')
    const hash = await sha256(source)
    const fingerprint = createHash('sha256').update(hash + JSON.stringify(p)).digest('hex')
    const job = this.d.store.submit(projectId, source, fingerprint)
    if (!job.projectSnapshot) this.d.store.update(job.id, { projectSnapshot: p, sourceHash: hash })
    this.d.changed(); this.pump()
    return this.d.store.job(job.id)
  }
  async fromMeeting(projectId: string, title: string, segments: ProjectSegment[], audio: string[]): Promise<ProjectJob> {
    const p = this.d.store.project(projectId)
    const fingerprint = createHash('sha256').update(JSON.stringify({ segments, audio, p })).digest('hex')
    const job = this.d.store.submit(projectId, audio[0] ?? `yogurt:${title}`, fingerprint)
    if (job.projectSnapshot) return job
    this.d.store.update(job.id, { projectSnapshot: p, sourceHash: audio[0] ? await sha256(audio[0]) : '',
      title, segments, state: 'review', stage: 'Approve speakers and summarize', audioSources: audio })
    await this.exportTranscript(this.d.store.job(job.id))
    this.d.changed(); return this.d.store.job(job.id)
  }
  cancel(id: string) {
    const j = this.d.store.job(id)
    if (j.state === 'completed') return
    if (this.active?.id === id) this.active.stop.abort()
    this.update(id, { state: 'cancelled', stage: 'Cancelled; source audio kept' })
  }
  summarize(id: string) {
    const j = this.d.store.job(id)
    if (!j.segments?.length) throw new Error('Finish transcription first')
    if (this.active?.id === id) throw new Error('This job is already running')
    this.update(id, { state: 'queued', stage: 'Summary queued', error: undefined }); this.pump()
  }
  speakers(id: string, assignments: Record<string, string>) {
    const j = this.d.store.job(id)
    if (j.state !== 'review' && j.state !== 'failed') throw new Error('Wait until the job reaches review')
    this.update(id, { segments: j.segments?.map(s => ({ ...s, speaker: assignments[s.cluster ?? s.speaker ?? 'Unknown speaker']?.trim().slice(0, 200) || s.speaker })) })
  }
  enroll(id: string, speaker: string, name: string) {
    const j = this.d.store.job(id)
    if (!['review', 'failed'].includes(j.state)) throw new Error('Wait for speaker review')
    const embedding = j.voiceEmbeddings?.[speaker]
    if (!embedding) throw new Error('No voice sample for this speaker; enable speaker recognition and reimport the source')
    this.d.store.voice(confirmVoice(name, embedding, voiceModel, this.d.store.profiles())); this.d.changed()
  }
  private project(job: ProjectJob) { return job.projectSnapshot ?? this.d.store.project(job.projectId) }
  private output(job: ProjectJob) {
    const p = this.project(job), root = inside(p.vault, p.folder)
    const label = (job.title || basename(job.source, extname(job.source))).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 60) || 'Meeting'
    return inside(root, join(p.output, `${new Date(job.created).toISOString().slice(0, 10)}_${label}_${job.id.slice(0, 8)}`))
  }
  private async exportTranscript(job: ProjectJob, uri = job.audioSources?.length === 0 ? job.source : pathToFileURL(job.source).href, status = 'pending') {
    const folder = this.output(job), target = join(folder, 'transcript.md')
    await atomic(target, transcriptMarkdown(job.title || basename(job.source), job.segments ?? [], uri, job.sourceHash ?? '', status, job.audioSources))
    this.update(job.id, { transcript: target, audioUri: uri })
    return folder
  }
  private pump() {
    if (this.active || this.stopped || this.d.recording?.()) return
    const job = this.d.store.jobs().reverse().find(j => j.state === 'queued')
    if (!job) return
    const stop = new AbortController(); this.active = { id: job.id, stop }
    this.update(job.id, { state: 'running', error: undefined })
    const execute = () => this.run(this.d.store.job(job.id), stop.signal)
    void (this.d.execution ? this.d.execution(execute, stop) : execute()).catch(e => {
      this.update(job.id, { state: stop.signal.aborted ? 'cancelled' : 'failed', stage: 'Stopped; source audio kept unless retention already completed', error: String(e instanceof Error ? e.message : e) })
    }).finally(() => { this.active = undefined; this.pump() })
  }
  resumeQueue() { this.pump() }
  dispose() { this.stopped = true; this.active?.stop.abort() }
  private async run(job: ProjectJob, signal: AbortSignal) {
    const p = this.project(job), folder = join(this.d.directory, job.id)
    await mkdir(folder, { recursive: true })
    const wav = join(folder, 'audio.wav')
    const progress = (stage: string) => { if (signal.aborted) throw new Error('Cancelled'); this.update(job.id, { stage }) }
    if (!job.segments?.length) {
      const model = this.d.asrModel(); if (!model) throw new Error('Finish Yogurt speech-model setup before importing media')
      const cache = join(this.d.directory, 'transcripts', createHash('sha256').update((job.sourceHash ?? '') + model).digest('hex') + '.json')
      try {
      let segments: ProjectSegment[]
      try { segments = JSON.parse(await readFile(cache, 'utf8')); progress('Reusing saved transcript') }
      catch { segments = await (this.d.transcribe ?? transcribeFile)(job.source, wav, model, signal, progress); await atomic(cache, JSON.stringify(segments)) }
      this.update(job.id, { segments })
      await this.exportTranscript(this.d.store.job(job.id))
      if (p.recognizeSpeakers) {
        try {
        progress('Recognizing speakers · first use downloads the optional voice models')
        // A cache hit may not have decoded audio on disk yet.
        try { await access(wav) } catch { await decodeFile(job.source, wav, signal) }
        const turns = await (this.d.voices ?? diarize)(wav, join(folder, 'voices.json'), join(this.d.directory, 'voice-models'), signal)
        const embeddings: Record<string, number[]> = {}, samples: Record<string, string> = {}
        await mkdir(join(folder, 'samples'), { recursive: true })
        for (const turn of [...turns].sort((a, b) => b.quality - a.quality)) if (turn.quality >= .5 && turn.endMs - turn.startMs >= 2000 && !embeddings[turn.speaker]) {
          embeddings[turn.speaker] = turn.embedding
          const sample = join(folder, 'samples', createHash('sha256').update(turn.speaker).digest('hex').slice(0, 16) + '.wav')
          await voiceSample(wav, sample, turn.startMs, turn.endMs)
          samples[turn.speaker] = sample
        }
        segments = segments.map(s => {
          const best = turns.map(t => ({ t, overlap: Math.max(0, Math.min(s.endMs, t.endMs) - Math.max(s.startMs, t.startMs)) })).sort((a, b) => b.overlap - a.overlap)[0]
          const cluster = best?.overlap > 0 ? best.t.speaker : undefined
          const pure = best && best.overlap >= Math.max(1, s.endMs - s.startMs) * .75
          const known = pure && cluster && embeddings[cluster] ? matchVoice(embeddings[cluster], voiceModel, this.d.store.profiles()) : null
          return { ...s, cluster: pure ? cluster : undefined, speaker: known?.name ?? null }
        })
        this.update(job.id, { voiceEmbeddings: embeddings, voiceSamples: samples })
        } catch (error) { if (signal.aborted) throw error; this.update(job.id, { error: `Speaker recognition unavailable: ${String(error)}` }) }
      }
      this.update(job.id, { segments, state: 'review', stage: 'Approve speakers and summarize' })
      await this.exportTranscript(this.d.store.job(job.id))
      } finally { await rm(wav, { force: true }) }
      return
    }
    progress(`Summarizing with ${p.provider}`)
    const docs = await context(p, job.segments.map(s => s.text).join(' '))
    const claims: Claim[] = [], review: string[] = []
    const chunks: ProjectSegment[][] = []
    for (const segment of job.segments) {
      const last = chunks.at(-1)
      if (!last || JSON.stringify(last).length + JSON.stringify(segment).length > 8000) chunks.push([segment]); else last.push(segment)
    }
    for (const [index, segments] of chunks.entries()) {
      progress(`Summarizing ${index + 1}/${chunks.length} with ${p.provider}`)
      const prompt = 'Extract only transcript-supported discussion, decisions, actions and questions. Background is terminology only. Return JSON {"claims":[{"kind":"discussion|decision|action|question","text":"claim","evidence":[{"segment_id":"S00001","quote":"exact transcript quote"}]}],"review":["ambiguities"]}. Use only kind values, not the pipe-separated example. A decision requires explicit agreement. Never invent owners, attendees or deadlines.\n' + JSON.stringify({ transcript: segments, background: docs })
      const result = evidenceClaims(await this.d.generate(p, prompt, signal), segments)
      claims.push(...result.claims); review.push(...result.review)
    }
    if (signal.aborted) throw new Error('Cancelled')
    if (!claims.length) throw new Error('No evidence-backed summary claims were returned; the transcript and original audio were kept')
    const out = await this.exportTranscript(job)
    const notes = ['---', `project: ${JSON.stringify(p.name)}`, `provider: ${JSON.stringify(p.provider)}`, 'type: meeting-notes', '---', '',
      '# Meeting notes', '', '[Transcript](transcript.md) · [Review](review.md)', '',
      ...claims.map(c => `- ${c.text}\n` + c.evidence.map(e => `  - [${e.segment_id}](transcript.md#${e.segment_id.toLocaleLowerCase()}) — “${e.quote}”`).join('\n'))].join('\n') + '\n'
    await atomic(join(out, 'notes.md'), notes)
    await atomic(join(out, 'review.md'), '# Review\n\n- Exact evidence quotes were verified. Interpretations and speaker identity still need review.\n' + review.map(s => `- ${s}`).join('\n') + '\n')
    await atomic(join(out, 'context.json'), JSON.stringify(docs, null, 2))
    progress('Choosing a follow-up from the meeting context')
    const choiceText = await this.d.generate(p, 'Choose the most useful follow-up based on this meeting and its project background. Do not force tasks onto every meeting. Return JSON {"kind":"next-meeting|project-update|research|implementation|reference-notes|other|none","reason":"why this fits","draft":"Markdown draft or empty for none","sources":["S00001"]}. This is a proposed future-work draft, not an assertion that the meeting agreed to it. Reference only provided segment IDs. Never execute actions or modify existing project files.\n' + JSON.stringify({ claims, context: docs }), signal)
    const choice = JSON.parse(choiceText.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''))
    const sourceIds = new Set(job.segments.map(s => s.id))
    if (!['next-meeting', 'project-update', 'research', 'implementation', 'reference-notes', 'other', 'none'].includes(choice.kind)
      || typeof choice.reason !== 'string' || typeof choice.draft !== 'string' || !Array.isArray(choice.sources)
      || (choice.kind !== 'none' && choice.sources.length === 0)
      || choice.sources.some((id: unknown) => typeof id !== 'string' || !sourceIds.has(id))) throw new Error('Follow-up selection needs review; the original audio was kept')
    await atomic(join(out, 'follow-up.md'), `---\ntype: proposed-follow-up\nworkflow: ${JSON.stringify(choice.kind)}\nstatus: draft\n---\n\n# Suggested follow-up\n\n${choice.reason}\n\n${choice.kind === 'none' ? 'No additional follow-up is suggested.' : choice.draft}\n\nSources: ${choice.sources.map((id: string) => `[${id}](transcript.md#${id.toLocaleLowerCase()})`).join(', ')}\n`)

    this.update(job.id, { notes: join(out, 'notes.md') })
    progress('Applying audio retention')
    // Existing live Yogurt recordings stay in Yogurt: deletion/archiving belongs to its recording lifecycle.
    const live = job.audioSources !== undefined
    const retained = live ? { uri: job.audioSources?.[0] ? pathToFileURL(job.audioSources[0]).href : job.source, status: 'external' }
      : await retainAudio(job.source, p.retention, p.archive, job.id, job.sourceHash!, async () => {
        try { await access(join(out, 'transcript.md')); await access(join(out, 'notes.md')); await access(join(out, 'review.md')); await access(join(out, 'follow-up.md')); return true } catch { return false }
      })
    this.update(job.id, { retained: true, audioUri: retained.uri })
    await this.exportTranscript(job, retained.uri, retained.status)
    await rm(wav, { force: true })
    await rm(join(folder, 'samples'), { force: true, recursive: true })
    this.update(job.id, { voiceSamples: undefined, state: 'completed', stage: 'Exported to Obsidian', notes: join(out, 'notes.md') })
  }
}
