import { useEffect, useRef, useState } from 'react'
import { AudioLines, ChevronDown, FolderOpen, LoaderCircle, Sparkles, HardDriveDownload } from 'lucide-react'
import { Wordmark } from '../components/Logo'
import type { ModelCandidate, ModelSearchState } from '../../../shared/runtime'

type Kind = 'speech' | 'summary'
const BROWSE = '__browse__'
const gb = (bytes: number) => bytes < 1024 ** 3 ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB` : `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`
const fileName = (path: string) => path.split(/[\\/]/).pop() || path
const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '')

/**
 * First run, before anything downloads: reuse model files already on this computer, or let Yogurt fetch the
 * recommended ones. One card of choices and one Continue button that is always visible.
 */
export function ModelSetup({ providers }: { providers(): void }) {
  const [state, setState] = useState<ModelSearchState>()
  const [choice, setChoice] = useState<Record<Kind, string>>({ speech: '', summary: '' })
  const [folder, setFolder] = useState({ current: '', chosen: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const initialized = useRef(false)

  const accept = async (value: ModelSearchState) => {
    setState(value)
    if (initialized.current || value.scanning) return
    initialized.current = true
    const runtime = await window.yogurt.runtime.state()
    setFolder({ current: runtime.effective.modelsDirectory, chosen: runtime.saved.modelsDirectory })
    setChoice({
      speech: runtime.saved.speechModel || value.candidates.find(c => c.kind === 'speech')?.path || '',
      summary: runtime.saved.summaryModel || value.candidates.find(c => c.kind === 'summary')?.path || '',
    })
  }
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => void window.yogurt.runtime.models().then(value => {
      if (!active) return
      void accept(value)
      if (value.scanning) timer = setTimeout(refresh, 400)
    }, e => { if (active) setError(message(e)) })
    refresh()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [])

  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const browse = (kind: Kind) => run(async () => {
    const path = await window.yogurt.runtime.pick(kind === 'speech' ? 'speechModel' : 'summaryModel')
    if (path) setChoice(c => ({ ...c, [kind]: path }))
  })
  const scanFolder = () => run(async () => accept(await window.yogurt.runtime.scanModelFolder()))
  const pickFolder = () => run(async () => {
    const path = await window.yogurt.runtime.pick('modelsDirectory')
    if (path) setFolder(f => ({ ...f, chosen: path }))
  })
  const proceed = () => run(async () => {
    await window.yogurt.runtime.selectModels({ ...choice, modelsDirectory: folder.chosen })
  })

  const scanning = !state || state.scanning
  const localSummary = state?.localSummary !== false
  const kinds: Kind[] = localSummary ? ['speech', 'summary'] : ['speech']
  const downloads = kinds.filter(k => !choice[k])
  const found = state?.candidates.length ?? 0
  const downloadFolder = folder.chosen || folder.current

  return (
    <div data-testid="model-setup" className="setup-screen ms">
      <div className="ms-scroll">
        <div className="ms-content">
          <div className="ob-brand"><Wordmark height={22} /></div>
          <h1 className="ms-title">Choose your models</h1>
          <p className="ms-text">Yogurt runs speech and summaries on this computer. Reuse model files you already have, or let Yogurt download the recommended ones. Nothing downloads until you continue.</p>

          <div className="ms-scan" role="status" data-testid="model-scan-status">
            {scanning
              ? <><LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /><span>Looking for models you already have…</span></>
              : <span>{found ? `Found ${found} compatible model ${found === 1 ? 'file' : 'files'} on this computer.` : 'No existing model files found in the usual places.'}</span>}
            <button className="settings-link no-drag" disabled={busy || scanning} onClick={() => void scanFolder()}>
              <FolderOpen size={13} aria-hidden="true" />Look in another folder…
            </button>
          </div>

          <section className="settings-group ms-group" aria-label="Models">
            {kinds.map(kind => <ModelRow key={kind} kind={kind} value={choice[kind]} disabled={busy || scanning}
              items={state?.candidates.filter(c => c.kind === kind) ?? []}
              onChange={v => v === BROWSE ? void browse(kind) : setChoice(c => ({ ...c, [kind]: v }))} />)}
            <div className="settings-row">
              <span className="settings-permission-icon" aria-hidden="true"><HardDriveDownload size={15} /></span>
              <div className="settings-row-copy">
                <div className="settings-label">Download folder</div>
                <p className="settings-description ms-path" title={downloadFolder}>{downloadFolder || 'Default location'}</p>
              </div>
              <div className="ms-row-actions">
                {folder.chosen && <button className="settings-link no-drag" disabled={busy} onClick={() => setFolder(f => ({ ...f, chosen: '' }))}>Use default</button>}
                <button data-testid="models-folder" className="ob-button secondary ms-small no-drag" disabled={busy} onClick={() => void pickFolder()}>Change…</button>
              </div>
            </div>
          </section>

          {!localSummary && <p className="ms-note">Summaries use the CLI or API provider you chose, so no local summary model is needed.</p>}
          {error && <p role="alert" className="ms-error">{error}</p>}

          {!!state?.searched.length && <details className="ob-guide-help ms-searched">
            <summary>Folders checked</summary>
            <div className="ob-guide-help-content">{state.searched.map(p => <p key={p} className="ms-path-wrap">{p}</p>)}</div>
          </details>}
        </div>
      </div>

      <footer className="ms-foot">
        <button className="ob-button quiet no-drag" onClick={providers}>Use a CLI or API for summaries</button>
        <div className="ms-foot-end">
          <span className="ms-summary" data-testid="models-summary">
            {scanning ? '' : downloads.length ? `Will download ${downloads.map(k => k === 'speech' ? 'speech' : 'summary').join(' and ')} model` : 'Reusing your model files'}
          </span>
          <button data-testid="models-continue" className="ob-button primary no-drag" disabled={busy || scanning} onClick={() => void proceed()}>
            {busy && <LoaderCircle size={14} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />}Continue
          </button>
        </div>
      </footer>
    </div>
  )
}

function ModelRow({ kind, value, items, disabled, onChange }: { kind: Kind; value: string; items: ModelCandidate[]; disabled: boolean; onChange(v: string): void }) {
  const id = `existing-${kind}`
  const known = items.find(c => c.path === value)
  const label = kind === 'speech' ? 'Speech model' : 'Summary model'
  const hint = kind === 'speech' ? 'Turns audio into a transcript (Whisper .bin)' : 'Writes notes from the transcript (GGUF)'
  return (
    <div className="settings-row" data-kind={kind}>
      <span className="settings-permission-icon" aria-hidden="true">{kind === 'speech' ? <AudioLines size={15} /> : <Sparkles size={15} />}</span>
      <div className="settings-row-copy">
        <label htmlFor={id} className="settings-label">{label}</label>
        <p className="settings-description ms-path" title={value || undefined}>{value ? `Reuse in place · ${folderOf(value)}` : hint}</p>
      </div>
      <span className="settings-select-wrap ms-select">
        <select id={id} aria-label={kind === 'speech' ? 'Existing speech model' : 'Existing local summary model'} value={value} disabled={disabled}
          onChange={e => onChange(e.target.value)} className="settings-select">
          <option value="">Download recommended</option>
          {items.length > 0 && <optgroup label="Found on this computer">
            {items.map(c => <option key={c.path} value={c.path}>{c.name} · {gb(c.bytes)}</option>)}
          </optgroup>}
          {value && !known && <option value={value}>{fileName(value)}</option>}
          <option value={BROWSE}>Choose a file…</option>
        </select>
        <ChevronDown size={14} aria-hidden="true" />
      </span>
    </div>
  )
}

function message(e: unknown) {
  const text = e instanceof Error ? e.message : String(e)
  // Electron prefixes IPC errors with the channel; the person only needs the reason
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
