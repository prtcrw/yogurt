import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, access, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { atomic, context, inside, retainAudio, sha256, transcriptMarkdown } from '../src/main/projects/files'
import { confirmVoice, matchVoice } from '../src/main/projects/profiles'
import { externalGenerator } from '../src/main/projects/providers'
import { ProjectStore } from '../src/main/projects/store'
import { evidenceClaims, Workflows } from '../src/main/projects/workflow'
import type { Project, ProjectSegment } from '../src/shared/projects'
const roots: string[] = []
afterEach(async () => { for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'yogurt-project-test-')); roots.push(root)
  const vault = join(root, 'Vault'), archive = join(root, 'Audio'); await mkdir(vault); await mkdir(archive)
  const project: Project = { id: '', name: 'MLLO', vault, folder: '.', output: 'Meetings', provider: 'local', model: '', endpoint: '', retention: 'reference', archive, contextFolders: ['.'] }
  const db = new DatabaseSync(':memory:'), store = new ProjectStore(db)
  const saved = store.save(project)
  return { root, vault, archive, project: saved, store, db }
}
const segment: ProjectSegment = { id: 'S00001', startMs: 1000, endMs: 4000, text: 'We agreed to review the ontology on Friday.', speaker: null }
const result = JSON.stringify({ claims: [{ kind: 'decision', text: 'Review the ontology on Friday.', evidence: [{ segment_id: segment.id, quote: segment.text }] }], review: [] })

