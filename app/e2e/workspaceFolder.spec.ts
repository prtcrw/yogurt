import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const main = join(import.meta.dirname, '../out/main/index.js')
test('a project folder becomes the sidebar workspace and receives finished meetings', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yogurt-workspace-ui-'))), profile = join(root, 'profile'), vault = join(root, 'Vault')
  mkdirSync(join(vault, '.obsidian'), { recursive: true }); mkdirSync(join(vault, 'Team', 'Knowledge'), { recursive: true })
  writeFileSync(join(vault, 'Team', 'Kanban.md'), '---\nkanban-plugin: board\n---\n\n## Doing\n\n- [ ] Ship the workspace folder\n')
  writeFileSync(join(vault, 'Team', 'Knowledge', 'Glossary.md'), '# Glossary\n\nMLLO means the project.')
  const app = await electron.launch({ args: [main], env: { ...process.env, YOGURT_FAKE: '1', YOGURT_USER_DATA: profile } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('home')).toBeVisible({ timeout: 20000 })
    // Yogurt's own folders until a project folder is chosen
    await expect(page.getByTestId('sidebar-folders')).toBeVisible()
    await app.evaluate(() => (globalThis as any).__fake__.go('/projects'))
    await page.getByLabel('Name', { exact: true }).fill('Team')
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, vault)
    await page.getByRole('button', { name: 'Choose vault folder' }).click()
    await page.getByLabel('Project folder', { exact: true }).fill('Team')
    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    await page.getByLabel('Use as sidebar workspace').check()

    const tree = page.getByTestId('workspace-tree')
    await expect(tree).toBeVisible()
    await expect(page.getByTestId('sidebar-folders')).toHaveCount(0)
    await expect(tree.getByRole('button', { name: 'Kanban' })).toBeVisible()
    await tree.getByRole('button', { name: 'Knowledge' }).click()
    await tree.getByRole('button', { name: 'Glossary' }).click()
    await expect(page.getByTestId('workspace-file')).toContainText('MLLO means the project.')
    await expect(page.getByTestId('workspace-file-open')).toHaveText('Edit in Obsidian')

    // edits made elsewhere show up without reopening
    writeFileSync(join(vault, 'Team', 'Knowledge', 'Glossary.md'), '# Glossary\n\nMLLO means the project. Edited in Obsidian.')
    await expect(page.getByTestId('workspace-file')).toContainText('Edited in Obsidian.')

    // a finished meeting is written into the meeting folder and appears in the tree
    const id = await app.evaluate(() => (globalThis as any).__fake__.bigMeeting(2))
    const saved = await page.evaluate(meetingId => window.yogurt.workspace.saveMeeting(meetingId), id)
    expect(saved?.path).toContain(join(vault, 'Team', 'Meetings'))
    expect(readFileSync(saved!.path, 'utf8')).toContain('# Long meeting')
    await tree.getByRole('button', { name: 'Meetings' }).click()
    await tree.getByRole('button', { name: /Long meeting/ }).click()
    await expect(page.getByRole('button', { name: 'Open meeting' })).toBeVisible()
    await page.screenshot({ path: join(tmpdir(), 'yogurt-workspace-file.png') })
    await page.getByRole('button', { name: 'Open meeting' }).click()
    await expect(page.getByTestId('workspace-heading')).toHaveText('Long meeting')

    // edited in Obsidian: never overwritten
    writeFileSync(saved!.path, 'my own minutes')
    expect((await page.evaluate(meetingId => window.yogurt.workspace.saveMeeting(meetingId), id))?.skipped).toBe('edited')
    expect(readFileSync(saved!.path, 'utf8')).toBe('my own minutes')
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }) }
})
