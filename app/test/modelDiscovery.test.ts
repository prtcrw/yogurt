import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverModels, ModelDiscovery } from '../src/main/modelDiscovery'
import { RuntimePreferencesStore } from '../src/main/runtimePreferences'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-model-discovery-'))); roots.push(root)
  const models = join(root, 'Models'); await mkdir(models)
  const speech = join(models, 'ggml-base.bin'), summary = join(models, 'meeting-model.gguf')
  const header = Buffer.alloc(8); header.writeUInt32LE(0x67676d6c); await writeFile(speech, header); await writeFile(summary, 'GGUFtest')
  return { root, models, speech, summary }
}
it('finds usable formats, follows Hugging Face file links, and excludes embeddings, partial files and duplicate paths', async () => {
  const f = await fixture(); await writeFile(join(f.models, 'nomic-embed.gguf'), 'GGUFtest'); await writeFile(join(f.models, 'new.gguf.part'), 'GGUFtest'); await writeFile(join(f.models, 'pytorch_model.bin'), 'not a model')
  await symlink(f.summary, join(f.models, 'alias.gguf'))
  const found = await discoverModels([f.models, f.models]); expect(found.candidates).toHaveLength(2)
  expect(found.candidates.find(c => c.kind === 'speech')?.path).toBe(f.speech); expect(found.candidates.find(c => c.kind === 'summary')?.path).toBe(f.summary)
  expect(await readFile(f.speech)).toHaveLength(8)
})
it('stops at the configured scan budget and does not scan unrelated directories', async () => {
  const f = await fixture(); const found = await discoverModels([f.models], { directories: 2, files: 1, depth: 1 }); expect(found.candidates).toHaveLength(1); expect(found.searched).toEqual([f.models])
})
it('holds setup until an explicit choice, persists it and reuses selected files without copying', async () => {
  const f = await fixture(), preferences = new RuntimePreferencesStore(join(f.root, 'profile/runtime.json'), join(f.root, 'profile'))
  const discovery = new ModelDiscovery({ preferences, roots: [f.models], choiceFile: join(f.root, 'profile/model-setup.json'), enabled: true, localSummary: () => true })
  let released = false; const waiting = discovery.waitForSelection().then(value => { released = true; return value })
  await discovery.scan(); expect(released).toBe(false); expect(discovery.required()).toBe(true)
  await discovery.choose({ speech: f.speech, summary: f.summary }); expect(await waiting).toEqual({ asr: f.speech, llm: f.summary, modelsDir: join(f.root, 'profile/models') })
  expect(discovery.required()).toBe(false); expect(preferences.effective().speechModel).toBe(f.speech); expect((await preferences.state()).restartRequired).toBe(false)
})
it('never blocks setup on other saved paths, and a chosen download folder applies before anything downloads', async () => {
  const f = await fixture(), profile = join(f.root, 'profile'), preferences = new RuntimePreferencesStore(join(profile, 'runtime.json'), profile)
  const work = join(f.root, 'Cache'), downloads = join(f.root, 'Downloads'); await mkdir(work); await mkdir(downloads)
  const discovery = new ModelDiscovery({ preferences, roots: [f.models], choiceFile: join(profile, 'model-setup.json'), enabled: true, localSummary: () => true })
  const waiting = discovery.waitForSelection()
  await preferences.save({ ...preferences.read(), workDirectory: work })
  await discovery.choose({ speech: f.speech, summary: '', modelsDirectory: downloads })
  expect(await waiting).toEqual({ asr: f.speech, llm: undefined, modelsDir: downloads })
  const state = await preferences.state()
  expect(state.effective.modelsDirectory).toBe(downloads); expect(state.saved.workDirectory).toBe(work); expect(state.effective.workDirectory).not.toBe(work)
})
