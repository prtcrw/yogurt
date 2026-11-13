import { dialog, ipcMain, safeStorage, shell } from 'electron'
import { existsSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { Project, ProviderKind } from '../../shared/projects'
import type { Queue } from '../notes/queue'
import type { NotesModel } from '../notes/model'
import { ProjectStore } from './store'
import { Workflows } from './workflow'
import { atomic, inside } from './files'
import { ProjectInbox } from './inbox'
import { selectedNotesModel } from './selection'
import { externalGenerator } from './providers'
import { MeetingAgents } from './agent'
import { WorkspaceFolder } from './workspace'

export function hookProjects(d: { db: DatabaseSync; directory: string; workDirectory?: string; voiceDirectory?: string; executables?: { codexBinary?: string; claudeBinary?: string; ffmpegBinary?: string }; model: NotesModel; queue: Queue; unload(): Promise<void>; localSelected?(): void; fake?: boolean; asrModel(): string | undefined;
  changed(): void; workspaceChanged?(): void; meetingMarkdown?(id: string): { fileName: string; markdown: string } | undefined; recording(): boolean; meeting(id: string): { title: string; segments: import('../../shared/projects').ProjectSegment[]; audio: string[] } }) {
  const store = new ProjectStore(d.db)
  mkdirSync(d.directory, { recursive: true, mode: 0o700 })
  const secrets = join(d.directory, 'credentials.json')
  const readSecrets = (): Record<string, string> => existsSync(secrets) ? JSON.parse(readFileSync(secrets, 'utf8')) : {}
  const getKey = (provider: string) => {
    const encoded = readSecrets()[provider]
    return encoded ? safeStorage.decryptString(Buffer.from(encoded, 'base64')) : undefined
  }
  const external = d.fake ? async (_project: Project, prompt: string, signal: AbortSignal) => (await d.model.llm(signal)).chat(prompt, () => {}, { temperature: 0 }) : externalGenerator(getKey, fetch, d.executables)
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
  const workflow = new Workflows({ store, directory: d.workDirectory || join(d.directory, 'jobs'), voiceDirectory: d.voiceDirectory, ffmpegBinary: d.executables?.ffmpegBinary, changed: d.changed, asrModel: d.asrModel,
    execution: async (run, stop) => {
      await d.queue.enqueue(async signal => {
        const abort = () => stop.abort()
        signal.addEventListener('abort', abort, { once: true })
        try { if (stop.signal.aborted) throw new Error('Cancelled'); await d.unload(); await run() }
        finally { signal.removeEventListener('abort', abort); await d.unload() }
      }, 'project')
      if (stop.signal.aborted) throw new Error('Cancelled')
    },
    ...(d.fake ? { transcribe: async () => [{ id: 'S00001', startMs: 0, endMs: 3000, text: 'This is a development recording for workflow verification.', speaker: null }] } : {}),
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
  const inbox = new ProjectInbox(store, d.changed)
  const agents = new MeetingAgents({ store, changed: d.changed, binaries: d.executables, ...(d.fake ? { run: async ({ paths }) => {
    await atomic(join(paths.meeting, 'minutes.md'), '# Minutes\n\nDevelopment fixture.\n')
    await atomic(join(paths.inbox, 'proposal.md'), '# Proposal\n\nDevelopment fixture.\n')
    return 'Wrote minutes.md and one proposal.'
  } } : {}) })
  const workspace = new WorkspaceFolder({ store, file: join(d.directory, 'workspace.json'), changed: () => { d.workspaceChanged?.(); d.changed() } })
  const saveMeeting = async (id: string) => {
    const meeting = d.meetingMarkdown?.(id)
    return meeting ? (await workspace.writeMeeting(id, meeting.fileName, meeting.markdown)) ?? null : null
  }
  ipcMain.handle('workspace:state', () => workspace.state())
  ipcMain.handle('workspace:use', (_e, projectId: unknown) => workspace.use(typeof projectId === 'string' ? projectId : null))
  ipcMain.handle('workspace:list', (_e, path: string) => workspace.list(path))
  ipcMain.handle('workspace:read', (_e, path: string) => workspace.read(path))
  ipcMain.handle('workspace:open', async (_e, path: string) => {
    const file = workspace.absolute(path), state = workspace.state()
    // Obsidian opens its own vault's notes by path; anything else goes to the default app
    if (state.obsidian) { await shell.openExternal(`obsidian://open?path=${encodeURIComponent(file)}`); return }
    const error = await shell.openPath(file); if (error) throw new Error(error)
  })
  ipcMain.handle('workspace:reveal', (_e, path: string) => { shell.showItemInFolder(workspace.absolute(path)) })
  ipcMain.handle('workspace:saveMeeting', (_e, id: string) => saveMeeting(id))
  ipcMain.handle('workspace:meetingFile', (_e, id: string) => {
    const path = workspace.meetingPath(id), root = workspace.root()
    return path && root && existsSync(path) ? relative(root, path).split(/[\\/]/).join('/') : null
  })
  ipcMain.handle('projects:agent', (_e, id: string) => agents.start(id))
  ipcMain.handle('projects:agentStop', (_e, id: string) => agents.stop(id))
  ipcMain.handle('projects:openInbox', async (_e, projectId: string) => {
    const path = agents.inbox(projectId); mkdirSync(path, { recursive: true })
    const error = await shell.openPath(path); if (error) throw new Error(error)
  })
  ipcMain.handle('projects:state', () => ({ inbox: inbox.pending(), inboxErrors: inbox.errors, projects: store.projects(), jobs: store.jobs(), profiles: store.profiles(), configured: Object.keys(readSecrets()), defaultProjectId: defaultProject()?.id }))
  ipcMain.handle('projects:folder', async () => {
    const result = await dialog.showOpenDialog({ title: 'Choose a project, Obsidian vault, or external audio archive', properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('projects:save', async (_e, p: Project) => { const saved = store.save(p); if (defaultProject()?.id === saved.id) await atomic(preference, JSON.stringify({ defaultProjectId: saved.id, external: saved.provider !== 'local' })); void inbox.scan(); d.changed(); return saved })
  ipcMain.handle('projects:credential', async (_e, provider: ProviderKind, key: string) => {
    if (!['openai', 'anthropic', 'compatible'].includes(provider) || typeof key !== 'string' || key.length > 2000) throw new Error('Invalid provider key')
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('OS-backed credential storage is unavailable. Use a local model or signed-in CLI instead.')
    const values = readSecrets()
    if (key.trim()) values[provider] = safeStorage.encryptString(key.trim()).toString('base64'); else delete values[provider]
    await atomic(secrets, JSON.stringify(values)); d.changed()
  })
  ipcMain.handle('projects:import', async (_e, id: string) => {
    const project = store.project(id)
    const result = await dialog.showOpenDialog({ defaultPath: project.input || undefined, title: 'Import an existing recording', properties: ['openFile'], filters: [{ name: 'Audio or video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'aiff', 'ogg'] }] })
    return result.canceled ? null : workflow.import(id, result.filePaths[0])
  })
  ipcMain.handle('projects:importMany', async (_e, id: string) => {
    const project = store.project(id)
    const result = await dialog.showOpenDialog({ defaultPath: project.input || undefined, title: 'Import recordings', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio or video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'wav', 'mp3', 'm4a', 'aac', 'flac', 'aiff', 'ogg'] }] })
    const jobs = []
    if (!result.canceled) for (const path of result.filePaths) jobs.push(await workflow.import(id, path))
    return jobs
  })
  ipcMain.handle('projects:check', () => inbox.scan())
  ipcMain.handle('projects:approve', async (_e, id: string) => {
    const item = await inbox.current(id)
    const job = await workflow.import(item.projectId, item.source)
    inbox.resolve(id, 'imported'); return job
  })
  ipcMain.handle('projects:ignore', (_e, id: string) => inbox.resolve(id, 'ignored'))
  ipcMain.handle('projects:retry', (_e, id: string) => workflow.retry(id))
  ipcMain.handle('projects:projectFolder', async (_e, project: Project, kind: string) => {
    if (!['project', 'output'].includes(kind)) throw new Error('Unknown folder setting')
    const root = kind === 'project' ? project.vault : inside(project.vault, project.folder)
    const result = await dialog.showOpenDialog({ title: kind === 'project' ? 'Choose project folder within the vault' : 'Choose output folder within this project', defaultPath: root, properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled) return null
    const path = inside(root, result.filePaths[0])
    return relative(root, path) || '.'
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
  const inboxTimer = setInterval(() => { void inbox.scan() }, 10000)
  void inbox.scan()
  workflow.resumeQueue()
  return { model, externalSelected: () => !!defaultProject() && defaultProject()?.provider !== 'local', workspaceMeeting: (id: string) => saveMeeting(id).catch(e => { console.warn('WORKSPACE could not write the meeting', e) }), dispose: () => { clearInterval(timer); clearInterval(inboxTimer); workflow.dispose(); agents.dispose(); workspace.dispose() } }
}
