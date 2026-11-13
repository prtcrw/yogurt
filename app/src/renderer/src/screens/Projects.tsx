import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronDown, ChevronLeft, FolderOpen, Inbox, LoaderCircle, Plus, RefreshCw, Square, Upload } from 'lucide-react'
import type { AgentProvider, Project, ProjectJob, ProjectState, ProviderKind } from '../../../shared/projects'

const providers: Array<[ProviderKind, string]> = [['local', 'Yogurt (on this computer)'], ['codex', 'Codex CLI'], ['claude', 'Claude Code CLI'], ['openai', 'OpenAI API'], ['anthropic', 'Anthropic API'], ['compatible', 'OpenAI-compatible (LM Studio, Ollama…)']]
const languages = [['auto', 'Auto-detect'], ['en', 'English'], ['th', 'Thai'], ['ja', 'Japanese'], ['zh', 'Chinese'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['ko', 'Korean']]
const agents: Array<[string, string]> = [['', 'Off'], ['claude', 'Claude Code'], ['codex', 'Codex']]
const agentName = (a?: string) => a === 'codex' ? 'Codex' : 'Claude Code'
const retentionLabel = { reference: 'Keep in place', archive: 'Move to archive', delete: 'Delete after export' }
const stateLabel: Record<ProjectJob['state'], string> = { queued: 'Queued', running: 'Processing', review: 'Needs review', completed: 'Done', failed: 'Failed', cancelled: 'Cancelled' }
const fresh = (): Project => ({ id: '', name: '', vault: '', folder: '.', output: 'Meetings', provider: 'local', model: '', endpoint: 'http://127.0.0.1:1234/v1', retention: 'reference', archive: '', contextFolders: ['.'], recognizeSpeakers: false, input: '', checkInput: false, speechLanguage: 'auto', followUps: true })
const baseName = (path: string) => path.split(/[\\/]/).pop() || path
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Tab = 'activity' | 'settings'

/** Obsidian projects: what is waiting and in progress on one tab, how the project is set up on the other. */
export function Projects({ back }: { back?: () => void }) {
  const [state, setState] = useState<ProjectState>({ projects: [], jobs: [], profiles: [], configured: [] })
  const [loaded, setLoaded] = useState(false)
  const [meetings, setMeetings] = useState<Array<{ id: string; title: string }>>([])
  const [meetingId, setMeetingId] = useState('')
  const [draft, setDraft] = useState<Project>(fresh)
  const [selected, setSelected] = useState('')
  const [tab, setTab] = useState<Tab>('activity')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState('')
  const [savedNote, setSavedNote] = useState(false)
  const [workspaceId, setWorkspaceId] = useState<string>()
  useEffect(() => { void window.yogurt.workspace.state().then(s => setWorkspaceId(s.projectId)).catch(() => {}) }, [])

  const refresh = () => window.yogurt.projects.state().then(setState).catch(e => setError(message(e)))
  useEffect(() => { void window.yogurt.meetings.cards({ limit: 100 }).then(setMeetings).catch(() => {}) }, [])
  useEffect(() => {
    void window.yogurt.projects.state().then(data => {
      setState(data); setLoaded(true)
      let last: string | null = null
      try { last = localStorage.getItem('yogurt.lastProject') } catch { /* storage may be unavailable */ }
      const project = data.projects.find(p => p.id === (last || data.defaultProjectId)) ?? data.projects[0]
      if (project) { setDraft(project); setSelected(project.id) } else setTab('settings')
    }).catch(e => { setError(message(e)); setLoaded(true) })
    return window.yogurt.projects.onChange(() => { void refresh() })
  }, [])
  useEffect(() => { try { if (selected) localStorage.setItem('yogurt.lastProject', selected) } catch { /* fine */ } }, [selected])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const field = <K extends keyof Project>(name: K, value: Project[K]) => { setDraft(p => ({ ...p, [name]: value })); setSavedNote(false) }
  const folder = (name: 'vault' | 'archive' | 'input') => run(async () => { const path = await window.yogurt.projects.chooseFolder(); if (path) field(name, path) })
  const choose = (id: string) => {
    if (id === '__new__') { setDraft(fresh()); setSelected(''); setTab('settings'); return }
    const p = state.projects.find(x => x.id === id); if (p) { setDraft(p); setSelected(p.id) }
  }

  const saved = state.projects.find(p => p.id === selected)
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved ?? fresh()), [draft, saved])
  const inbox = (state.inbox ?? []).filter(item => !selected || item.projectId === selected)
  const jobs = state.jobs.filter(j => !selected || j.projectId === selected)
  const attention = inbox.length + jobs.filter(j => j.state === 'review').length
  const outputPath = draft.vault ? [draft.vault, draft.folder === '.' ? '' : draft.folder, draft.output].filter(Boolean).join('/') : ''
  const apiKey = ['openai', 'anthropic', 'compatible'].includes(draft.provider)
  const isDefault = !!selected && state.defaultProjectId === selected

  const save = () => run(async () => { const p = await window.yogurt.projects.save(draft); setDraft(p); setSelected(p.id); setSavedNote(true) })

  return (
    <div data-testid="projects" className="settings-screen pj">
      <div className="settings-titlebar-space" />
      <div className="settings-scroll">
        <div className="settings-content pj-content">
          {back && <button className="settings-link pj-back no-drag" onClick={back}><ChevronLeft size={14} aria-hidden="true" />Back to setup</button>}
          <header className="pj-header">
            <div className="pj-header-copy">
              <h1 className="settings-heading">Projects</h1>
              <p className="settings-intro">Turn recordings into transcripts and notes in your Obsidian vault.</p>
            </div>
            {state.projects.length > 0 && <div className="pj-header-actions">
              <span className="settings-select-wrap">
                <select aria-label="Project" className="settings-select pj-switch" value={selected || '__new__'} onChange={e => choose(e.target.value)}>
                  {state.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="__new__">New project…</option>
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </span>
              <button className="workspace-button primary no-drag" disabled={!selected || busy} onClick={() => void run(() => window.yogurt.projects.importMany(selected))}>
                <Upload size={13} aria-hidden="true" />Import files…
              </button>
            </div>}
          </header>

          {selected && <div className="settings-spoken pj-tabs" role="tablist" aria-label="Project view">
            <button role="tab" aria-selected={tab === 'activity'} aria-checked={tab === 'activity'} className="settings-spoken-choice" onClick={() => setTab('activity')}>
              Activity{attention > 0 && <span className="pj-count">{attention}</span>}
            </button>
            <button role="tab" aria-selected={tab === 'settings'} aria-checked={tab === 'settings'} className="settings-spoken-choice" onClick={() => setTab('settings')}>Settings</button>
          </div>}

          {error && <p role="alert" className="ms-error">{error}</p>}

          {!loaded ? <div className="pj-empty"><LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /></div>
            : tab === 'activity' && selected ? <>
              <Section title="Waiting for approval" action={<button className="settings-link no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.checkInbox())}><RefreshCw size={12} aria-hidden="true" />Check input folders now</button>}>
                {state.inboxErrors && Object.entries(state.inboxErrors).map(([id, text]) => <p role="alert" key={id} className="ms-error">{state.projects.find(p => p.id === id)?.name}: {text}</p>)}
                {inbox.length ? <div className="settings-group">
                  {inbox.map(item => {
                    const project = state.projects.find(p => p.id === item.projectId)
                    return <div key={item.id} className="settings-row">
                      <div className="settings-row-copy">
                        <div className="settings-label pj-ellipsis" title={item.source}>{baseName(item.source)}</div>
                        <p className="settings-description">{(item.bytes / 1024 ** 2).toFixed(1)} MB · Audio afterwards: {project ? retentionLabel[project.retention] : '—'}</p>
                      </div>
                      <div className="pj-row-actions">
                        <button className="workspace-button no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.ignoreInput(item.id))}>Skip this file</button>
                        <button className="workspace-button primary no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.approveInput(item.id))}>Import recording</button>
                      </div>
                    </div>
                  })}
                </div> : <p className="pj-quiet">{draft.checkInput && draft.input ? `No new recordings in ${baseName(draft.input)}.` : 'Nothing waiting. Turn on input-folder watching in Settings to pick up new recordings automatically.'}</p>}
              </Section>

              <Section title="Processing & review" action={saved?.agent ? <button className="settings-link no-drag" onClick={() => void run(() => window.yogurt.projects.openInbox(selected))}><Inbox size={12} aria-hidden="true" />Open agent inbox</button> : undefined}>
                {jobs.length ? <div className="pj-jobs">{jobs.map(job => <Job key={job.id} job={job} agent={state.projects.find(p => p.id === job.projectId)?.agent} run={run} busy={busy} />)}</div>
                  : <p className="pj-quiet">No recordings processed yet. Use <strong>Import files…</strong> or export a meeting below.</p>}
              </Section>

              <Section title="Export a Yogurt meeting">
                <div className="settings-group"><div className="settings-row">
                  <div className="settings-row-copy">
                    <label htmlFor="pj-meeting" className="settings-label">Meeting</label>
                    <p className="settings-description">Reuses its saved transcript; the audio stays in Yogurt.</p>
                  </div>
                  <span className="settings-select-wrap">
                    <select id="pj-meeting" className="settings-select pj-wide" value={meetingId} onChange={e => setMeetingId(e.target.value)}>
                      <option value="">Choose a meeting…</option>
                      {meetings.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
                    </select>
                    <ChevronDown size={14} aria-hidden="true" />
                  </span>
                  <button className="workspace-button no-drag" disabled={!meetingId || busy} onClick={() => void run(() => window.yogurt.projects.exportMeeting(selected, meetingId))}>Review and export</button>
                </div></div>
              </Section>
            </>
            : <>
              {!selected && <div className="pj-intro">
                <Plus size={16} aria-hidden="true" />
                <div><strong>{state.projects.length ? 'New project' : 'Create your first project'}</strong>
                  <p>Pick an Obsidian vault and where meeting notes should go. Everything else has sensible defaults.</p></div>
              </div>}

              <Section title="Where notes go">
                <div className="settings-group">
                  <Row label="Name" htmlFor="pj-name">
                    <input id="pj-name" className="settings-name-field pj-input" value={draft.name} placeholder="e.g. Research team" onChange={e => field('name', e.target.value)} />
                  </Row>
                  <Row label="Obsidian vault" description={draft.vault || 'Not chosen yet'} title={draft.vault}>
                    <button aria-label="Choose vault folder" className="workspace-button no-drag" disabled={busy} onClick={() => void folder('vault')}><FolderOpen size={13} aria-hidden="true" />{draft.vault ? 'Change…' : 'Choose…'}</button>
                  </Row>
                  <Row label="Project folder" htmlFor="pj-folder" description="Inside the vault. Use . for the vault itself.">
                    <PathInput id="pj-folder" value={draft.folder} placeholder="NIST/MLLO" onChange={v => field('folder', v)}
                      browse={{ label: 'Browse project folder…', disabled: !draft.vault || busy, onClick: () => void run(async () => { const path = await window.yogurt.projects.chooseProjectFolder(draft, 'project'); if (path) field('folder', path) }) }} />
                  </Row>
                  <Row label="Meeting output subfolder" htmlFor="pj-output" description="Inside the project folder.">
                    <PathInput id="pj-output" value={draft.output} onChange={v => field('output', v)}
                      browse={{ label: 'Browse output folder…', disabled: !draft.vault || busy, onClick: () => void run(async () => { const path = await window.yogurt.projects.chooseProjectFolder(draft, 'output'); if (path) field('output', path) }) }} />
                  </Row>
                </div>
                {outputPath && <p className="pj-quiet pj-ellipsis" title={outputPath}>Notes are saved to <code>{outputPath}</code></p>}
                {selected && <div className="settings-group pj-gap">
                  <Row label="Use as sidebar workspace" htmlFor="pj-sidebar" description={workspaceId === selected ? 'The sidebar shows this folder, and each finished Yogurt meeting is saved into the meeting subfolder. Edits made in Obsidian are never overwritten.' : 'Show this project folder in the sidebar instead of Yogurt’s own folders, and save finished meetings into it.'}>
                    <Switch id="pj-sidebar" label="Use as sidebar workspace" checked={workspaceId === selected} onChange={on => { const before = workspaceId; setWorkspaceId(on ? selected : undefined); void run(async () => { try { await window.yogurt.workspace.use(on ? selected : null) } catch (e) { setWorkspaceId(before); throw e } }) }} />
                  </Row>
                </div>}
              </Section>

              <Section title="Summaries">
                <div className="settings-group">
                  <Row label="Summary provider" htmlFor="pj-provider" description={draft.provider === 'local' ? 'Private: nothing leaves this computer.' : 'The transcript and selected project notes are sent to this provider.'}>
                    <Select id="pj-provider" value={draft.provider} onChange={v => { field('provider', v as ProviderKind); setKey('') }} options={providers} />
                  </Row>
                  {['codex', 'claude'].includes(draft.provider) && <p className="pj-inline-note">Uses your existing {draft.provider === 'codex' ? 'Codex' : 'Claude Code'} CLI sign-in; account limits apply.</p>}
                  {draft.provider !== 'local' && <Row label="Model" htmlFor="pj-model" description="Leave blank for the provider's default.">
                    <input id="pj-model" className="settings-name-field pj-input" value={draft.model} placeholder="Default" onChange={e => field('model', e.target.value)} />
                  </Row>}
                  {draft.provider === 'compatible' && <Row label="Endpoint" htmlFor="pj-endpoint">
                    <input id="pj-endpoint" className="settings-name-field pj-input" value={draft.endpoint} onChange={e => field('endpoint', e.target.value)} />
                  </Row>}
                  {apiKey && <Row label="API key" htmlFor="pj-key" description={state.configured.includes(draft.provider) ? 'Saved securely in the system keychain.' : 'Not saved yet.'}>
                    <div className="pj-row-actions">
                      <input id="pj-key" type="password" autoComplete="off" className="settings-name-field pj-key" value={key} placeholder={state.configured.includes(draft.provider) ? '••••••••' : 'Paste key'} onChange={e => setKey(e.target.value)} />
                      <button className="workspace-button no-drag" disabled={!key || busy} onClick={() => void run(async () => { await window.yogurt.projects.credential(draft.provider, key); setKey('') })}>Save key</button>
                      {state.configured.includes(draft.provider) && <button className="settings-link no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.credential(draft.provider, ''))}>Remove</button>}
                    </div>
                  </Row>}
                  {selected && <Row label="Use for all Yogurt summaries" description={isDefault ? 'Yogurt meeting notes use this project’s provider.' : 'Also use this provider for regular Yogurt meetings.'}>
                    {isDefault ? <span className="settings-permission-status">Default</span>
                      : <button className="workspace-button no-drag" disabled={busy || dirty} title={dirty ? 'Save the project first' : undefined} onClick={() => void run(() => window.yogurt.projects.defaultProvider(selected))}>Make default</button>}
                  </Row>}
                </div>
              </Section>

              <Section title="Meeting agent">
                <div className="settings-group">
                  <Row label="Agent" htmlFor="pj-agent" description={draft.agent ? `After a meeting, Run agent lets ${agentName(draft.agent)} write minutes and plan next steps using your workspace. Uses your existing CLI sign-in.` : 'Off. Turn on to run Codex or Claude Code in this workspace after a meeting.'}>
                    <Select id="pj-agent" aria="Meeting agent" value={draft.agent ?? ''} onChange={v => field('agent', v as AgentProvider | '')} options={agents} />
                  </Row>
                  {draft.agent && <>
                    <Row label="Agent model" htmlFor="pj-agent-model" description="Leave blank for the CLI's default.">
                      <input id="pj-agent-model" className="settings-name-field pj-input" value={draft.agentModel ?? ''} placeholder="Default" onChange={e => field('agentModel', e.target.value)} />
                    </Row>
                    <Row label="Agent inbox" htmlFor="pj-agent-inbox" description="Proposed edits to your kanban and notes land here for you to review. The agent never edits them directly.">
                      <input id="pj-agent-inbox" className="settings-name-field pj-input" value={draft.agentInbox ?? 'Agent Inbox'} onChange={e => field('agentInbox', e.target.value)} />
                    </Row>
                    <p className="pj-inline-note">The agent reads the whole workspace but writes only to the meeting&rsquo;s folder and the agent inbox. Put a <code>YOGURT.md</code> (or <code>AGENTS.md</code> / <code>CLAUDE.md</code>) in the project folder to tell it where your kanban and knowledge base are and how you like minutes written.</p>
                  </>}
                </div>
              </Section>

              <Section title="Incoming recordings">
                <div className="settings-group">
                  <Row label="Recording input folder" htmlFor="pj-input" description="New audio or video files here can be imported.">
                    <PathInput id="pj-input" value={draft.input ?? ''} placeholder="Not set" onChange={v => field('input', v)}
                      browse={{ label: 'Choose input folder', disabled: busy, onClick: () => void folder('input') }} />
                  </Row>
                  <Row label="Watch for new recordings" htmlFor="pj-watch" description="Asks before importing. Subfolders are ignored and nothing is deleted without approval.">
                    <Switch id="pj-watch" label="Check input folder and ask before importing" checked={!!draft.checkInput} onChange={v => field('checkInput', v)} />
                  </Row>
                  <Row label="Spoken language" htmlFor="pj-language">
                    <Select id="pj-language" aria="Imported speech language" value={draft.speechLanguage || 'auto'} onChange={v => field('speechLanguage', v)} options={languages as Array<[string, string]>} />
                  </Row>
                </div>
              </Section>

              <Section title="After processing">
                <div className="settings-group">
                  <Row label="Original audio" htmlFor="pj-retention" description={draft.retention === 'delete' ? 'Deleted only after the transcript and notes are safely saved.' : draft.retention === 'archive' ? 'Moved to a folder outside the vault.' : 'Stays where it is; notes link to it.'}>
                    <Select id="pj-retention" value={draft.retention} onChange={v => field('retention', v as Project['retention'])} options={Object.entries(retentionLabel)} />
                  </Row>
                  {draft.retention === 'archive' && <Row label="Audio archive" description={draft.archive || 'Not chosen yet'} title={draft.archive}>
                    <button aria-label="Choose audio archive" className="workspace-button no-drag" disabled={busy} onClick={() => void folder('archive')}><FolderOpen size={13} aria-hidden="true" />{draft.archive ? 'Change…' : 'Choose…'}</button>
                  </Row>}
                  <Row label="Recognize speakers" htmlFor="pj-speakers" description="Runs on this computer. First use downloads the voice models.">
                    <Switch id="pj-speakers" checked={!!draft.recognizeSpeakers} onChange={v => field('recognizeSpeakers', v)} />
                  </Row>
                  <Row label="Suggest a follow-up" htmlFor="pj-followups" description="Drafts a next step from the meeting and project notes.">
                    <Switch id="pj-followups" label="Suggest a follow-up from meeting context" checked={draft.followUps !== false} onChange={v => field('followUps', v)} />
                  </Row>
                  <Row label="Context folders" htmlFor="pj-context" description="Project folders the summary may read, one per line.">
                    <textarea id="pj-context" rows={Math.max(2, draft.contextFolders.length)} className="settings-name-field pj-input pj-textarea" value={draft.contextFolders.join('\n')} onChange={e => field('contextFolders', e.target.value.split('\n'))} />
                  </Row>
                </div>
              </Section>

              {state.profiles.length > 0 && <Section title="Remembered voices">
                <div className="settings-group">
                  {state.profiles.map(p => <Row key={p.id} label={p.name}>
                    <button className="settings-link no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.forget(p.id))}>Forget voice</button>
                  </Row>)}
                </div>
              </Section>}
              <div className="pj-savebar-space" />
            </>}
        </div>
      </div>

      {(tab === 'settings' || !selected) && loaded && <footer className="pj-savebar">
        <span className="pj-quiet">{savedNote && !dirty ? 'Saved.' : dirty ? (selected ? 'Unsaved changes' : 'New project') : 'All changes saved'}</span>
        <div className="pj-row-actions">
          {dirty && selected && <button className="workspace-button no-drag" disabled={busy} onClick={() => saved && setDraft(saved)}>Discard</button>}
          <button className="workspace-button primary no-drag" disabled={busy || !dirty || !draft.name.trim() || !draft.vault} title={!draft.vault ? 'Choose an Obsidian vault first' : undefined} onClick={() => void save()}>
            {busy && <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{selected ? 'Save project' : 'Create project'}
          </button>
        </div>
      </footer>}
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return <section className="pj-section">
    <div className="pj-section-head"><h2 className="settings-section-heading">{title}</h2>{action}</div>
    {children}
  </section>
}

function Row({ label, htmlFor, description, title, children }: { label: string; htmlFor?: string; description?: string; title?: string; children: ReactNode }) {
  return <div className="settings-row">
    <div className="settings-row-copy">
      {htmlFor ? <label htmlFor={htmlFor} className="settings-label">{label}</label> : <div className="settings-label">{label}</div>}
      {description && <p className="settings-description pj-ellipsis" title={title}>{description}</p>}
    </div>
    {children}
  </div>
}

function PathInput({ id, value, placeholder, onChange, browse }: { id: string; value: string; placeholder?: string; onChange(v: string): void; browse: { label: string; disabled: boolean; onClick(): void } }) {
  return <div className="pj-row-actions">
    <input id={id} className="settings-name-field pj-input" value={value} placeholder={placeholder} spellCheck={false} autoComplete="off" onChange={e => onChange(e.target.value)} />
    <button aria-label={browse.label} title={browse.label} className="workspace-button pj-icon no-drag" disabled={browse.disabled} onClick={browse.onClick}><FolderOpen size={13} aria-hidden="true" /></button>
  </div>
}

function Select({ id, aria, value, onChange, options }: { id: string; aria?: string; value: string; onChange(v: string): void; options: Array<[string, string]> }) {
  return <span className="settings-select-wrap">
    <select id={id} aria-label={aria} className="settings-select pj-select" value={value} onChange={e => onChange(e.target.value)}>
      {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
    <ChevronDown size={14} aria-hidden="true" />
  </span>
}

/** A native checkbox drawn as the settings toggle, so keyboard, forms and tests treat it as one */
function Switch({ id, label, checked, onChange }: { id: string; label?: string; checked: boolean; onChange(v: boolean): void }) {
  return <input id={id} type="checkbox" role="switch" aria-label={label} className="pj-switch-input" checked={checked} onChange={e => onChange(e.target.checked)} />
}

function Job({ job, agent, run, busy }: { job: ProjectJob; agent?: AgentProvider | ''; run: (f: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [names, setNames] = useState<Record<string, string>>({})
  const clusters = [...new Set(job.segments?.map(s => s.cluster ?? s.speaker ?? 'Unknown speaker'))]
  const reviewing = (job.state === 'review' || job.state === 'failed') && !!job.segments?.length
  return <article className="settings-group pj-job" data-state={job.state}>
    <div className="settings-row">
      <div className="settings-row-copy">
        <div className="settings-label pj-job-title">
          <span className="pj-ellipsis" title={job.source}>{job.title || baseName(job.source)}</span>
          <span className="pj-chip" data-state={job.state}>{job.state === 'running' && <LoaderCircle size={10} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}{stateLabel[job.state]}</span>
        </div>
        <p className="settings-description">{job.stage}</p>
        {job.error && <p role="alert" className="pj-job-error">{job.error}</p>}
      </div>
      <div className="pj-row-actions">
        {job.transcript && <button className="settings-link no-drag" onClick={() => void run(() => window.yogurt.projects.open(job.id, 'output'))}>Open notes folder</button>}
        <button className="settings-link no-drag" onClick={() => void run(() => window.yogurt.projects.open(job.id, 'source'))}>Show recording</button>
        {['failed', 'cancelled'].includes(job.state) && <button className="workspace-button no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.retry(job.id))}>Retry</button>}
        {['queued', 'running'].includes(job.state) && <button className="workspace-button no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.cancel(job.id))}>Cancel</button>}
      </div>
    </div>
    {reviewing && <div className="pj-review">
      <p className="settings-description">Name the speakers, then Yogurt writes the summary.</p>
      {clusters.map(cluster => <div key={cluster} className="pj-speaker">
        <label htmlFor={`pj-${job.id}-${cluster}`} className="pj-speaker-label">{cluster}</label>
        <input id={`pj-${job.id}-${cluster}`} className="settings-name-field pj-input" placeholder={job.segments?.find(s => s.cluster === cluster)?.speaker || 'Unknown speaker'} value={names[cluster] ?? ''} onChange={e => setNames({ ...names, [cluster]: e.target.value })} />
        {job.voiceSamples?.[cluster] && <button className="settings-link no-drag" onClick={() => void run(async () => { const src = await window.yogurt.projects.sample(job.id, cluster); await new Audio(src).play() })}>Listen</button>}
        {job.voiceEmbeddings?.[cluster] && <button className="settings-link no-drag" disabled={!names[cluster]?.trim()} onClick={() => void run(() => window.yogurt.projects.enroll(job.id, cluster, names[cluster]))}>Remember voice</button>}
      </div>)}
      <div><button className="workspace-button primary no-drag" disabled={busy} onClick={() => void run(async () => { await window.yogurt.projects.speakers(job.id, names); await window.yogurt.projects.summarize(job.id) })}>Approve speakers and summarize</button></div>
    </div>}
    {agent && job.transcript && ['completed', 'review'].includes(job.state) && <AgentBar job={job} agent={agent} run={run} busy={busy} />}
    {(job.transcript || job.notes) && <p className="pj-paths">{job.notes ? <>Notes: <code title={job.notes}>{job.notes}</code></> : <>Transcript: <code title={job.transcript}>{job.transcript}</code></>}</p>}
  </article>
}

function AgentBar({ job, agent, run, busy }: { job: ProjectJob; agent: AgentProvider; run: (f: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const a = job.agent
  const running = a?.state === 'running'
  const name = agentName(a?.provider ?? agent)
  return <div className="pj-agent" data-state={a?.state ?? 'idle'}>
    <span className="pj-agent-icon" aria-hidden="true">{running ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : <Bot size={14} />}</span>
    <div className="pj-agent-copy">
      <div className="pj-agent-title">{running ? `${name} is working in your workspace…` : a?.state === 'done' ? `${name} finished` : a?.state === 'failed' ? `${name} couldn’t finish` : a?.state === 'stopped' ? 'Agent stopped' : 'Meeting agent'}</div>
      <p className="settings-description">{a?.error ?? (a?.state === 'done' ? (a.report?.split('\n').find(l => l.trim()) ?? 'See agent-report.md in the meeting folder.') : running ? 'Writing minutes and next steps; proposals go to the agent inbox.' : `Write minutes, check the kanban and knowledge base, and plan next steps with ${name}.`)}</p>
    </div>
    {running
      ? <button className="workspace-button no-drag" onClick={() => void run(() => window.yogurt.projects.stopAgent(job.id))}><Square size={11} aria-hidden="true" />Stop</button>
      : <button className="workspace-button primary no-drag" disabled={busy} onClick={() => void run(() => window.yogurt.projects.runAgent(job.id))}>{a ? 'Run again' : 'Run agent'}</button>}
  </div>
}
