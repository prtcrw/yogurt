import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { readdir, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { InboxItem } from '../../shared/projects'
import type { ProjectStore } from './store'

const identity = (projectId: string, source: string, info: { dev: number; ino: number; size: number; mtimeMs: number }) => createHash('sha256').update(`${projectId}:${source}:${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`).digest('hex')
export const mediaExtension = /\.(mp4|mov|mkv|webm|wav|mp3|m4a|aac|flac|aiff|ogg)$/i
/** Scans metadata only. No transcription, hashing or source modification until explicit approval. */
export class ProjectInbox {
  readonly errors: Record<string, string> = {}
  private seen = new Map<string, string>()
  private scanning = false
  constructor(private store: ProjectStore, private changed: () => void, private now = Date.now) {
    store.db.exec('CREATE TABLE IF NOT EXISTS project_inbox(id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  }
  all(): InboxItem[] { return this.store.db.prepare('SELECT payload FROM project_inbox ORDER BY rowid DESC').all().map(row => JSON.parse(String(row.payload))) }
  pending() {
    const projects = new Map(this.store.projects().map(project => [project.id, project]))
    return this.all().filter(item => {
      const project = projects.get(item.projectId)
      if (!(item.state === 'pending' && project?.checkInput && project.input && resolve(project.input) === resolve(item.source, '..'))) return false
      try { const current = lstatSync(item.source); return current.isFile() && identity(item.projectId, item.source, current) === item.id } catch { return false }
    })
  }
  async current(id: string) {
    const item = this.pending().find(item => item.id === id)
    if (!item) throw new Error('This recording is no longer waiting for approval')
    const info = await lstat(item.source)
    if (!info.isFile() || identity(item.projectId, item.source, info) !== item.id) throw new Error('The recording changed; wait for the next folder check before importing')
    return item
  }
  resolve(id: string, state: 'ignored' | 'imported') {
    const item = this.all().find(item => item.id === id)
    if (!item) throw new Error('Inbox item not found')
    this.store.db.prepare('UPDATE project_inbox SET payload=? WHERE id=?').run(JSON.stringify({ ...item, state }), id); this.changed()
  }
  async scan() {
    if (this.scanning) return
    this.scanning = true
    let changed = false
    const present = new Set<string>()
    try {
      for (const project of this.store.projects().filter(p => p.checkInput && p.input)) {
        try {
          const entries = (await readdir(project.input!, { withFileTypes: true })).filter(e => e.isFile() && !e.name.startsWith('.') && mediaExtension.test(e.name)).sort((a, b) => a.name.localeCompare(b.name))
          if (entries.length > 500) throw new Error('This inbox has more than 500 recordings. Use a smaller input folder.')
          if (this.errors[project.id]) { delete this.errors[project.id]; changed = true }
          for (const entry of entries) {
            const source = join(project.input!, entry.name), info = await lstat(source), key = project.id + ':' + source
            if (!info.isFile()) continue
            present.add(key)
            const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`
            const stable = this.seen.get(key) === fingerprint && info.size > 0 && this.now() - info.mtimeMs >= 5000
            this.seen.set(key, fingerprint)
            if (!stable) continue
            const id = identity(project.id, source, info)
            const item: InboxItem = { id, projectId: project.id, source, bytes: info.size, modified: info.mtimeMs, state: 'pending' }
            const added = this.store.db.prepare('INSERT OR IGNORE INTO project_inbox VALUES(?,?)').run(id, JSON.stringify(item))
            if (Number(added.changes)) changed = true
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (this.errors[project.id] !== message) { this.errors[project.id] = message; changed = true }
        }
      }
      for (const id of Object.keys(this.errors)) if (!this.store.projects().some(p => p.id === id && p.checkInput)) { delete this.errors[id]; changed = true }
      for (const key of this.seen.keys()) if (!present.has(key)) this.seen.delete(key)
    } finally { this.scanning = false; if (changed) this.changed() }
  }
}
