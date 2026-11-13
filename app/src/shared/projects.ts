/** Obsidian project workflows. Paths belong to this computer; Markdown outputs remain portable. */
export type ProviderKind = 'local' | 'codex' | 'claude' | 'openai' | 'anthropic' | 'compatible'
export type Retention = 'reference' | 'archive' | 'delete'
export type Project = {
  id: string; name: string; vault: string; folder: string; output: string
  provider: ProviderKind; model: string; endpoint: string
  recognizeSpeakers?: boolean; retention: Retention; archive: string; contextFolders: string[]
}
export type ProjectSegment = { id: string; startMs: number; endMs: number; text: string; speaker: string | null; cluster?: string }
export type ProjectJob = {
  id: string; projectId: string; source: string; fingerprint: string; created: number; updated: number
  state: 'queued' | 'running' | 'review' | 'completed' | 'failed' | 'cancelled'
  stage: string; title?: string; error?: string; transcript?: string; notes?: string; audioUri?: string
  segments?: ProjectSegment[]; retained?: boolean; projectSnapshot?: Project; sourceHash?: string; audioSources?: string[]; voiceEmbeddings?: Record<string, number[]>; voiceSamples?: Record<string, string>
}
export type VoiceProfile = { id: string; name: string; model: string; samples: number[][]; confirmed: true }
export type ProjectState = { projects: Project[]; jobs: ProjectJob[]; profiles: VoiceProfile[]; configured: string[]; defaultProjectId?: string }
export type ProjectsApi = {
  state(): Promise<ProjectState>
  defaultProvider(projectId: string): Promise<void>
  chooseFolder(): Promise<string | null>
  save(project: Project): Promise<Project>
  credential(provider: ProviderKind, key: string): Promise<void>
  import(projectId: string): Promise<ProjectJob | null>
  cancel(jobId: string): Promise<void>
  summarize(jobId: string): Promise<void>
  speakers(jobId: string, assignments: Record<string, string>): Promise<void>
  enroll(jobId: string, speaker: string, name: string): Promise<void>
  exportMeeting(projectId: string, meetingId: string): Promise<ProjectJob>
  sample(jobId: string, cluster: string): Promise<string>
  open(jobId: string, kind: 'source' | 'output'): Promise<void>
  forget(profileId: string): Promise<void>
  onChange(cb: () => void): () => void
}
