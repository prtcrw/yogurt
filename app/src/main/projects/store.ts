import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'
import type { Project, ProjectJob, VoiceProfile } from '../../shared/projects'
import { inside } from './files'
export class ProjectStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS project_workspaces(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_jobs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_voices(id TEXT PRIMARY KEY, payload TEXT NOT NULL);`)
  }
  /** A project is one folder. Older projects named a vault and a folder inside it; they read as that folder. */
  projects(): Project[] {
    return this.db.prepare('SELECT payload FROM project_workspaces ORDER BY rowid').all().map(r => JSON.parse(String(r.payload)) as Project)
      .map(p => p.folder && p.folder !== '.' ? { ...p, vault: join(p.vault, p.folder), folder: '.' } : p)
  }
  jobs(): ProjectJob[] { return this.db.prepare('SELECT payload FROM project_jobs ORDER BY rowid DESC').all().map(r => JSON.parse(String(r.payload))) }
  profiles(): VoiceProfile[] { return this.db.prepare('SELECT payload FROM project_voices').all().map(r => JSON.parse(String(r.payload))) }
  project(id: string): Project { const p = this.projects().find(p => p.id === id); if (!p) throw new Error('Choose a project'); return p }
  job(id: string): ProjectJob { const job = this.jobs().find(j => j.id === id); if (!job) throw new Error('Job not found'); return job }
  /** check: validate only, nothing is stored */
  save(p: Project, check = false): Project {
    if (!p.name?.trim() || p.name.length > 200) throw new Error('Enter a project name')
    if (!['local', 'codex', 'claude', 'openai', 'anthropic', 'compatible'].includes(p.provider)) throw new Error('Choose a summary provider')
    if (!['reference', 'archive', 'delete'].includes(p.retention)) throw new Error('Choose an audio policy')
    if (!p.vault || !isAbsolute(p.vault)) throw new Error('Choose a project folder')
    if (p.folder && isAbsolute(p.folder) || isAbsolute(p.output || '')) throw new Error('The meetings folder must be inside the project folder')
    p = { ...p, id: p.id || randomUUID(), vault: realpathSync(inside(p.vault, p.folder || '.')), folder: '.', output: p.output || 'Meetings' }
    const root = inside(p.vault, p.folder), output = inside(root, p.output)
    if (root === output) throw new Error('Choose a meetings folder inside the project folder')
    if (!Array.isArray(p.contextFolders) || p.contextFolders.some(f => typeof f !== 'string' || isAbsolute(f))) throw new Error('Context folders must be project-relative paths')
    p.contextFolders = [...new Set(p.contextFolders.map(f => f.trim()).filter(Boolean))]
    for (const f of p.contextFolders) inside(root, f)
    if (p.retention === 'archive') {
      if (!p.archive || !isAbsolute(p.archive)) throw new Error('Choose an external audio archive folder')
      const archive = realpathSync(p.archive)
      const rel = relative(p.vault, archive)
      if (!rel || rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)) throw new Error('The audio archive must be outside the project folder')
      p.archive = archive
    }
    if (p.input?.trim()) {
      p.input = realpathSync(p.input.trim())
      if (!statSync(p.input).isDirectory()) throw new Error('Choose an input folder')
    } else p.input = ''
    if (p.checkInput) {
      if (!p.input) throw new Error('Choose an input folder before enabling folder checks')
      if (p.retention === 'archive' && p.archive === p.input) throw new Error('Use a separate input and archive folder')
      if (this.projects().some(other => other.id !== p.id && other.checkInput && other.input === p.input)) throw new Error('Another project already checks this input folder; choose a separate folder')
    }
    if (p.agent !== undefined && !['', 'codex', 'claude'].includes(p.agent)) throw new Error('Choose Codex or Claude Code as the meeting agent')
    if (p.agentModel !== undefined && (typeof p.agentModel !== 'string' || p.agentModel.length > 200)) throw new Error('Invalid agent model')
    if (p.agentInbox !== undefined) {
      if (typeof p.agentInbox !== 'string' || isAbsolute(p.agentInbox)) throw new Error('The agent inbox must be a folder inside the project')
      p.agentInbox = p.agentInbox.trim() || 'Agent Inbox'
      if (inside(root, p.agentInbox) === root) throw new Error('Choose a separate agent inbox folder')
    }
    if (p.yogurtFolder !== undefined && typeof p.yogurtFolder !== 'string') throw new Error('Invalid folder link')
    if (p.yogurtFolder && this.projects().some(other => other.id !== p.id && other.yogurtFolder === p.yogurtFolder)) throw new Error('That Yogurt folder already saves to another project folder')
    if (p.speechLanguage && !/^(auto|[a-z]{2,3})$/.test(p.speechLanguage)) throw new Error('Choose a supported speech language code')
    if (p.checkInput !== undefined && typeof p.checkInput !== 'boolean' || p.followUps !== undefined && typeof p.followUps !== 'boolean') throw new Error('Invalid project preference')
    if (check) return p
    this.db.prepare('INSERT INTO project_workspaces VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(p.id, JSON.stringify(p))
    return p
  }
  submit(projectId: string, source: string, fingerprint: string): ProjectJob {
    this.project(projectId)
    const previous = this.jobs().find(j => j.projectId === projectId && j.fingerprint === fingerprint && !['failed', 'cancelled'].includes(j.state))
    if (previous) return previous
    const job: ProjectJob = { id: randomUUID(), projectId, source, fingerprint, created: Date.now(), updated: Date.now(), state: 'queued', stage: 'queued' }
    this.db.prepare('INSERT INTO project_jobs VALUES(?,?,?,?)').run(job.id, projectId, fingerprint, JSON.stringify(job))
    return job
  }
  update(id: string, patch: Partial<ProjectJob>): ProjectJob {
    const previous = this.job(id)
    const job = { ...previous, ...patch, id: previous.id, projectId: previous.projectId, updated: Date.now() }
    this.db.prepare('UPDATE project_jobs SET payload=? WHERE id=?').run(JSON.stringify(job), id)
    return job
  }
  voice(profile: VoiceProfile) { this.db.prepare('INSERT INTO project_voices VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(profile.id, JSON.stringify(profile)) }
}
