import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, realpathSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, open, readdir, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Project, ProjectSegment, Retention } from '../../shared/projects'

export function inside(root: string, target: string): string {
  const base = realpathSync(root)
  const path = resolve(base, target)
  const rel = relative(base, path)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('Path must stay within the selected project')
  // Resolve existing ancestors too: output/context symlinks must not escape the vault.
  let ancestor = path
  while (true) {
    try {
      const actual = realpathSync(ancestor)
      const r = relative(base, actual)
      if (r === '..' || r.startsWith('..' + sep) || isAbsolute(r)) throw new Error('A symlink redirects outside the project')
      break
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      const parent = dirname(ancestor)
      if (parent === ancestor) throw e
      ancestor = parent
    }
  }
  return path
}
export async function atomic(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = path + '.' + randomUUID() + '.tmp'
  try { const file = await open(tmp, 'wx', 0o600); try { await file.writeFile(text); await file.sync() } finally { await file.close() }; await rename(tmp, path) }
  finally { await unlink(tmp).catch(() => {}) }
}
export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const block of createReadStream(path)) hash.update(block)
  return hash.digest('hex')
}
export async function context(project: Project, transcript: string): Promise<Array<{ path: string; text: string }>> {
  const root = inside(project.vault, project.folder)
  const output = inside(root, project.output)
  const query = new Set(transcript.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const docs: Array<{ path: string; text: string; score: number }> = []
  let bytes = 0, files = 0
  async function walk(directory: string) {
    for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files >= 200 || bytes >= 2_000_000 || item.name.startsWith('.') || item.isSymbolicLink()) continue
      const path = inside(root, join(directory, item.name))
      if (path === output || path.startsWith(output + sep)) continue
      if (item.isDirectory()) { await walk(path); continue }
      if (!item.name.endsWith('.md') || (await lstat(path)).size > 200_000) continue
      files++
      const text = (await readFile(path, 'utf8')).slice(0, Math.min(200_000, 2_000_000 - bytes)); bytes += text.length
      for (let offset = 0; offset < text.length; offset += 1400) {
        const piece = text.slice(offset, offset + 1400)
        const words = new Set(piece.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
        const score = [...words].filter(w => query.has(w)).length + (/glossary|context|people/i.test(item.name) ? 3 : 0)
        docs.push({ path: relative(project.vault, path).split(sep).join('/') + `#offset-${offset}`, text: piece, score })
      }
    }
  }
  for (const folder of project.contextFolders) await walk(inside(root, folder))
  let remaining = 12000
  return docs.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).flatMap(({ path, text }) => {
    if (remaining <= 0) return []
    const excerpt = text.slice(0, remaining); remaining -= excerpt.length
    return [{ path, text: excerpt }]
  })
}
export function clock(ms: number) {
  const seconds = Math.floor(ms / 1000)
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':')
}
export function transcriptMarkdown(title: string, segments: ProjectSegment[], audioUri: string, hash: string, status: string, audioSources?: string[]) {
  return ['---', `title: ${JSON.stringify(title)}`, `audio_uri: ${JSON.stringify(audioUri)}`, `audio_sha256: ${JSON.stringify(hash)}`,
    `audio_status: ${JSON.stringify(status)}`, 'type: meeting-transcript', '---', '', `# ${title}`, '',
    status === 'deleted' ? 'Audio was deleted after successful export. The original URI and checksum are retained above.' : `[Source recording](${audioUri})`, '',
    ...(audioSources ?? []).map((source, i) => `[Recording track ${i + 1}](${pathToFileURL(source).href})`), '',
    ...segments.map(s => `## ${s.id}\n\n${clock(s.startMs)} · **${s.speaker || 'Unknown speaker'}:** ${s.text}\n`)].join('\n') + '\n'
}
export async function retainAudio(source: string, policy: Retention, archive: string, jobId: string, expectedHash: string,
  ready: () => Promise<boolean>): Promise<{ uri: string; status: string }> {
  if (!(await ready())) throw new Error('Audio retention waits until transcript and notes are safely exported')
  if (await sha256(source) !== expectedHash) throw new Error('Source changed during processing; audio was left untouched')
  if (policy === 'reference') return { uri: pathToFileURL(source).href, status: 'external' }
  if (policy === 'delete') { await unlink(source); return { uri: pathToFileURL(source).href, status: 'deleted' } }
  if (!archive) throw new Error('Choose an external audio archive')
  const { basename } = await import('node:path')
  const { copyFile, constants } = await import('node:fs/promises')
  await mkdir(archive, { recursive: true })
  const target = join(archive, `${jobId}_${basename(source)}`)
  await copyFile(source, target, constants.COPYFILE_EXCL)
  if (await sha256(target) !== expectedHash) { await unlink(target); throw new Error('Archive checksum mismatch; original retained') }
  const copy = await open(target, 'r'); try { await copy.sync() } finally { await copy.close() }
  if (await sha256(source) !== expectedHash) throw new Error('Source changed during archiving; original was kept')
  await unlink(source)
  return { uri: pathToFileURL(target).href, status: 'archived' }
}
