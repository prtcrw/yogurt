import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
test('a Yogurt folder points at a folder on disk: its meetings are saved there and still open as meetings', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yogurt-workspace-ui-'))), profile = join(root, 'profile'), disk = join(root, 'Work', 'MLLO')
  mkdirSync(disk, { recursive: true })
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible({ timeout: 20000 })
    const first = await app.evaluate(() => (globalThis as any).__fake__.bigMeeting(2))

    // an ordinary folder, with a meeting already in it
    const folder = await page.evaluate(async meetingId => { const f = await window.yogurt.folders.create('MLLO'); await window.yogurt.folders.add(f!.id, meetingId); return f! }, first)
    await page.getByTestId('sidebar-folder-open').click()
    await expect(page.getByTestId('folder-disk')).toContainText('Meetings here stay in Yogurt only.')

    // pointed at a folder on disk: no vault, no file browser, the sidebar is still the folders
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, disk)
    await page.getByTestId('folder-disk-link').click()
    await expect(page.getByTestId('folder-disk-path')).toContainText('MLLO')
    await expect(page.getByTestId('sidebar-folders')).toBeVisible()

    // the meeting already there is on disk now, in its own dated folder
    const meetings = join(disk, 'Meetings')
    await expect.poll(() => existsSync(meetings) ? readdirSync(meetings) : []).toHaveLength(1)
    const [name] = readdirSync(meetings)
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2} Long meeting$/)
    expect(readFileSync(join(meetings, name, 'summary.md'), 'utf8')).toContain(`yogurt-meeting: ${first}`)
    expect(readFileSync(join(meetings, name, 'transcript.md'), 'utf8')).toContain('Line 1 of the long meeting.')

    // a meeting filed later is saved too
    const second = await app.evaluate(() => (globalThis as any).__fake__.bigMeeting(3))
    await page.evaluate(({ folderId, meetingId }) => window.yogurt.folders.add(folderId, meetingId), { folderId: folder.id, meetingId: second })
    await expect.poll(() => readdirSync(meetings).length).toBe(2)

    // in the app they are still the meetings themselves: the folder lists them and one opens its own page
    await expect(page.getByTestId('folder-page')).toContainText('Long meeting')
    await page.screenshot({ path: join(tmpdir(), 'yogurt-folder-disk.png') })

    // hand edits on disk are never overwritten
    writeFileSync(join(meetings, name, 'summary.md'), 'my own minutes')
    const project = (await page.evaluate(() => window.yogurt.workspace.state())).projects[0]
    expect(project).toMatchObject({ name: 'MLLO', root: disk, folderId: folder.id })
    expect((await page.evaluate(({ id, projectId }) => window.yogurt.workspace.saveMeeting(id, projectId), { id: first, projectId: project.id }))?.skipped).toEqual(['summary.md'])
    expect(readFileSync(join(meetings, name, 'summary.md'), 'utf8')).toBe('my own minutes')

    // the folder's project settings (agent, summaries) are one click away
    await page.getByTestId('folder-project-settings').click()
    await expect(page.getByTestId('workspace-heading')).toHaveText('MLLO')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByLabel('Yogurt folder')).toHaveValue(folder.id)
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})

test('a project made on the Projects page gets its own folder in the sidebar', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yogurt-workspace-ui-'))), profile = join(root, 'profile'), disk = join(root, 'Research')
  mkdirSync(disk)
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible({ timeout: 20000 })
    await app.evaluate(() => (globalThis as any).__fake__.go('/project/new'))
    await page.getByLabel('Name', { exact: true }).fill('Research')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, disk)
    await page.getByRole('button', { name: 'Choose project folder' }).click()
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await expect(page.getByTestId('sidebar-folder-open')).toHaveText(/Research/)
    await page.getByTestId('sidebar-folder-open').click()
    await expect(page.getByTestId('folder-disk-path')).toContainText('Research')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
