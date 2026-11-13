import { dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project, ProviderKind } from '../../shared/projects'
import type { Queue } from '../notes/queue'
import type { NotesModel } from '../notes/model'
import { ProjectStore } from './store'
import { Workflows } from './workflow'
import { atomic } from './files'
import { selectedNotesModel } from './selection'
import { externalGenerator } from './providers'

export function hookProjects(d: { db: DatabaseSync; directory: string; model: NotesModel; queue: Queue; unload(): Promise<void>; localSelected?(): void; fake?: boolean; asrModel(): string | undefined;
  changed(): void; recording(): boolean; meeting(id: string): { title: string; segments: import('../../shared/projects').ProjectSegment[]; audio: string[] } }) {
  const store = new ProjectStore(d.db)
  mkdirSync(d.directory, { recursive: true, mode: 0o700 })
  const secrets = join(d.directory, 'credentials.json')
  const readSecrets = (): Record<string, string> => existsSync(secrets) ? JSON.parse(readFileSync(secrets, 'utf8')) : {}
  const getKey = (provider: string) => {
    const encoded = readSecrets()[provider]
    return encoded ? safeStorage.decryptString(Buffer.from(encoded, 'base64')) : undefined
  }
  const external = d.fake ? async (_project: Project, prompt: string, signal: AbortSignal) => (await d.model.llm(signal)).chat(prompt, () => {}, { temperature: 0 }) : externalGenerator(getKey)
  const preference = join(d.directory, 'preferences.json')
  const defaultProject = () => {
    if (!existsSync(preference)) return undefined
    const id = JSON.parse(readFileSync(preference, 'utf8')).defaultProjectId
    return id ? store.project(id) : undefined
  }
  const model = selectedNotesModel(d.model, defaultProject, external)
  ipcMain.handle('projects:default', async (_e, id: string) => {
    const p = store.project(id)
    await atomic(preference, JSON.stringify({ defaultProjectId: id, external: p.provider !== 'local' }))
    if (p.provider === 'local') d.localSelected?.()
    d.queue.modelArrived(); d.changed()
  })
  const workflow = new Workflows({ store, directory: join(d.directory, 'jobs'), changed: d.changed, asrModel: d.asrModel,
    execution: async (run, stop) => {
      await d.queue.enqueue(async signal => {
        const abort = () => stop.abort()
        signal.addEventListener('abort', abort, { once: true })
        try { if (stop.signal.aborted) throw new Error('Cancelled'); await d.unload(); await run() }
        finally { signal.removeEventListener('abort', abort); await d.unload() }
      }, 'project')
      if (stop.signal.aborted) throw new Error('Cancelled')
    },
    recording: d.recording, generate: async (project, prompt, signal) => {
      if (d.fake) {
        if (prompt.startsWith('Choose the most useful')) return JSON.stringify({ kind: 'none', reason: 'Development fixture; no follow-up selected.', draft: '', sources: [] })
        const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1))
        const first = data.transcript[0]
        return JSON.stringify({ claims: [{ kind: 'discussion', text: first.text, evidence: [{ segment_id: first.id, quote: first.text }] }], review: [] })
      }
      if (project.provider !== 'local') return external(project, prompt, signal)
      const llm = await d.model.llm(signal)
      return llm.chat(prompt, () => {}, { temperature: 0, maxTokens: 4096 })
    } })
  ipcMain.handle('projects:state', () => ({ projects: store.projects(), jobs: store.jobs(), profiles: store.profiles(), configured: Object.keys(readSecrets()), defaultProjectId: defaultProject()?.id }))
  ipcMain.handle('projects:folder', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose a project, Obsidian vault, or external audio archive', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('projects:save', (_e, p: Project) => { const saved = store.save(p); d.changed(); return saved })
  ipcMain.handle('projects:credential', async (_e, provider: ProviderKind, key: string) => {
    if (!['openai', 'anthropic', 'compatible'].includes(provider) || typeof key !== 'string' || key.length > 2000) throw new Error('Invalid provider key')
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('OS-backed credential storage is unavailable. Use a local model or signed-in CLI instead.')
    const values = readSecrets()
    if (key.trim()) values[provider] = safeStorage.encryptString(key.trim()).toString('base64'); else delete values[provider]
    await atomic(secrets, JSON.stringify(values)); d.changed()
  })
  ipcMain.handle('projects:import', async (_e, id: string) => {
    store.project(id)
    const result = await dialog.showOpenDialog({ title: 'Import an existing recording', properties: ['openFile'], filters: [{ name: 'Audio or video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'aiff', 'ogg'] }] })
    return result.canceled ? null : workflow.import(id, result.filePaths[0])
  })
  ipcMain.handle('projects:cancel', (_e, id: string) => workflow.cancel(id))
  ipcMain.handle('projects:summarize', (_e, id: string) => workflow.summarize(id))
  ipcMain.handle('projects:speakers', (_e, id: string, map: Record<string, string>) => {
    if (!map || typeof map !== 'object' || Object.values(map).some(v => typeof v !== 'string')) throw new Error('Invalid speaker names')
    workflow.speakers(id, map)
  })
  ipcMain.handle('projects:enroll', (_e, id: string, cluster: string, name: string) => workflow.enroll(id, cluster, name))
  ipcMain.handle('projects:meeting', (_e, projectId: string, meetingId: string) => {
    const meeting = d.meeting(meetingId)
    return workflow.fromMeeting(projectId, meeting.title, meeting.segments, meeting.audio)
  })
  ipcMain.handle('projects:sample', (_e, id: string, cluster: string) => {
    const path = store.job(id).voiceSamples?.[cluster]
    if (!path) throw new Error('No listening sample for this speaker')
    const data = readFileSync(path)
    if (data.length > 200000) throw new Error('Voice sample exceeds the playback limit')
    return 'data:audio/wav;base64,' + data.toString('base64')
  })
  ipcMain.handle('projects:open', async (_e, id: string, kind: string) => {
    const job = store.job(id)
    const path = kind === 'output' && job.transcript ? dirname(job.transcript) : kind === 'source' ? job.source : undefined
    if (!path || !existsSync(path)) throw new Error('This file is no longer at its original location')
    const error = await shell.openPath(path); if (error) throw new Error(error)
  })
  ipcMain.handle('projects:forget', (_e, id: string) => { store.db.prepare('DELETE FROM project_voices WHERE id=?').run(id); d.changed() })
  const timer = setInterval(() => workflow.resumeQueue(), 3000)
  workflow.resumeQueue()
  return { model, externalSelected: () => !!defaultProject() && defaultProject()?.provider !== 'local', dispose: () => { clearInterval(timer); workflow.dispose() } }
}
