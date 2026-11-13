import { useEffect, useRef, useState } from 'react'
import type { ModelSearchState } from '../../../shared/runtime'

export function ModelPicker({ initial = false, onSelected }: { initial?: boolean; onSelected?(): void }) {
  const [state, setState] = useState<ModelSearchState>(), [speech, setSpeech] = useState(''), [summary, setSummary] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [done, setDone] = useState(false)
  const initialized = useRef(false)
  const accept = async (value: ModelSearchState) => {
    setState(value)
    if (!initialized.current && !value.scanning) {
      initialized.current = true
      const prefs = (await window.yogurt.runtime.state()).saved
      setSpeech(prefs.speechModel || value.candidates.find(c => c.kind === 'speech')?.path || '')
      setSummary(prefs.summaryModel || value.candidates.find(c => c.kind === 'summary')?.path || '')
    }
  }
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => { void window.yogurt.runtime.models().then(value => {
      if (!active) return
      void accept(value)
      if (value.scanning) timer = setTimeout(refresh, 500)
    }).catch(e => { if (active) setError(String(e)) }) }
    refresh()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [])
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); try { await action() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const picking = (kind: 'speech' | 'summary') => run(async () => { const path = await window.yogurt.runtime.pick(kind === 'speech' ? 'speechModel' : 'summaryModel'); if (path) (kind === 'speech' ? setSpeech : setSummary)(path) })
  return <div data-testid="existing-models" style={{ margin: '18px 0' }}>
    <h2 style={{ fontSize: 20, fontWeight: 600 }}>{initial ? 'Check existing models first' : 'Find and reuse existing models'}</h2>
    <p style={{ margin: '10px 0' }}>{state?.scanning ? 'Checking model folders… No models are being downloaded.' : `${state?.candidates.length ?? 0} compatible-format model files found.`} Existing files are reused in place.</p>
    {error && <p role="alert" style={{ color: '#c55' }}>{error}</p>}
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <button disabled={busy || state?.scanning} onClick={() => void run(async () => accept(await window.yogurt.runtime.scanModels()))}>Check common model folders</button>
      <button disabled={busy || state?.scanning} onClick={() => void run(async () => accept(await window.yogurt.runtime.scanModelFolder()))}>Look in another folder…</button>
    </div>
    {(['speech', ...(state?.localSummary === false ? [] : ['summary'])] as Array<'speech' | 'summary'>).map(kind => {
      const selected = kind === 'speech' ? speech : summary, items = state?.candidates.filter(c => c.kind === kind) ?? []
      return <div key={kind} style={{ margin: '14px 0' }}>
        <label htmlFor={`existing-${kind}`} style={{ display: 'block', fontWeight: 550 }}>{kind === 'speech' ? 'Existing speech model' : 'Existing local summary model'}</label>
        <select id={`existing-${kind}`} value={selected} onChange={e => (kind === 'speech' ? setSpeech : setSummary)(e.target.value)} style={{ width: '100%', padding: 9, border: '1px solid #8885', borderRadius: 6, background: 'transparent' }}>
          <option value="">{initial ? 'Download recommended model if needed' : 'Automatic model selection'}</option>
          {selected && !items.some(c => c.path === selected) && <option value={selected}>{selected}</option>}
          {items.map(item => <option key={item.path} value={item.path}>{item.name} · {(item.bytes / 1024 ** 3).toFixed(2)} GB · {item.path}</option>)}
        </select>
        <button disabled={busy} onClick={() => void picking(kind)}>Choose {kind} model file…</button>
      </div>
    })}
    {state?.localSummary === false && <p>Your selected CLI/API provider handles summaries; local summary weights will not download.</p>}
    {initial && <p style={{ margin: '14px 0' }}>{!speech || state?.localSummary !== false && !summary ? 'Continuing allows downloads for the missing models. Choose existing files above to avoid duplicate downloads.' : 'The selected speech and summary files will be reused. Search-model downloads may still be needed for local summaries.'}</p>}
    <button data-testid="models-continue" disabled={busy || !state || state.scanning} onClick={() => void run(async () => { await window.yogurt.runtime.selectModels({ speech, summary }); setDone(true); onSelected?.() })}>
      {initial ? 'Continue setup with these choices' : 'Use selected model files'}
    </button>
    {done && !initial && <p role="status">Model choices saved. Restart to apply them.</p>}
    <p style={{ fontSize: 13, opacity: .7, marginTop: 12 }}>Speech uses Whisper GGML files; local summaries use GGUF files. Loading the model checks engine compatibility and available memory.</p>
    {!!state?.searched.length && <details style={{ marginTop: 12 }}><summary>Model folders checked</summary>{state.searched.map(path => <p key={path} style={{ overflowWrap: 'anywhere' }}>{path}</p>)}</details>}
  </div>
}
