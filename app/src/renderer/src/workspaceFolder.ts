import { useEffect, useState } from 'react'
import type { WorkspaceEntry, WorkspaceState } from '../../shared/projects'

/** the route of a Markdown file in the workspace folder */
export const fileRoute = (path: string) => `/file/${encodeURIComponent(path)}`
export const fileOfRoute = (route: string) => route.startsWith('/file/') ? decodeURIComponent(route.slice('/file/'.length)) : null

/** Which folder is the sidebar workspace (none: Yogurt's own folders), read again whenever it changes */
export function useWorkspace(): WorkspaceState | undefined {
  const [state, setState] = useState<WorkspaceState>()
  useEffect(() => {
    let live = true
    const load = () => void window.yogurt.workspace.state().then(s => { if (live) setState(s) }, () => { if (live) setState({}) })
    load()
    const off = window.yogurt.workspace.onChange(load)
    return () => { live = false; off() }
  }, [])
  return state
}

/** One folder's entries, listed again when anything in the workspace changes on disk */
export function useWorkspaceEntries(path: string, enabled = true): WorkspaceEntry[] | undefined {
  const [entries, setEntries] = useState<WorkspaceEntry[]>()
  useEffect(() => {
    if (!enabled) return
    let live = true
    const load = () => void window.yogurt.workspace.list(path).then(e => { if (live) setEntries(e) }, () => { if (live) setEntries([]) })
    load()
    const off = window.yogurt.workspace.onChange(load)
    return () => { live = false; off() }
  }, [path, enabled])
  return entries
}
