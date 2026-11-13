import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FolderOpen, NotebookText } from 'lucide-react'
import type { WorkspaceFile as File, WorkspaceState } from '../../../shared/projects'
import { toClipboard } from '../../../shared/exportNotes'

/** "---\nkey: value\n---" at the top of a note: shown as a few quiet lines, not as text */
function splitFrontmatter(text: string): { meta: Array<[string, string]>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return { meta: [], body: text }
  const meta = m[1].split(/\r?\n/).map(line => line.match(/^([\w-]+):\s*(.*)$/)).filter((x): x is RegExpMatchArray => !!x).map(x => [x[1], x[2].replace(/^["']|["']$/g, '')] as [string, string])
  return { meta, body: text.slice(m[0].length) }
}

/**
 * A Markdown note from the workspace folder, read as it is on disk and shown again when it changes there. Editing
 * happens in the person's own editor (Obsidian when the folder is a vault).
 */
export function WorkspaceFile({ path, workspace, go }: { path: string; workspace?: WorkspaceState; go(route: string): void }) {
  const [file, setFile] = useState<File>()
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    const load = () => void window.yogurt.workspace.read(path).then(f => { if (live) { setFile(f); setError('') } }, e => { if (live) setError(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) })
    load()
    const off = window.yogurt.workspace.onChange(load)
    return () => { live = false; off() }
  }, [path])
  const view = useMemo(() => {
    if (!file) return undefined
    const { meta, body } = splitFrontmatter(file.text)
    return { meta, html: toClipboard(body).html }
  }, [file])
  const name = path.split('/').pop()?.replace(/\.md$/i, '') ?? path
  const folders = path.split('/').slice(0, -1)
  return <div data-testid="workspace-file" className="settings-screen">
    <div className="settings-titlebar-space" />
    <div className="settings-scroll">
      <article className="settings-content ws-file">
        <div className="ws-file-crumbs">{[workspace?.name ?? 'Workspace', ...folders].join(' / ')}</div>
        <header className="ws-file-header">
          <h1 className="settings-heading ws-file-title">{name}</h1>
          <div className="pj-row-actions">
            {file?.meetingId && <button className="workspace-button no-drag" onClick={() => go(`/note/${file.meetingId}`)}><NotebookText size={13} aria-hidden="true" />Open meeting</button>}
            <button className="workspace-button no-drag" onClick={() => void window.yogurt.workspace.reveal(path)}><FolderOpen size={13} aria-hidden="true" />Show in Finder</button>
            <button data-testid="workspace-file-open" className="workspace-button primary no-drag" onClick={() => void window.yogurt.workspace.open(path)}><ExternalLink size={13} aria-hidden="true" />{workspace?.obsidian ? 'Edit in Obsidian' : 'Open in editor'}</button>
          </div>
        </header>
        {error && <p role="alert" className="ms-error">{error}</p>}
        {view && view.meta.length > 0 && <dl className="ws-file-meta">{view.meta.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        {view && <div className="ws-file-body" dangerouslySetInnerHTML={{ __html: view.html }} />}
      </article>
    </div>
  </div>
}
