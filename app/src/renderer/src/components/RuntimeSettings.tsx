import { ModelPicker } from './ModelPicker'
import { useEffect, useState } from 'react'
import type { RuntimePath, RuntimePreferences, RuntimeState } from '../../../shared/runtime'

const fields: Array<{ key: RuntimePath; label: string; hint: string }> = [
  { key: 'speechModel', label: 'Speech model file', hint: 'Use an existing Whisper GGML .bin model. Blank uses Yogurt’s downloaded speech model.' },
  { key: 'summaryModel', label: 'Local summary model file', hint: 'Use an existing GGUF model. This replaces automatic summary-model downloads; choose one that fits your memory.' },
  { key: 'modelsDirectory', label: 'Model download folder', hint: 'Where future speech, summary and search models download. Existing files are kept in place.' },
  { key: 'workDirectory', label: 'Processing cache folder', hint: 'Temporary decoded audio, transcript caches and short speaker-review samples. An external disk can save internal storage.' },
  { key: 'voiceDirectory', label: 'Speaker model folder', hint: 'Optional speaker model pack. Blank uses the processing cache folder.' },
  { key: 'codexBinary', label: 'Codex CLI executable', hint: 'Optional absolute executable path when Codex is installed in a custom location.' },
  { key: 'claudeBinary', label: 'Claude Code CLI executable', hint: 'Optional absolute executable path when Claude Code is installed in a custom location.' },
  { key: 'ffmpegBinary', label: 'FFmpeg executable', hint: 'Optional absolute executable path for additional audio/video codecs.' },
]
const size = (bytes: number) => bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`

export function RuntimeSettings() {
  const [state, setState] = useState<RuntimeState>(), [draft, setDraft] = useState<RuntimePreferences>()
  const [discoveryOpen, setDiscoveryOpen] = useState(false)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  useEffect(() => { void window.yogurt.runtime.state().then(value => { setState(value); setDraft(value.saved) }).catch(e => setError(String(e))) }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const change = (key: RuntimePath, value: string) => { setDraft(d => d && { ...d, [key]: value }); setSaved(false) }
  return <details className="runtime-settings" data-testid="runtime-settings" style={{ border: '1px solid #8885', borderRadius: 10, padding: 18, margin: '20px 0' }}>
    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Models, folders & tools</summary>
    <p style={{ margin: '12px 0' }}>App-wide settings. Leave a path blank for automatic selection. Model and storage changes apply after restarting; files are never moved or deleted by saving settings.</p>
    {error && <p role="alert" style={{ color: '#c55' }}>{error}</p>}
    <details onToggle={e => setDiscoveryOpen(e.currentTarget.open)}><summary>Check for existing models</summary>{discoveryOpen && <ModelPicker onSelected={() => { void window.yogurt.runtime.state().then(value => { setState(value); setDraft(value.saved) }) }} />}</details>
    {draft && fields.map(({ key, label, hint }) => <div key={key} style={{ margin: '16px 0' }}>
      <label htmlFor={`runtime-${key}`} style={{ fontWeight: 550 }}>{label}</label>
      <p style={{ opacity: .7, fontSize: 13, margin: '4px 0' }}>{hint}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input id={`runtime-${key}`} value={draft[key]} placeholder="Automatic" autoComplete="off" spellCheck={false}
          style={{ flex: '1 1 260px', padding: 8, border: '1px solid #8885', borderRadius: 6, background: 'transparent' }} onChange={e => change(key, e.target.value)} />
        <button disabled={busy} aria-label={`Browse ${label.toLowerCase()}`} onClick={() => void run(async () => { const path = await window.yogurt.runtime.pick(key); if (path) change(key, path) })}>Browse…</button>
        <button disabled={busy || !draft[key]} aria-label={`Use automatic ${label.toLowerCase()}`} onClick={() => change(key, '')}>Automatic</button>
      </div>
    </div>)}
    <button disabled={busy || !draft} onClick={() => void run(async () => { const value = await window.yogurt.runtime.save(draft!); setState(value); setDraft(value.saved); setSaved(true) })}>Save model and folder settings</button>
    {saved && <p role="status">Settings saved.</p>}
    {state?.restartRequired && <p role="status">Restart required to apply these paths. <button disabled={busy} onClick={() => void run(async () => {
      const jobs = (await window.yogurt.projects.state()).jobs
      if (jobs.some(j => ['queued', 'running'].includes(j.state))) throw new Error('Finish or cancel project jobs before restarting.')
      if (!(await window.yogurt.permissions.relaunch())) throw new Error('Finish the current recording before restarting.')
    })}>Restart Yogurt Projects</button></p>}
    {state && <details style={{ marginTop: 18 }}><summary>Current locations and storage</summary>
      <p>{state.freeBytes === undefined ? 'Available disk space could not be read.' : `${size(state.freeBytes)} available on the processing-cache disk.`}</p>
      {state.status.map(item => <p key={item.label} style={{ overflowWrap: 'anywhere', marginTop: 10 }}><strong>{item.label}</strong><br />{item.path || 'Automatic model selection'}{item.bytes !== undefined ? ` · ${size(item.bytes)}` : ''}
        {item.path && !item.exists && ' · Not currently available (default folders are created when needed)'}</p>)}
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={() => void run(() => window.yogurt.runtime.open('modelsDirectory'))}>Open model folder</button>
        <button onClick={() => void run(() => window.yogurt.runtime.open('workDirectory'))}>Open processing folder</button>
      </div>
    </details>}
  </details>
}
