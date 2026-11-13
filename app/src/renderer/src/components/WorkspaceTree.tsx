import { useEffect, useState } from 'react'
import { ChevronRight, FileText as FileIcon, Folder as FolderIcon, FolderOpen } from 'lucide-react'
import type { WorkspaceEntry } from '../../../shared/projects'
import { fileOfRoute, fileRoute, useWorkspaceEntries } from '../workspaceFolder'

/**
 * The sidebar's workspace when it is a folder on disk: its folders and Markdown files as a tree. Folders open in place;
 * a file opens on its own page. What is open is remembered for this window.
 */
export function WorkspaceTree({ route, go, collapsed = false }: { route: string; go(route: string): void; collapsed?: boolean }) {
  const current = fileOfRoute(route)
  const [open, setOpen] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(sessionStorage.getItem('yogurt.workspaceOpen') ?? '[]')) } catch { return new Set() }
  })
  // the folders above the file being read stay open
  useEffect(() => {
    if (!current) return
    const parts = current.split('/').slice(0, -1)
    setOpen(o => { const next = new Set(o); parts.forEach((_, i) => next.add(parts.slice(0, i + 1).join('/'))); return next })
  }, [current])
  useEffect(() => { try { sessionStorage.setItem('yogurt.workspaceOpen', JSON.stringify([...open])) } catch { /* fine */ } }, [open])
  const toggle = (path: string) => setOpen(o => { const next = new Set(o); next.has(path) ? next.delete(path) : next.add(path); return next })
  return <nav aria-label="Workspace folder" data-testid="workspace-tree" className="ws-tree">
    <Level path="" depth={0} open={open} toggle={toggle} current={current} go={go} collapsed={collapsed} />
  </nav>
}

function Level({ path, depth, open, toggle, current, go, collapsed }: { path: string; depth: number; open: Set<string>; toggle(p: string): void; current: string | null; go(r: string): void; collapsed: boolean }) {
  const entries = useWorkspaceEntries(path)
  if (!entries) return depth === 0 ? <div className="ws-tree-empty">Loading…</div> : null
  if (!entries.length) return depth === 0 ? <div className="ws-tree-empty">This folder has no notes yet.</div> : <div className="ws-tree-empty" style={{ paddingInlineStart: 12 + depth * 14 }}>Empty</div>
  return <ul role={depth ? 'group' : 'tree'} className="ws-tree-level">
    {entries.map(e => <Item key={e.path} entry={e} depth={depth} open={open} toggle={toggle} current={current} go={go} collapsed={collapsed} />)}
  </ul>
}

function Item({ entry, depth, open, toggle, current, go, collapsed }: { entry: WorkspaceEntry; depth: number; open: Set<string>; toggle(p: string): void; current: string | null; go(r: string): void; collapsed: boolean }) {
  const expanded = entry.kind === 'folder' && open.has(entry.path)
  return <li role="treeitem" aria-expanded={entry.kind === 'folder' ? expanded : undefined} aria-selected={current === entry.path}>
    <button data-testid="workspace-entry" data-kind={entry.kind} title={collapsed ? entry.name : entry.path} aria-current={current === entry.path ? 'page' : undefined}
      className="workspace-nav ws-tree-row" style={{ paddingInlineStart: `calc(var(--nav-inset) + ${depth * 14}px)` }}
      onClick={() => entry.kind === 'folder' ? toggle(entry.path) : go(fileRoute(entry.path))}>
      {entry.kind === 'folder'
        ? <><ChevronRight size={12} aria-hidden="true" className="ws-tree-chevron" data-open={expanded} />{expanded ? <FolderOpen size={15} strokeWidth={1.75} aria-hidden="true" /> : <FolderIcon size={15} strokeWidth={1.75} aria-hidden="true" />}</>
        : <><span className="ws-tree-chevron-space" /><FileIcon size={15} strokeWidth={1.75} aria-hidden="true" /></>}
      <span>{entry.name}</span>
    </button>
    {expanded && <Level path={entry.path} depth={depth + 1} open={open} toggle={toggle} current={current} go={go} collapsed={collapsed} />}
  </li>
}
