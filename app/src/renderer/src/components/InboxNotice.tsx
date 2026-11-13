import { useEffect, useState } from 'react'

export function InboxNotice({ review }: { review(): void }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const update = () => { void window.yogurt.projects.state().then(state => setCount(state.inbox?.length ?? 0)).catch(() => {}) }
    update(); return window.yogurt.projects.onChange(update)
  }, [])
  if (!count) return null
  return <div role="status" data-testid="inbox-notice" className="inbox-notice">
    <span>{count} recording{count === 1 ? '' : 's'} waiting for import approval</span>
    <button className="workspace-button primary no-drag" onClick={review}>Review recordings</button>
  </div>
}
