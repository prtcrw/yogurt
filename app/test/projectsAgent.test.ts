import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { agentCommand, agentPaths, agentPrompt, findInstructions, MeetingAgents, type RunAgent } from '../src/main/projects/agent'
import { ProjectStore } from '../src/main/projects/store'
import type { Project } from '../src/shared/projects'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true }))) })

async function rig(over: Partial<Project> = {}) {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-agent-'))); roots.push(root)
  const vault = join(root, 'Vault'), meeting = join(vault, 'Team', 'Meetings', '2026-11-13 Sync')
  await mkdir(meeting, { recursive: true }); await writeFile(join(meeting, 'transcript.md'), '# Sync')
  const store = new ProjectStore(new DatabaseSync(':memory:'))
  const project = store.save({ id: '', name: 'Team', vault, folder: 'Team', output: 'Meetings', provider: 'local', model: '', endpoint: '', retention: 'reference', archive: '', contextFolders: ['.'], agent: 'claude', ...over })
  const job = store.update(store.submit(project.id, '/audio/sync.m4a', 'f').id, { state: 'completed', title: 'Sync', transcript: join(meeting, 'transcript.md') })
  return { root, vault, meeting, store, project, job }
}

it('limits writes to the meeting folder and the agent inbox', async () => {
  const { project, job, meeting, vault } = await rig()
  const paths = agentPaths(project, job)
  expect(paths).toEqual({ vault: join(vault, 'Team'), workspace: join(vault, 'Team'), meeting, inbox: join(vault, 'Team', 'Agent Inbox') })

  const codex = agentCommand('codex', paths, '', '/tmp/report.md')
  expect(codex.cwd).toBe(meeting)
  expect(codex.args).toEqual(expect.arrayContaining(['--sandbox', 'workspace-write', '-C', meeting, '--add-dir', paths.inbox]))
  expect(codex.args).not.toContain('danger-full-access')

  const claude = agentCommand('claude', paths, 'opus', '')
  expect(claude.cwd).toBe(join(vault, 'Team'))
  expect(claude.args).toEqual(expect.arrayContaining(['--permission-mode', 'dontAsk', `Edit(/${meeting}/**)`, `Write(/${paths.inbox}/**)`, '--model', 'opus']))
  const allowed = claude.args.slice(claude.args.indexOf('--allowedTools') + 1, claude.args.indexOf('--disallowedTools'))
  expect(allowed.filter(a => /^(Edit|Write)\(/.test(a)).every(a => a.includes(meeting) || a.includes(paths.inbox))).toBe(true)
  expect(claude.args.slice(claude.args.indexOf('--disallowedTools'))).toContain('Bash')
})

it('rejects a transcript outside the vault and an inbox that is the workspace itself', async () => {
  const { project, job, store } = await rig()
  expect(() => agentPaths(project, { ...job, transcript: '/etc/transcript.md' })).toThrow()
  expect(() => store.save({ ...project, agentInbox: '.' })).toThrow('separate agent inbox')
  expect(() => store.save({ ...project, agentInbox: '/abs' })).toThrow()
})

it('prefers YOGURT.md in the project folder and passes it to the agent', async () => {
  const { project, job, vault } = await rig()
  await writeFile(join(vault, 'Team', 'CLAUDE.md'), 'other rules')
  await writeFile(join(vault, 'Team', 'YOGURT.md'), 'Kanban lives in Board.md')
  const paths = agentPaths(project, job)
  const found = await findInstructions(paths)
  expect(found?.path).toBe(join(vault, 'Team', 'YOGURT.md'))
  const prompt = agentPrompt(project, job, paths, found)
  expect(prompt).toContain('Kanban lives in Board.md')
  expect(prompt).toContain(paths.inbox)
  expect(prompt).toContain('Never edit files outside the meeting folder')
})

it('records a run on the job and saves the report beside the meeting', async () => {
  const { store, job, meeting, vault } = await rig()
  const run = vi.fn<RunAgent>(async () => 'Wrote minutes.md')
  const changed = vi.fn()
  const agents = new MeetingAgents({ store, changed, run })
  await agents.start(job.id)
  expect(store.job(job.id).agent?.state).toBe('running')
  await expect(agents.start(job.id)).rejects.toThrow('already running')
  await vi.waitFor(() => expect(store.job(job.id).agent?.state).toBe('done'))
  expect(store.job(job.id).agent?.report).toBe('Wrote minutes.md')
  expect(await readFile(join(meeting, 'agent-report.md'), 'utf8')).toContain('Wrote minutes.md')
  expect(run.mock.calls[0][0].provider).toBe('claude')
  await expect(readFile(join(vault, 'Team', 'Agent Inbox'), 'utf8')).rejects.toThrow() // a folder, created for the agent
})

it('marks a stopped run, and an interrupted one as failed on the next start', async () => {
  const { store, job } = await rig()
  const run: RunAgent = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Agent stopped'))))
  const agents = new MeetingAgents({ store, changed: () => {}, run })
  await agents.start(job.id); agents.stop(job.id)
  await vi.waitFor(() => expect(store.job(job.id).agent?.state).toBe('stopped'))
  store.update(job.id, { agent: { state: 'running', provider: 'codex', started: 1 } })
  new MeetingAgents({ store, changed: () => {} })
  expect(store.job(job.id).agent?.state).toBe('failed')
})

it('needs an agent chosen in the project', async () => {
  const { store, job } = await rig({ agent: '' })
  await expect(new MeetingAgents({ store, changed: () => {} }).start(job.id)).rejects.toThrow('Choose Codex or Claude Code')
})
