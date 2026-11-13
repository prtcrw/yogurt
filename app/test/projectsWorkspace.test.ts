import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ProjectStore } from '../src/main/projects/store'
import { WorkspaceFolder } from '../src/main/projects/workspace'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))) })

async function rig() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-ws-'))); roots.push(root)
  const disk = join(root, 'Work', 'MLLO'), other = join(root, 'Work', 'Other')
  await mkdir(disk, { recursive: true }); await mkdir(other)
  const store = new ProjectStore(new DatabaseSync(':memory:'))
  const changed = vi.fn()
  const ws = new WorkspaceFolder({ store, file: join(root, 'workspace.json'), changed })
  return { root, disk, other, store, ws, changed }
}

it('a project is one folder: an older vault-plus-folder project reads as that folder', async () => {
  const { root, disk, store } = await rig()
  const project = store.save({ id: '', name: 'MLLO', vault: join(root, 'Work'), folder: 'MLLO', output: 'Meetings', provider: 'local', model: '', endpoint: '', retention: 'reference', archive: '', contextFolders: ['.'] })
  expect(project).toMatchObject({ vault: disk, folder: '.' })
  // as stored before projects were one folder
  store.db.prepare('UPDATE project_workspaces SET payload=? WHERE id=?').run(JSON.stringify({ ...project, vault: join(root, 'Work'), folder: 'MLLO' }), project.id)
  expect(store.project(project.id)).toMatchObject({ vault: disk, folder: '.' })
})

it('points a Yogurt folder at a folder on disk: a project is made, moved or unlinked, one per folder', async () => {
  const { ws, disk, other, store, changed } = await rig()
  expect(ws.state()).toEqual({ projects: [] })
  const project = ws.link('folder-1', 'MLLO', disk)!
  expect(changed).toHaveBeenCalled()
  expect(ws.state()).toEqual({ projects: [{ id: project.id, name: 'MLLO', root: disk, output: 'Meetings', obsidian: false, folderId: 'folder-1' }] })
  expect(ws.projectOf('folder-1')?.id).toBe(project.id)

  // choosing again moves the same project; nothing is duplicated
  expect(ws.link('folder-1', 'MLLO', other)!.id).toBe(project.id)
  expect(ws.state().projects).toHaveLength(1)
  expect(ws.state().projects[0].root).toBe(other)
  expect(() => store.save({ ...store.project(project.id), id: '', name: 'Second' })).toThrow('already saves to another project folder')

  ws.link('folder-1', '', null)
  expect(ws.projectOf('folder-1')).toBeUndefined()
  expect(ws.state().projects[0].folderId).toBeUndefined() // the project and its files stay
})

it('keeps each meeting in its own dated folder, updates untouched files, and leaves edited ones alone', async () => {
  const { ws, disk, other } = await rig()
  const id = ws.link('folder-1', 'MLLO', disk)!.id, name = '2026-11-13 Sync', dir = join(disk, 'Meetings', name)
  expect(await ws.writeMeeting('m1', name, { 'summary.md': 's1', 'transcript.md': 't1' }, id)).toEqual({ path: dir, projectId: id })
  expect(await ws.writeMeeting('m1', name, { 'summary.md': 's2', 'transcript.md': 't1' }, id)).toEqual({ path: dir, projectId: id })
  expect(await readFile(join(dir, 'summary.md'), 'utf8')).toBe('s2')
  expect(ws.meetingFolders('m1')).toEqual([{ projectId: id, path: dir }])

  // edited by hand: that file is kept, the other still updates; files the agent added are untouched
  await writeFile(join(dir, 'summary.md'), 's2 with my edits'); await writeFile(join(dir, 'minutes.md'), 'from the agent')
  expect(await ws.writeMeeting('m1', name, { 'summary.md': 's3', 'transcript.md': 't2' }, id)).toEqual({ path: dir, projectId: id, skipped: ['summary.md'] })
  expect(await readFile(join(dir, 'summary.md'), 'utf8')).toBe('s2 with my edits')
  expect(await readFile(join(dir, 'transcript.md'), 'utf8')).toBe('t2')
  expect(await readFile(join(dir, 'minutes.md'), 'utf8')).toBe('from the agent')

  // another meeting with the same name and day gets its own folder
  expect((await ws.writeMeeting('m2', name, { 'summary.md': 'other' }, id)).path).toBe(join(disk, 'Meetings', `${name} (2)`))

  // a meeting in two linked folders is written to both projects
  const second = ws.link('folder-2', 'Other', other)!.id
  expect((await ws.writeMeeting('m1', name, { 'summary.md': 's3' }, second)).path).toBe(join(other, 'Meetings', name))
  expect(ws.meetingFolders('m1').map(f => f.projectId).sort()).toEqual([id, second].sort())
})
