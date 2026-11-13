import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProjectStore } from '../src/main/projects/store'
import { WorkspaceFolder } from '../src/main/projects/workspace'

const roots: string[] = [], folders: WorkspaceFolder[] = []
afterEach(async () => { folders.splice(0).forEach(f => f.dispose()); await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))) })

async function rig() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-ws-'))); roots.push(root)
  const vault = join(root, 'Vault'), outside = join(root, 'Outside')
  await mkdir(join(vault, '.obsidian'), { recursive: true }); await mkdir(join(vault, 'Team', 'Board'), { recursive: true }); await mkdir(outside)
  await writeFile(join(vault, 'Team', 'Kanban.md'), '# Kanban'); await writeFile(join(vault, 'Team', 'image.png'), 'x'); await writeFile(join(vault, 'Team', '.hidden.md'), 'x')
  await writeFile(join(outside, 'secret.md'), 'secret')
  const store = new ProjectStore(new DatabaseSync(':memory:'))
  const project = store.save({ id: '', name: 'Team', vault, folder: 'Team', output: 'Meetings', provider: 'local', model: '', endpoint: '', retention: 'reference', archive: '', contextFolders: ['.'] })
  const changed = vi.fn()
  const ws = new WorkspaceFolder({ store, file: join(root, 'workspace.json'), changed }); folders.push(ws)
  return { root, vault, outside, store, project, ws, changed }
}

it('is off until a project is chosen, then lists folders and Markdown notes only', async () => {
  const { ws, project, vault, changed } = await rig()
  expect(ws.state()).toEqual({})
  await expect(ws.list('')).rejects.toThrow('Choose a workspace folder')
  await ws.use(project.id)
  expect(changed).toHaveBeenCalled()
  expect(ws.state()).toEqual({ projectId: project.id, name: 'Team', root: join(vault, 'Team'), obsidian: true })
  expect(await ws.list('')).toEqual([{ name: 'Board', path: 'Board', kind: 'folder' }, { name: 'Kanban', path: 'Kanban.md', kind: 'file' }])
  await ws.use(null)
  expect(ws.state()).toEqual({})
})

it('never reads outside the workspace, through .. or a symlink', async () => {
  const { ws, project, vault, outside } = await rig()
  await ws.use(project.id)
  await symlink(outside, join(vault, 'Team', 'Linked'))
  await expect(ws.read('../../Outside/secret.md')).rejects.toThrow()
  await expect(ws.read('Linked/secret.md')).rejects.toThrow()
  await expect(ws.read('image.png')).rejects.toThrow('Only Markdown')
  expect((await ws.read('Kanban.md')).text).toBe('# Kanban')
})

it('writes a finished meeting once, updates it while untouched, and leaves an edited file alone', async () => {
  const { ws, project, vault } = await rig()
  expect(await ws.writeMeeting('m1', 'Sync 2026-11-13.md', 'v1')).toBeUndefined() // no workspace yet
  await ws.use(project.id)
  const target = join(vault, 'Team', 'Meetings', 'Sync 2026-11-13.md')
  expect(await ws.writeMeeting('m1', 'Sync 2026-11-13.md', 'v1')).toEqual({ path: target })
  expect(await ws.writeMeeting('m1', 'Sync 2026-11-13.md', 'v2')).toEqual({ path: target })
  expect(await readFile(target, 'utf8')).toBe('v2')
  expect((await ws.read('Meetings/Sync 2026-11-13.md')).meetingId).toBe('m1')

  await writeFile(target, 'v2 with my Obsidian edits')
  expect(await ws.writeMeeting('m1', 'Sync 2026-11-13.md', 'v3')).toEqual({ path: target, skipped: 'edited' })
  expect(await readFile(target, 'utf8')).toBe('v2 with my Obsidian edits')

  // another meeting with the same name gets its own file
  expect(await ws.writeMeeting('m2', 'Sync 2026-11-13.md', 'other')).toEqual({ path: join(vault, 'Team', 'Meetings', 'Sync 2026-11-13 (2).md') })
})
