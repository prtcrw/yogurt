import { afterEach, expect, it } from 'vitest'
import { realpathSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, writeFile, utimes, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../src/main/projects/store'
import { ProjectInbox } from '../src/main/projects/inbox'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })
async function fixture() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-inbox-test-'))); roots.push(root)
  const vault = join(root, 'Vault'), input = join(root, 'Input'); await mkdir(vault); await mkdir(input)
  const db = new DatabaseSync(':memory:'), store = new ProjectStore(db)
  const project = store.save({ id: '', name: 'Project', vault, input, checkInput: true, folder: '.', output: 'Meetings', contextFolders: ['.'], provider: 'local', model: '', endpoint: '', retention: 'reference', archive: '' })
  const source = join(input, 'call.wav'); await writeFile(source, 'recording'); const old = new Date(Date.now() - 20000); await utimes(source, old, old)
  const inbox = new ProjectInbox(store, () => {})
  return { root, db, store, project, source, inbox }
}
it('requires stable checks and explicit approval; scanning alone never starts a job or changes a recording', async () => {
  const f = await fixture(); await f.inbox.scan(); expect(f.inbox.pending()).toHaveLength(0)
  await f.inbox.scan(); expect(f.inbox.pending()).toHaveLength(1); expect(f.store.jobs()).toHaveLength(0)
  expect((await f.inbox.current(f.inbox.pending()[0].id)).source).toBe(f.source); f.db.close()
})
it('remembers skipped/imported versions across restarts without repeatedly asking', async () => {
  const f = await fixture(); await f.inbox.scan(); await f.inbox.scan(); const id = f.inbox.pending()[0].id
  f.inbox.resolve(id, 'ignored'); const reopened = new ProjectInbox(f.store, () => {}); await reopened.scan(); await reopened.scan(); expect(reopened.pending()).toHaveLength(0)
  expect(reopened.all()[0].state).toBe('ignored'); f.db.close()
})
it('does not approve growing, replaced or missing input files', async () => {
  const f = await fixture(); await f.inbox.scan(); await f.inbox.scan(); const id = f.inbox.pending()[0].id
  await writeFile(f.source, 'changed longer recording'); await expect(f.inbox.current(id)).rejects.toThrow(); expect(f.inbox.pending()).toHaveLength(0)
  await f.inbox.scan(); await f.inbox.scan(); expect(f.inbox.pending()).toHaveLength(0)
  await unlink(f.source); expect(f.inbox.pending()).toHaveLength(0); f.db.close()
})
it('turning checks off hides pending files and prevents scanning that project', async () => {
  const f = await fixture(); await f.inbox.scan(); await f.inbox.scan(); f.store.save({ ...f.project, checkInput: false }); await f.inbox.scan(); expect(f.inbox.pending()).toHaveLength(0); f.db.close()
})
it('prevents two projects from claiming the same monitored inbox', async () => {
  const f = await fixture(); expect(() => f.store.save({ ...f.project, id: '', name: 'Other' })).toThrow(/already checks/); f.db.close()
})
