export type RuntimePreferences = {
  modelsDirectory: string
  speechModel: string
  summaryModel: string
  workDirectory: string
  voiceDirectory: string
  codexBinary: string
  claudeBinary: string
  ffmpegBinary: string
}
export type RuntimePath = keyof RuntimePreferences
export type RuntimeState = {
  saved: RuntimePreferences
  effective: RuntimePreferences
  restartRequired: boolean
  status: Array<{ label: string; path: string; exists: boolean; bytes?: number }>
  freeBytes?: number
}
export type RuntimeApi = {
  state(): Promise<RuntimeState>
  save(value: RuntimePreferences): Promise<RuntimeState>
  pick(key: RuntimePath): Promise<string | null>
  open(key: RuntimePath): Promise<void>
  models(): Promise<ModelSearchState>
  scanModels(): Promise<ModelSearchState>
  scanModelFolder(): Promise<ModelSearchState>
  selectModels(selection: { speech: string; summary: string }): Promise<void>
}
export type ModelCandidate = { kind: 'speech' | 'summary'; path: string; name: string; bytes: number }
export type ModelSearchState = { scanning: boolean; candidates: ModelCandidate[]; searched: string[]; confirmed: boolean; localSummary: boolean }
