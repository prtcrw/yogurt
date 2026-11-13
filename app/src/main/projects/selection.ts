import type { Project } from '../../shared/projects'
import type { NotesModel } from '../notes/model'
import type { Generate } from './providers'
/** Provider changes take effect for the next job; an in-flight request keeps its original selection. */
export function selectedNotesModel(local: NotesModel, selection: () => Project | undefined, generate: Generate): NotesModel {
  return {
    ...local,
    needsLoad: () => { const p = selection(); return !p || p.provider === 'local' ? local.needsLoad() : false },
    async llm(signal = new AbortController().signal) {
      const p = selection()
      if (!p || p.provider === 'local') return local.llm(signal)
      await local.unload()
      return {
        contextSize: 32768,
        count: async texts => texts.map(text => Buffer.byteLength(text, 'utf8')),
        readAhead: async () => {}, // Remote providers receive one bounded final request, not live read-ahead traffic.
        chat: async (prompt, onToken, opts) => {
          const history = opts?.before?.map((text, i) => `${i % 2 ? 'Assistant' : 'User'}: ${text}`).join('\n\n')
          const text = await generate(p, history ? `${history}\n\nUser: ${prompt}` : prompt, signal)
          onToken(text); return text
        },
      }
    },
  }
}