it('publishes complete atomic text without temporary files', async () => { const f = await fixture(); await atomic(join(f.vault, 'a.md'), 'complete'); expect(await readFile(join(f.vault, 'a.md'), 'utf8')).toBe('complete'); f.db.close() })
it('rejects escaped outputs and external symlinks', async () => { const f = await fixture(); expect(() => inside(f.vault, '../escape')).toThrow(); await symlink(f.archive, join(f.vault, 'linked')); expect(() => inside(f.vault, 'linked/file')).toThrow(); f.db.close() })
it('requires audio archives outside Obsidian', async () => { const f = await fixture(); expect(() => f.store.save({ ...f.project, retention: 'archive', archive: f.vault })).toThrow(/outside/); f.db.close() })
it('indexes project Markdown but skips generated meetings and links', async () => { const f = await fixture(); await writeFile(join(f.vault, 'glossary.md'), 'MLLO means Machine Learning Lifecycle Ontology'); await mkdir(join(f.vault, 'Meetings')); await writeFile(join(f.vault, 'Meetings/old.md'), 'generated'); await symlink(join(f.vault, 'glossary.md'), join(f.vault, 'alias.md')); const docs = await context(f.project, 'MLLO ontology'); expect(docs).toHaveLength(1); expect(docs[0].path).toContain('glossary.md'); f.db.close() })
for (const policy of ['archive', 'delete'] as const) it(`never ${policy}s audio before durable export`, async () => { const f = await fixture(), source = join(f.root, 'input.wav'); await writeFile(source, 'recording'); await expect(retainAudio(source, policy, f.archive, 'job', await sha256(source), async () => false)).rejects.toThrow(/waits/); await access(source); f.db.close() })
it('archives and verifies audio, preserving a usable URI', async () => { const f = await fixture(), source = join(f.root, 'input.wav'); await writeFile(source, 'recording'); const r = await retainAudio(source, 'archive', f.archive, 'job', await sha256(source), async () => true); expect(r.status).toBe('archived'); expect(await readFile(join(f.archive, 'job_input.wav'), 'utf8')).toBe('recording'); await expect(access(source)).rejects.toThrow(); f.db.close() })
it('keeps the original if its content changed', async () => { const f = await fixture(), source = join(f.root, 'input.wav'); await writeFile(source, 'before'); const hash = await sha256(source); await writeFile(source, 'after'); await expect(retainAudio(source, 'delete', '', 'job', hash, async () => true)).rejects.toThrow(/changed/); expect(await readFile(source, 'utf8')).toBe('after'); f.db.close() })
it('retains deleted audio provenance without promising a working link', () => { const text = transcriptMarkdown('Meeting', [segment], 'file:///old.wav', 'abc', 'deleted'); expect(text).toContain('audio_status: "deleted"'); expect(text).toContain('audio_sha256: "abc"'); expect(text).not.toContain('[Source recording](') })
it('rejects invented evidence and accepts actual quotes', () => { expect(evidenceClaims(result, [segment]).claims).toHaveLength(1); const fabricated = JSON.parse(result); fabricated.claims[0].evidence[0].quote = 'Alice promised deployment'; expect(evidenceClaims(JSON.stringify(fabricated), [segment]).claims).toHaveLength(0) })
it('does not confuse embedding versions or ambiguous speakers', () => { const v = [1, ...Array(15).fill(0)]; const a = confirmVoice('Alice', v, 'model1', []); expect(matchVoice(v, 'model1', [a])?.name).toBe('Alice'); expect(matchVoice(v, 'model2', [a])).toBeNull(); const b = confirmVoice('Bob', v, 'model1', [a]); expect(matchVoice(v, 'model1', [a, b])).toBeNull() })
it('bounds user-confirmed samples and never enrolls automatically', () => { const v = [1, ...Array(15).fill(0)]; let p = confirmVoice('Alice', v, 'm', []); for (let i = 0; i < 20; i++) p = confirmVoice('Alice', v, 'm', [p]); expect(p.samples).toHaveLength(12); expect(() => confirmVoice('Bad', [NaN], 'm', [])).toThrow() })
it('deduplicates queued inputs and allows explicit retry after failure', async () => { const f = await fixture(); const a = f.store.submit(f.project.id, 'input.wav', 'hash'); expect(f.store.submit(f.project.id, 'input.wav', 'hash').id).toBe(a.id); f.store.update(a.id, { state: 'failed' }); expect(f.store.submit(f.project.id, 'input.wav', 'hash').id).not.toBe(a.id); f.db.close() })
it('keeps API keys out of request bodies and sends only to the selected endpoint', async () => { const f = await fixture(); let called = ''; const generate = externalGenerator(() => 'secret', async (url, init) => { called = String(url); expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer secret'); expect(String(init?.body)).not.toContain('secret'); return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }] }), { status: 200 }) }); expect(await generate({ ...f.project, provider: 'openai', model: 'chosen' }, 'prompt', new AbortController().signal)).toBe('answer'); expect(called).toBe('https://api.openai.com/v1/responses'); f.db.close() })
it('does not fall back to another provider on errors', async () => { const f = await fixture(); let calls = 0; const generate = externalGenerator(() => 'secret', async () => { calls++; return new Response('', { status: 429 }) }); await expect(generate({ ...f.project, provider: 'anthropic', model: 'chosen' }, 'prompt', new AbortController().signal)).rejects.toThrow(/429/); expect(calls).toBe(1); f.db.close() })
it('completes import → review → summarize → Obsidian → external reference without repeated ASR', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source')
  let asr = 0
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => 'model',
    transcribe: async (_source, wav) => { asr++; await writeFile(wav, 'decoded'); return [segment] }, generate: async (_p, prompt) => prompt.startsWith('Choose the most useful') ? JSON.stringify({ kind: 'next-meeting', reason: 'Review was explicitly agreed.', draft: 'Review the ontology.', sources: ['S00001'] }) : result })
  const job = await workflows.import(f.project.id, source)
  await expect.poll(() => f.store.job(job.id).state).toBe('review')
  expect(await readFile(f.store.job(job.id).transcript!, 'utf8')).toContain(segment.text)
  workflows.summarize(job.id)
  await expect.poll(() => f.store.job(job.id).state).toBe('completed')
  const done = f.store.job(job.id)
  expect(await readFile(done.notes!, 'utf8')).toContain('Review the ontology')
  expect(await readFile(done.transcript!, 'utf8')).toContain('audio_status: "external"')
  await access(source); expect(asr).toBe(1); workflows.dispose(); f.db.close()
})
it('failed generation keeps source audio and an Obsidian transcript', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source'); f.store.save({ ...f.project, retention: 'delete' })
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => 'model', transcribe: async (_s, wav) => { await writeFile(wav, 'decoded'); return [segment] }, generate: async () => { throw new Error('Provider unavailable') } })
  const job = await workflows.import(f.project.id, source); await expect.poll(() => f.store.job(job.id).state).toBe('review'); workflows.summarize(job.id)
  await expect.poll(() => f.store.job(job.id).state).toBe('failed'); await access(source); await access(f.store.job(job.id).transcript!); workflows.dispose(); f.db.close()
})

