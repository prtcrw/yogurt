import { useEffect, useState } from 'react'
import type { WorkspaceState } from '../../shared/projects'

/** Which Yogurt folders point at a folder on disk, read again whenever that changes */
export function useWorkspace(): WorkspaceState | undefined {
  const [state, setState] = useState<WorkspaceState>()
  useEffect(() => {
    let live = true
    const load = () => void window.yogurt.workspace.state().then(s => { if (live) setState(s) }, () => { if (live) setState({ projects: [] }) })
    load()
    const offWorkspace = window.yogurt.workspace.onChange(load), offProjects = window.yogurt.projects.onChange(load)
    return () => { live = false; offWorkspace(); offProjects() }
  }, [])
  return state
}
