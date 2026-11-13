import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
test('projects configure a CLI provider and export an existing meeting with a contextual follow-up', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yogurt-project-ui-')), profile = join(root, 'profile'), vault = join(root, 'Vault')
  mkdirSync(vault)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible({ timeout: 20000 })
    const id = await app.evaluate(() => (globalThis as any).__fake__.bigMeeting(2))
    await app.evaluate(() => (globalThis as any).__fake__.go('/projects'))
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, vault)
    await page.getByLabel('Name', { exact: true }).fill('Research project')
    await page.getByRole('button', { name: 'Choose vault folder' }).click()
    await page.getByLabel('Summary provider').selectOption('codex')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.yogurt.projects.state()).projects.length)).toBe(1)
    await page.getByRole('button', { name: 'Make default' }).click()
    await expect(page.getByText('Default', { exact: true })).toBeVisible()
    const project = await page.evaluate(async () => (await window.yogurt.projects.state()).projects[0])
    expect(project.provider).toBe('codex')
    const job = await page.evaluate(async ({ projectId, meetingId }) => window.yogurt.projects.exportMeeting(projectId, meetingId), { projectId: project.id, meetingId: id })
    await page.getByRole('tab', { name: /Activity/ }).click()
    await expect(page.getByRole('button', { name: 'Approve speakers and summarize' })).toBeVisible()
    await page.getByRole('button', { name: 'Approve speakers and summarize' }).click()
    await expect.poll(() => page.evaluate(async jobId => (await window.yogurt.projects.state()).jobs.find(j => j.id === jobId)?.state, job.id), { timeout: 20000 }).toBe('completed')
    const done = await page.evaluate(async jobId => (await window.yogurt.projects.state()).jobs.find(j => j.id === jobId)!, job.id)
    expect(readFileSync(done.transcript!, 'utf8')).toContain('## S00001')
    expect(readFileSync(join(dirname(done.notes!), 'follow-up.md'), 'utf8')).toContain('No additional follow-up is suggested.')
    await expect(page.getByRole('button', { name: 'Open notes folder' })).toBeVisible()

    // the meeting agent: off until chosen, then a Run button on the finished meeting
    await expect(page.getByRole('button', { name: 'Run agent' })).toHaveCount(0)
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByLabel('Meeting agent').selectOption('claude')
    await page.getByRole('button', { name: 'Save project', exact: true }).click()
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible()
    await page.screenshot({ path: join(tmpdir(), 'yogurt-agent-settings.png'), fullPage: true })
    await page.getByRole('tab', { name: /Activity/ }).click()
    await page.getByRole('button', { name: 'Run agent' }).click()
    await expect(page.getByText('Claude Code finished')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Run again' })).toBeVisible()
    expect(readFileSync(join(dirname(done.notes!), 'minutes.md'), 'utf8')).toContain('Minutes')
    expect(readFileSync(join(dirname(done.notes!), 'agent-report.md'), 'utf8')).toContain('Wrote minutes.md')
    expect(readFileSync(join(vault, 'Agent Inbox', 'proposal.md'), 'utf8')).toContain('Proposal')
    await page.screenshot({ path: join(tmpdir(), 'yogurt-agent-activity.png') })
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
