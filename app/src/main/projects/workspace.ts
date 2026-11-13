import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { Project, WorkspaceState } from '../../shared/projects'
import { atomic, inside } from './files'
import type { ProjectStore } from './store'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const toRel = (path: string) => path.split(sep).join('/')
/** the folder is an Obsidian vault, or inside one */
const inVault = (path: string): boolean => existsSync(join(path, '.obsidian')) || (dirname(path) !== path && inVault(dirname(path)))

/** A meeting's folder on disk, and what Yogurt last wrote to each file in it */
type Written = { path: string; files: Record<string, string> }
/** written: by meeting, then by project */
type Saved = { written?: Record<string, Record<string, Written>> }

/**
 * Yogurt folders that point at a folder on disk. Each linked folder is a project: its meetings are written there, one
 * dated folder per meeting, and the disk folder stays the source of truth (a file edited elsewhere is never overwritten).
 */
export class WorkspaceFolder {
  constructor(private d: { store: ProjectStore; file: string; changed(): void }) {}

  private saved(): Saved { try { return JSON.parse(readFileSync(this.d.file, 'utf8')) } catch { return {} } }
  private rootOf(p: Project): string | undefined { try { return inside(p.vault, p.folder || '.') } catch { return undefined } }

  state(): WorkspaceState {
    return { projects: this.d.store.projects().flatMap(p => {
      const root = this.rootOf(p)
      return root ? [{ id: p.id, name: p.name, root, output: toRel(p.output || 'Meetings'), obsidian: inVault(root), ...(p.yogurtFolder ? { folderId: p.yogurtFolder } : {}) }] : []
    }) }
  }
  /** the project a Yogurt folder points at */
  projectOf(folderId: string): Project | undefined { return this.d.store.projects().find(p => p.yogurtFolder === folderId) }

  /** Point a Yogurt folder at a folder on disk (a new project, or its project moved), or stop (null; the project stays). */
  link(folderId: string, name: string, path: string | null): Project | undefined {
    const existing = this.projectOf(folderId)
    let project: Project | undefined
    if (path === null) { if (existing) this.d.store.save({ ...existing, yogurtFolder: '' }) }
    else project = this.d.store.save(existing ? { ...existing, vault: path, folder: '.' }
      : { id: '', name, vault: path, folder: '.', output: 'Meetings', provider: 'local', model: '', endpoint: 'http://127.0.0.1:1234/v1', retention: 'reference', archive: '', contextFolders: ['.'], yogurtFolder: folderId })
    this.d.changed()
    return project
  }

  /**
   * Writes a meeting as its own folder in a project's meetings folder. A file someone edited since Yogurt last wrote
   * it is left alone; files others added (the agent's minutes) are untouched; a taken folder name gets a number.
   */
  async writeMeeting(id: string, folderName: string, files: Record<string, string>, projectId: string): Promise<{ path: string; projectId: string; skipped?: string[] }> {
    const p = this.d.store.project(projectId), root = this.rootOf(p)
    if (!root) throw new Error('This project folder is not available')
    const saved = this.saved(), written = { ...saved.written }, mine = { ...written[id] }
    const previous = mine[p.id]
    const parent = inside(root, p.output || 'Meetings')
    await mkdir(parent, { recursive: true })
    let dir = previous && existsSync(previous.path) && previous.path.startsWith(parent + sep) ? previous.path : undefined
    if (!dir) for (let n = 1; ; n++) {
      const candidate = inside(parent, n === 1 ? folderName : `${folderName} (${n})`)
      if (!existsSync(candidate)) { dir = candidate; break }
    }
    await mkdir(dir, { recursive: true })
    const hashes: Record<string, string> = dir === previous?.path ? { ...previous.files } : {}, skipped: string[] = []
    for (const [name, text] of Object.entries(files)) {
      const target = inside(dir, name)
      const current = await readFile(target, 'utf8').catch(() => undefined)
      if (current !== undefined && hash(current) !== hashes[name]) { skipped.push(name); continue }
      if (current !== text) await atomic(target, text)
      hashes[name] = hash(text)
    }
    mine[p.id] = { path: dir, files: hashes }; written[id] = mine
    await atomic(this.d.file, JSON.stringify({ ...saved, written }))
    return { path: dir, projectId: p.id, ...(skipped.length ? { skipped } : {}) }
  }

  /** where a meeting is on disk, per project it was written to (only folders that are still there) */
  meetingFolders(id: string): Array<{ projectId: string; path: string }> {
    return Object.entries(this.saved().written?.[id] ?? {}).filter(([, w]) => existsSync(w.path)).map(([projectId, w]) => ({ projectId, path: w.path }))
  }
  /** a project's folder on disk, for showing it in Finder */
  root(projectId: string) {
    const root = this.rootOf(this.d.store.project(projectId))
    if (!root) throw new Error('This project folder is not available')
    return root
  }
}
