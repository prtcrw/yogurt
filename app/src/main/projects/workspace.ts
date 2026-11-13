import { createHash } from 'node:crypto'
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WorkspaceEntry, WorkspaceFile, WorkspaceState } from '../../shared/projects'
import { atomic, inside } from './files'
import type { ProjectStore } from './store'

/** Folders that belong to tools, not to the person's notes */
const HIDDEN = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.DS_Store'])
const MAX_ENTRIES = 500
const MAX_READ = 2_000_000
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const toRel = (path: string) => path.split(sep).join('/')

type Written = { path: string; hash: string }
type Saved = { projectId?: string; meetings?: Record<string, Written> }

/**
 * A project folder used as the sidebar workspace. The folder is the source of truth: Yogurt lists and reads it as it
 * is, writes each finished meeting into the project's meeting folder, and never overwrites a file edited elsewhere.
 */
export class WorkspaceFolder {
  private watcher?: FSWatcher
  private timer?: NodeJS.Timeout
  constructor(private d: { store: ProjectStore; file: string; changed(): void }) { this.watch() }

  private saved(): Saved { try { return JSON.parse(readFileSync(this.d.file, 'utf8')) } catch { return {} } }
  private project() {
    const id = this.saved().projectId
    if (!id) return undefined
    try { return this.d.store.project(id) } catch { return undefined }
  }
  /** the workspace folder on disk, or undefined when Yogurt's own folders are used */
  root(): string | undefined {
    const p = this.project()
    if (!p) return undefined
    try { return inside(p.vault, p.folder || '.') } catch { return undefined }
  }
  state(): WorkspaceState {
    const p = this.project(), root = this.root()
    return p && root ? { projectId: p.id, name: p.name, root, obsidian: existsSync(join(p.vault, '.obsidian')) } : {}
  }
  async use(projectId: string | null) {
    if (projectId) this.d.store.project(projectId)
    await atomic(this.d.file, JSON.stringify({ ...this.saved(), projectId: projectId ?? undefined }))
    this.watch(); this.d.changed()
  }

  /** A path the window gave, resolved inside the workspace (never outside it, never through a symlink out) */
  private resolve(rel: string) {
    const root = this.root()
    if (!root) throw new Error('Choose a workspace folder first')
    if (typeof rel !== 'string' || rel.includes('\0')) throw new Error('Invalid path')
    return { root, path: inside(root, rel || '.') }
  }

  /** One folder's contents: folders first, then Markdown files, by name */
  async list(rel = ''): Promise<WorkspaceEntry[]> {
    const { root, path } = this.resolve(rel)
    const entries = await readdir(path, { withFileTypes: true })
    const out: WorkspaceEntry[] = []
    for (const e of entries) {
      if (out.length >= MAX_ENTRIES) break
      if (e.name.startsWith('.') || HIDDEN.has(e.name)) continue
      const full = join(path, e.name)
      if (e.isDirectory()) out.push({ name: e.name, path: toRel(relative(root, full)), kind: 'folder' })
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push({ name: e.name.replace(/\.md$/i, ''), path: toRel(relative(root, full)), kind: 'file' })
    }
    return out.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'folder' ? -1 : 1)
  }

  async read(rel: string): Promise<WorkspaceFile> {
    const { path } = this.resolve(rel)
    if (!/\.md$/i.test(path)) throw new Error('Only Markdown files open here')
    const info = await stat(path)
    if (!info.isFile()) throw new Error('Not a file')
    if (info.size > MAX_READ) throw new Error('This file is too large to show here; open it in your editor')
    const text = await readFile(path, 'utf8')
    const meeting = Object.entries(this.saved().meetings ?? {}).find(([, w]) => w.path === path)?.[0]
    return { path: rel, absolute: path, text, modified: info.mtimeMs, ...(meeting ? { meetingId: meeting } : {}) }
  }

  absolute(rel: string) { return this.resolve(rel).path }

  /**
   * Writes a finished meeting into the project's meeting folder. A file someone edited since Yogurt last wrote it is
   * left alone (the folder is the source of truth); a new name is used instead of overwriting anything else.
   */
  async writeMeeting(id: string, fileName: string, markdown: string): Promise<{ path: string; skipped?: 'edited' } | undefined> {
    const p = this.project(), root = this.root()
    if (!p || !root) return undefined
    const folder = inside(root, p.output || 'Meetings')
    await mkdir(folder, { recursive: true })
    const saved = this.saved(), meetings = { ...saved.meetings }
    const previous = meetings[id]
    let target = previous?.path && existsSync(previous.path) ? previous.path : undefined
    if (target) {
      const current = await readFile(target, 'utf8')
      if (hash(current) !== previous!.hash) return { path: target, skipped: 'edited' }
      if (current === markdown) return { path: target }
    } else {
      const base = fileName.replace(/\.md$/i, '')
      for (let n = 1; ; n++) {
        const candidate = inside(folder, n === 1 ? `${base}.md` : `${base} (${n}).md`)
        if (!existsSync(candidate)) { target = candidate; break }
      }
    }
    await atomic(target, markdown)
    meetings[id] = { path: target, hash: hash(markdown) }
    await atomic(this.d.file, JSON.stringify({ ...saved, meetings }))
    return { path: target }
  }

  /** where a meeting was written, if it was */
  meetingPath(id: string) { return this.saved().meetings?.[id]?.path }

  private watch() {
    this.watcher?.close(); this.watcher = undefined
    const root = this.root()
    if (!root) return
    try {
      this.watcher = watch(root, { recursive: true }, (_event, name) => {
        if (name && String(name).split(/[\\/]/).some(part => part.startsWith('.') || HIDDEN.has(part))) return
        clearTimeout(this.timer); this.timer = setTimeout(() => this.d.changed(), 250)
      })
      this.watcher.on('error', () => { this.watcher?.close(); this.watcher = undefined })
    } catch { /* listing still works; it just won't refresh by itself */ }
  }
  dispose() { this.watcher?.close(); clearTimeout(this.timer) }
}