it('speaker-backend failures preserve a reviewable transcript and original audio', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source'); f.store.save({ ...f.project, recognizeSpeakers: true })
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => 'model', transcribe: async (_s, wav) => { await writeFile(wav, 'decoded'); return [segment] }, voices: async () => { throw new Error('Voice model unavailable') }, generate: async () => result })
  const job = await workflows.import(f.project.id, source); await expect.poll(() => f.store.job(job.id).state).toBe('review')
  expect(f.store.job(job.id).error).toContain('Voice model unavailable'); await access(f.store.job(job.id).transcript!); await access(source)
  await expect(access(join(f.root, 'jobs', job.id, 'audio.wav'))).rejects.toThrow(); workflows.dispose(); f.db.close()
})
it('context-selected none produces no forced task and deletes audio only after the full export', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source'); f.store.save({ ...f.project, retention: 'delete' })
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => 'model', transcribe: async (_s, wav) => { await writeFile(wav, 'decoded'); return [segment] }, generate: async (_p, prompt) => prompt.startsWith('Choose the most useful') ? JSON.stringify({ kind: 'none', reason: 'Informational meeting; no follow-up needed.', draft: '', sources: [] }) : result })
  const job = await workflows.import(f.project.id, source); await expect.poll(() => f.store.job(job.id).state).toBe('review'); workflows.summarize(job.id)
  await expect.poll(() => f.store.job(job.id).state).toBe('completed')
  const { dirname } = await import('node:path')
  expect(await readFile(join(dirname(f.store.job(job.id).notes!), 'follow-up.md'), 'utf8')).toContain('No additional follow-up is suggested.')
  expect(await readFile(f.store.job(job.id).transcript!, 'utf8')).toContain('audio_status: "deleted"')
  await expect(access(source)).rejects.toThrow(); workflows.dispose(); f.db.close()
})
it('invalid follow-up sources prevent destructive retention', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source'); f.store.save({ ...f.project, retention: 'delete' })
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => 'model', transcribe: async (_s, wav) => { await writeFile(wav, 'decoded'); return [segment] }, generate: async (_p, prompt) => prompt.startsWith('Choose the most useful') ? JSON.stringify({ kind: 'implementation', reason: 'invented', draft: 'Do work', sources: ['S99999'] }) : result })
  const job = await workflows.import(f.project.id, source); await expect.poll(() => f.store.job(job.id).state).toBe('review'); workflows.summarize(job.id)
  await expect.poll(() => f.store.job(job.id).state).toBe('failed'); await access(source); workflows.dispose(); f.db.close()
})
it('live exports keep all audio track links and the meeting title, and do not reset an existing job', async () => {
  const f = await fixture(), a = join(f.root, 'me.m4a'), b = join(f.root, 'them.m4a'); await writeFile(a, 'a'); await writeFile(b, 'b')
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => undefined, generate: async () => result })
  const job = await workflows.fromMeeting(f.project.id, 'Ontology review', [segment], [a, b]); const text = await readFile(job.transcript!, 'utf8')
  expect(text).toContain('Ontology review'); expect(text).toContain('me.m4a'); expect(text).toContain('them.m4a')
  f.store.update(job.id, { state: 'completed' }); expect((await workflows.fromMeeting(f.project.id, 'Ontology review', [segment], [a, b])).state).toBe('completed')
  workflows.dispose(); f.db.close()
})

it('a retry uses saved speech and honors a disabled follow-up without rerunning ASR or retention', async () => {
  const f = await fixture(), source = join(f.root, 'call.wav'); await writeFile(source, 'source'); const hash = await sha256(source)
  const p = f.store.save({ ...f.project, followUps: false, retention: 'delete' }), job = f.store.submit(p.id, source, 'retry')
  f.store.update(job.id, { projectSnapshot: p, sourceHash: hash, segments: [segment], state: 'failed', retained: true, audioUri: 'file:///deleted/call.wav', audioStatus: 'deleted' }); await rm(source)
  let calls = 0
  const workflows = new Workflows({ store: f.store, directory: join(f.root, 'jobs'), changed: () => {}, asrModel: () => undefined, transcribe: async () => { throw new Error('ASR must not run again') }, generate: async () => { calls++; return result } })
  workflows.retry(job.id); expect(f.store.job(job.id).state).toBe('review'); workflows.summarize(job.id)
  await expect.poll(() => f.store.job(job.id).state).toBe('completed'); expect(calls).toBe(1)
  expect(await readFile(f.store.job(job.id).transcript!, 'utf8')).toContain('audio_status: "deleted"'); workflows.dispose(); f.db.close()
})
