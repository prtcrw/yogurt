import { dialog, ipcMain, shell } from 'electron'
import { dirname } from 'node:path'
import type { ModelDiscovery } from './modelDiscovery'
import type { RuntimePath, RuntimePreferences } from '../shared/runtime'
import { directoryPaths, executablePaths, runtimeDefaults, type RuntimePreferencesStore } from './runtimePreferences'

export function hookRuntime(store: RuntimePreferencesStore, discovery: ModelDiscovery) {
  ipcMain.handle('runtime:models', () => discovery.state())
  ipcMain.handle('runtime:scanModels', () => discovery.scan())
  ipcMain.handle('runtime:scanModelFolder', async () => { const result = await dialog.showOpenDialog({ title: 'Look for existing models in this folder', properties: ['openDirectory'] }); return result.canceled ? discovery.state() : discovery.scan(result.filePaths[0]) })
  ipcMain.handle('runtime:selectModels', (_e, selection: { speech: string; summary: string }) => discovery.choose(selection))
  const keyOf = (key: string): RuntimePath => { if (!(Object.hasOwn(runtimeDefaults, key))) throw new Error('Unknown setting'); return key as RuntimePath }
  ipcMain.handle('runtime:state', () => store.state())
  ipcMain.handle('runtime:save', (_e, value: RuntimePreferences) => store.save(value))
  ipcMain.handle('runtime:pick', async (_e, field: string) => {
    const key = keyOf(field), directory = directoryPaths.includes(key)
    const result = await dialog.showOpenDialog({ title: `Choose ${directory ? 'folder' : executablePaths.includes(key) ? 'executable' : 'model file'}`,
      defaultPath: store.read()[key] || undefined, properties: directory ? ['openDirectory', 'createDirectory'] : ['openFile'],
      ...(!directory && !executablePaths.includes(key) ? { filters: [{ name: key === 'speechModel' ? 'Whisper GGML model' : 'GGUF language model', extensions: key === 'speechModel' ? ['bin'] : ['gguf'] }] } : {}),
    })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('runtime:open', async (_e, field: string) => {
    const key = keyOf(field), path = store.effective()[key]
    if (!path || executablePaths.includes(key)) throw new Error('Choose a file or folder first')
    const error = await shell.openPath(directoryPaths.includes(key) ? path : dirname(path))
    if (error) throw new Error(error)
  })
}
