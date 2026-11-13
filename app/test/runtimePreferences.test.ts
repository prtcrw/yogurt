import { afterEach, expect, it } from 'vitest'
import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimePreferencesStore, runtimeDefaults, validateRuntime } from '../src/main/runtimePreferences'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true }))) })
async function fixture() {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'yogurt-runtime-test-'))); roots.push(root)
  const models = join(root, 'Models'), work = join(root, 'Work'); await mkdir(models); await mkdir(work)
  const speech = join(models, 'speech.bin'), summary = join(models, 'summary.gguf')
  const header = Buffer.alloc(8); header.writeUInt32LE(0x67676d6c); await writeFile(speech, header); await writeFile(summary, 'GGUFtest')
  return { root, models, work, speech, summary, store: new RuntimePreferencesStore(join(root, 'profile/runtime.json'), join(root, 'profile')) }
}
it('persists custom model paths without copying weights and keeps running locations unchanged until restart', async () => {
  const f = await fixture(); const saved = await f.store.save({ ...runtimeDefaults, modelsDirectory: f.models, workDirectory: f.work, speechModel: f.speech, summaryModel: f.summary })
  expect(saved.restartRequired).toBe(true); expect(saved.effective.workDirectory).not.toBe(f.work)
  const restarted = new RuntimePreferencesStore(f.store.file, f.store.profile); const state = await restarted.state()
  expect(state.restartRequired).toBe(false); expect(state.effective.workDirectory).toBe(f.work); expect(state.effective.voiceDirectory).toBe(join(f.work, 'voice-models'))
  expect(state.status.find(s => s.path === f.summary)?.bytes).toBe(8); expect(await readFile(f.summary, 'utf8')).toBe('GGUFtest')
})
it('rejects wrong model formats, missing paths and relative directories before overwriting saved settings', async () => {
  const f = await fixture(); await f.store.save({ ...runtimeDefaults, speechModel: f.speech })
  await expect(f.store.save({ ...runtimeDefaults, speechModel: f.summary })).rejects.toThrow(/Whisper GGML/)
  await expect(validateRuntime({ ...runtimeDefaults, summaryModel: f.speech })).rejects.toThrow(/GGUF/)
  await expect(validateRuntime({ ...runtimeDefaults, workDirectory: 'relative' })).rejects.toThrow(/absolute/)
  await expect(validateRuntime({ ...runtimeDefaults, modelsDirectory: join(f.root, 'missing') })).rejects.toThrow()
  expect(f.store.read().speechModel).toBe(f.speech)
})
it('validates executable files and supports explicitly returning to automatic model selection', async () => {
  const f = await fixture(), binary = join(f.root, 'custom-cli'); await writeFile(binary, '#!/bin/sh\nexit 0\n'); await chmod(binary, 0o600)
  if (process.platform !== 'win32') await expect(validateRuntime({ ...runtimeDefaults, codexBinary: binary })).rejects.toThrow()
  await chmod(binary, 0o700); const valid = await validateRuntime({ ...runtimeDefaults, codexBinary: binary }); expect(valid.codexBinary).toBe(binary)
  await f.store.save({ ...runtimeDefaults, summaryModel: f.summary }); await f.store.save({ ...runtimeDefaults }); expect(f.store.read()).toEqual(runtimeDefaults)
})
