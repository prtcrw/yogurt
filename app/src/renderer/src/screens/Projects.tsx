import { RuntimeSettings } from '../components/RuntimeSettings'
import { useEffect, useState } from 'react'
import type { Project, ProjectJob, ProjectState, ProviderKind } from '../../../shared/projects'
const providers: Array<[ProviderKind, string]> = [['local', 'Local · Yogurt model'], ['codex', 'Codex · existing CLI sign-in'], ['claude', 'Claude Code · existing CLI sign-in'], ['openai', 'OpenAI API'], ['anthropic', 'Anthropic API'], ['compatible', 'OpenAI-compatible endpoint (LM Studio / Ollama / custom)']]
const fresh = (): Project => ({ id: '', name: '', vault: '', folder: '.', output: 'Meetings', provider: 'local', model: '', endpoint: 'http://127.0.0.1:1234/v1', retention: 'reference', archive: '', contextFolders: ['.'], recognizeSpeakers: false, input: '', checkInput: false, speechLanguage: 'auto', followUps: true })
export function Projects({ back }: { back?: () => void }) {
  const [state, setState] = useState<ProjectState>({ projects: [], jobs: [], profiles: [], configured: [] })
  const [meetings, setMeetings] = useState<Array<{ id: string; title: string }>>([])
  const [meetingId, setMeetingId] = useState('')
  useEffect(() => { void window.yogurt.meetings.cards({ limit: 100 }).then(setMeetings) }, [])
  const [draft, setDraft] = useState<Project>(fresh), [selected, setSelected] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [key, setKey] = useState('')
  const refresh = () => window.yogurt.projects.state().then(setState).catch(e => setError(String(e)))
  useEffect(() => { void window.yogurt.projects.state().then(data => { setState(data); const last = localStorage.getItem('yogurt.lastProject') || data.defaultProjectId; const project = data.projects.find(p => p.id === last); if (project) { setDraft(project); setSelected(project.id) } }).catch(e => setError(String(e))); return window.yogurt.projects.onChange(() => { void refresh() }) }, [])
  useEffect(() => { if (selected) localStorage.setItem('yogurt.lastProject', selected) }, [selected])
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await refresh() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const field = (name: keyof Project, value: unknown) => setDraft(p => ({ ...p, [name]: value }))
  const folder = (name: 'vault' | 'archive' | 'input') => run(async () => { const path = await window.yogurt.projects.chooseFolder(); if (path) field(name, path) })
  return <main className="project-workflows" style={{ padding: '64px 28px 32px', maxWidth: 1060, margin: '0 auto' }}>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}><h1>Project workflows</h1>{back && <button onClick={back}>Back to Yogurt</button>}</div>
    <p>Transcripts and notes live in Obsidian. Audio stays elsewhere, or is deleted only after successful export.</p>
    <RuntimeSettings />
    {error && <p role="alert" style={{ color: '#d55' }}>{error}</p>}
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 24, marginTop: 24 }}>
      <aside><button onClick={() => { setDraft(fresh()); setSelected(''); localStorage.removeItem('yogurt.lastProject') }}>New project</button>{state.projects.map(p => <p key={p.id}><button onClick={() => { setDraft(p); setSelected(p.id) }}>{p.name}</button></p>)}<p>{state.profiles.length} confirmed voice profiles</p>{state.profiles.map(p => <p key={p.id}>{p.name} <button onClick={() => void run(() => window.yogurt.projects.forget(p.id))}>Forget voice</button></p>)}</aside>
      <section><h2>{draft.id ? 'Project settings' : 'Add a project'}</h2>
        <label>Name<input value={draft.name} onChange={e => field('name', e.target.value)} /></label>
        <label>Obsidian vault<button aria-label="Choose vault folder" onClick={() => void folder('vault')}>{draft.vault || 'Choose vault folder…'}</button></label>
        <label>Project folder within vault<input placeholder="NIST/MLLO" value={draft.folder} onChange={e => field('folder', e.target.value)} /></label><button disabled={!draft.vault || busy} onClick={() => void run(async () => { const path = await window.yogurt.projects.chooseProjectFolder(draft, 'project'); if (path) field('folder', path) })}>Browse project folder…</button>
        <label>Meeting output subfolder<input value={draft.output} onChange={e => field('output', e.target.value)} /></label><button disabled={!draft.vault || busy} onClick={() => void run(async () => { const path = await window.yogurt.projects.chooseProjectFolder(draft, 'output'); if (path) field('output', path) })}>Browse output folder…</button>
        {draft.vault && <p style={{ overflowWrap: 'anywhere' }}>Output location: {[draft.vault, draft.folder === '.' ? '' : draft.folder, draft.output].filter(Boolean).join('/')}</p>}
        <label>Recording input folder<input value={draft.input ?? ''} placeholder="Choose a folder for incoming recordings" onChange={e => field('input', e.target.value)} /></label><button aria-label="Choose input folder" onClick={() => void folder('input')}>Browse input folder…</button>
        <label><input type="checkbox" checked={!!draft.checkInput} onChange={e => field('checkInput', e.target.checked)} /> Check input folder and ask before importing</label>
        <p>While Yogurt is running, stable recordings in this folder appear below for approval. Files in subfolders are excluded. Nothing is transcribed or deleted until you approve import.</p>
        <label>Imported speech language<select value={draft.speechLanguage || 'auto'} onChange={e => field('speechLanguage', e.target.value)}>{[['auto', 'Auto-detect'], ['en', 'English'], ['th', 'Thai'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ko', 'Korean']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
        <label><input type="checkbox" checked={draft.followUps !== false} onChange={e => field('followUps', e.target.checked)} /> Suggest a follow-up from meeting context</label>
        <label>Context folders (one project-relative folder per line)<textarea value={draft.contextFolders.join('\n')} onChange={e => field('contextFolders', e.target.value.split('\n'))} /></label>
        <label>Summary provider<select value={draft.provider} onChange={e => { field('provider', e.target.value); setKey('') }}>{providers.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label>
        {draft.provider !== 'local' && <p>The transcript and selected project excerpts are sent to this provider.</p>}
        {draft.provider !== 'local' && <label>Model (CLI default if blank)<input value={draft.model} onChange={e => field('model', e.target.value)} /></label>}
        {draft.provider === 'compatible' && <label>Endpoint<input value={draft.endpoint} onChange={e => field('endpoint', e.target.value)} /></label>}
        {['openai', 'anthropic', 'compatible'].includes(draft.provider) && <label>API key · {state.configured.includes(draft.provider) ? 'saved securely' : 'not configured'}<input type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /><button disabled={!key} onClick={() => void run(async () => { await window.yogurt.projects.credential(draft.provider, key); setKey('') })}>Save key securely</button>{state.configured.includes(draft.provider) && <button disabled={busy} onClick={() => void run(() => window.yogurt.projects.credential(draft.provider, ''))}>Remove saved key</button>}</label>}
        {['codex', 'claude'].includes(draft.provider) && <p>Install and sign into the {draft.provider === 'codex' ? 'Codex' : 'Claude Code'} CLI once. This uses its existing authentication; account limits apply. Transcripts and selected context go to that provider.</p>}
        <label>Audio after successful export<select value={draft.retention} onChange={e => field('retention', e.target.value)}><option value="reference">Keep original location; link from Obsidian</option><option value="archive">Move to an archive outside the vault</option><option value="delete">Delete original recording after transcript + notes are saved</option></select></label>
        {draft.retention === 'archive' && <label>External audio archive<button aria-label="Choose audio archive" onClick={() => void folder('archive')}>{draft.archive || 'Choose external archive…'}</button></label>}
        {draft.retention === 'delete' && <p><strong>This project will delete imported source recordings after successful export.</strong> Cancellation or failed processing keeps the source. Obsidian retains its original URI and checksum.</p>}
        <label><input type="checkbox" checked={!!draft.recognizeSpeakers} onChange={e => field('recognizeSpeakers', e.target.checked)} /> Recognize speakers locally · first use downloads the optional native voice models</label>
        <div style={{ display: 'flex', gap: 12, marginTop: 18 }}><button disabled={busy} onClick={() => void run(async () => { const p = await window.yogurt.projects.save(draft); setDraft(p); setSelected(p.id) })}>Save project</button><button disabled={!selected || busy} onClick={() => void run(() => window.yogurt.projects.defaultProvider(selected))}>{state.defaultProjectId === selected ? 'Default for Yogurt summaries' : 'Use this provider for Yogurt summaries'}</button><button disabled={!selected || busy} onClick={() => void run(() => window.yogurt.projects.importMany(selected))}>Import audio or video…</button></div>
      </section>
    </div>
    <section style={{ marginTop: 30 }}><h2>Export a finished Yogurt meeting</h2><p>Uses its saved transcript without running speech recognition again. Existing Yogurt audio remains in Yogurt, with a source link.</p><select value={meetingId} onChange={e => setMeetingId(e.target.value)}><option value="">Choose a meeting…</option>{meetings.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}</select><button disabled={!selected || !meetingId || busy} onClick={() => void run(() => window.yogurt.projects.exportMeeting(selected, meetingId))}>Review and export to project</button></section>
    <section style={{ marginTop: 30 }}><h2>Recordings awaiting your approval</h2><p>New files must stay unchanged across two checks (about 10 seconds). Import approves the selected project’s audio-retention policy after successful export.</p><button disabled={busy} onClick={() => void run(() => window.yogurt.projects.checkInbox())}>Check input folders now</button>
      {state.inboxErrors && Object.entries(state.inboxErrors).map(([id, message]) => <p role="alert" key={id}>{state.projects.find(p => p.id === id)?.name}: {message}</p>)}
      {!(state.inbox ?? []).length && <p>No recordings waiting for approval.</p>}
      {(state.inbox ?? []).filter(item => !selected || item.projectId === selected).map(item => <article key={item.id} style={{ padding: 12, border: '1px solid #8885', borderRadius: 8, marginTop: 10 }}><strong>{item.source.split('/').at(-1)}</strong><p>{state.projects.find(p => p.id === item.projectId)?.name} · {(item.bytes / 1024 ** 2).toFixed(1)} MB</p><p>Audio policy after export: {state.projects.find(p => p.id === item.projectId)?.retention}</p><button disabled={busy} onClick={() => void run(() => window.yogurt.projects.approveInput(item.id))}>Import recording</button> <button disabled={busy} onClick={() => void run(() => window.yogurt.projects.ignoreInput(item.id))}>Skip this file</button></article>)}
    </section>
    <h2 style={{ marginTop: 36 }}>Processing & review</h2>
    {state.jobs.filter(j => !selected || j.projectId === selected).map(job => <Job key={job.id} job={job} run={run} />)}
    <style>{`.project-workflows label{display:block;margin:12px 0}.project-workflows label>input:not([type=checkbox]),.project-workflows select{display:block;width:100%;padding:8px;border:1px solid #8885;border-radius:6px;background:transparent}.project-workflows button{padding:7px 12px;border:1px solid #8885;border-radius:6px}.project-workflows article p{overflow-wrap:anywhere}.project-workflows button:disabled{opacity:.45;cursor:default}.project-workflows h2{font-size:19px;font-weight:600}.project-workflows h1{font-size:26px;font-weight:650}`}</style>
  </main>
}
function Job({ job, run }: { job: ProjectJob; run: (f: () => Promise<unknown>) => Promise<void> }) {
  const [names, setNames] = useState<Record<string, string>>({})
  const clusters = [...new Set(job.segments?.map(s => s.cluster ?? s.speaker ?? 'Unknown speaker'))]
  return <article style={{ padding: 16, border: '1px solid #8885', borderRadius: 8, marginTop: 12 }}>
    <strong>{job.title || job.source.split('/').at(-1)}</strong><p>{job.state} · {job.stage}</p>{job.error && <p role="alert">{job.error}</p>}
    {job.transcript && <button onClick={() => void run(() => window.yogurt.projects.open(job.id, 'output'))}>Open Obsidian output folder</button>}<button onClick={() => void run(() => window.yogurt.projects.open(job.id, 'source'))}>Open original recording</button>
    {job.transcript && <p>Transcript: {job.transcript}</p>}{job.notes && <p>Notes: {job.notes}</p>}
    {(job.state === 'review' || job.state === 'failed') && !!job.segments?.length && <>
      {clusters.map(cluster => <label key={cluster}>{cluster}{job.voiceSamples?.[cluster] && <button onClick={() => void run(async () => { const src = await window.yogurt.projects.sample(job.id, cluster); await new Audio(src).play() })}>Listen to voice sample</button>}<input placeholder={job.segments?.find(s => s.cluster === cluster)?.speaker || 'Unknown speaker'} value={names[cluster] ?? ''} onChange={e => setNames({ ...names, [cluster]: e.target.value })} />{job.voiceEmbeddings?.[cluster] && <button disabled={!names[cluster]?.trim()} onClick={() => void run(() => window.yogurt.projects.enroll(job.id, cluster, names[cluster]))}>Confirm and remember this voice</button>}</label>)}
      <button onClick={() => void run(async () => { await window.yogurt.projects.speakers(job.id, names); await window.yogurt.projects.summarize(job.id) })}>Approve speakers and summarize</button>
    </>}
    {['failed', 'cancelled'].includes(job.state) && <button onClick={() => void run(() => window.yogurt.projects.retry(job.id))}>Retry from checkpoint</button>}
    {['queued', 'running'].includes(job.state) && <button onClick={() => void run(() => window.yogurt.projects.cancel(job.id))}>Cancel</button>}
  </article>
}
