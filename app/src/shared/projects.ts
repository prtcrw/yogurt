/** Obsidian project workflows. Paths belong to this computer; Markdown outputs remain portable. */
export type ProviderKind = 'local' | 'codex' | 'claude' | 'openai' | 'anthropic' | 'compatible'
export type Retention = 'reference' | 'archive' | 'delete'
export type AgentProvider = 'codex' | 'claude'
/** One run of the meeting agent: a signed-in CLI working in the workspace after the meeting */
export type AgentRun = { state: 'running' | 'done' | 'failed' | 'stopped'; provider: AgentProvider; started: number; finished?: number; report?: string; error?: string; instructions?: string }
export type Project = {
  id: string; name: string; vault: string; folder: string; output: string
  provider: ProviderKind; model: string; endpoint: string
  recognizeSpeakers?: boolean; retention: Retention; archive: string; contextFolders: string[]
  input?: string; checkInput?: boolean; speechLanguage?: string; followUps?: boolean
  /** the post-meeting agent ('' or absent: off), its model, and the workspace folder it writes proposals to */
  agent?: AgentProvider | ''; agentModel?: string; agentInbox?: string
}
export type ProjectSegment = { id: string; startMs: number; endMs: number; text: string; speaker: string | null; cluster?: string }
export type ProjectJob = {
  id: string; projectId: string; source: string; fingerprint: string; created: number; updated: number
  state: 'queued' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled'
  stage: string; title?: string; error?: string; transcript?: string; notes?: string; audioUri?: string; audioStatus?: string
  segments?: ProjectSegment[]; retained?: boolean; projectSnapshot?: Project; sourceHash?: string; audioSources?: string[]; voiceEmbeddings?: Record<string, number[]>; voiceSamples?: Record<string, string>
  agent?: AgentRun
}
export type VoiceProfile = { id: string; name: string; model: string; samples: number[][]; confirmed: true }
export type InboxItem = { id: string; projectId: string; source: string; bytes: number; modified: number; state: 'pending' | 'ignored' | 'imported' }
export type ProjectState = { projects: Project[]; jobs: ProjectJob[]; profiles: VoiceProfile[]; configured: string[]; defaultProjectId?: string; inbox?: InboxItem[]; inboxErrors?: Record<string, string> }
/** The sidebar workspace: a project folder on disk shown in place of Yogurt's own folders */
export type WorkspaceState = { projectId?: string; name?: string; root?: string; obsidian?: boolean }
export type WorkspaceEntry = { name: string; path: string; kind: 'folder' | 'file' }
export type WorkspaceFile = { path: string; absolute: string; text: string; modified: number; meetingId?: string }
export type WorkspaceApi = {
  state(): Promise<WorkspaceState>
  use(projectId: string | null): Promise<void>
  list(path: string): Promise<WorkspaceEntry[]>
  read(path: string): Promise<WorkspaceFile>
  open(path: string): Promise<void>
  reveal(path: string): Promise<void>
  saveMeeting(meetingId: string): Promise<{ path: string; skipped?: 'edited' } | null>
  meetingFile(meetingId: string): Promise<string | null>
  onChange(cb: () => void): () => void
}
export type ProjectsApi = {
  state(): Promise<ProjectState>
  defaultProvider(projectId: string): Promise<void>
  chooseFolder(): Promise<string | null>
  save(project: Project): Promise<Project>
  credential(provider: ProviderKind, key: string): Promise<void>
  import(projectId: string): Promise<ProjectJob | null>
  importMany(projectId: string): Promise<ProjectJob[]>
  checkInbox(): Promise<void>
  approveInput(itemId: string): Promise<ProjectJob>
  ignoreInput(itemId: string): Promise<void>
  retry(jobId: string): Promise<void>
  chooseProjectFolder(project: Project, kind: 'project' | 'output'): Promise<string | null>
  cancel(jobId: string): Promise<void>
  summarize(jobId: string): Promise<void>
  speakers(jobId: string, assignments: Record<string, string>): Promise<void>
  enroll(jobId: string, speaker: string, name: string): Promise<void>
  exportMeeting(projectId: string, meetingId: string): Promise<ProjectJob>
  sample(jobId: string, cluster: string): Promise<string>
  open(jobId: string, kind: 'source' | 'output'): Promise<void>
  runAgent(jobId: string): Promise<void>
  stopAgent(jobId: string): Promise<void>
  openInbox(projectId: string): Promise<void>
  forget(profileId: string): Promise<void>
  onChange(cb: () => void): () => void
}
