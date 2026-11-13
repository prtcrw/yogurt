import { useEffect, useState } from 'react'

export function InboxNotice({ review }: { review(): void }) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const update = () => { void window.yogurt.projects.state().then(state => setCount(state.inbox?.length ?? 0)).catch(() => {}) }
    update(); return window.yogurt.projects.onChange(update)
  }, [])
  if (!count) return null
  return <div role="status" data-testid="inbox-notice" style={{ position: 'fixed', right: 22, bottom: 22, zIndex: 100, background: 'var(--color-bg, #ecebe8)', color: 'var(--color-ink, #222)', border: '1px solid #8887', boxShadow: '0 4px 20px #0002', borderRadius: 10, padding: 14 }}>
    {count} recording{count === 1 ? '' : 's'} waiting for import approval. <button onClick={review} style={{ textDecoration: 'underline', marginLeft: 10 }}>Review recordings</button>
  </div>
}
