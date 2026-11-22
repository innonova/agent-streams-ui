import type { Feature, FeatureStatus } from '@/api/types'

/** What awaits a person first, then what is moving, then what waits. */
export const STATUS_ORDER: FeatureStatus[] = ['review', 'in-progress', 'blocked', 'planned', 'done']

/**
 * The latest report or response of a feature, for its row: which it is,
 * its date, and the first real paragraph of it, so a list says where
 * each feature stands without opening every one. Nothing for a feature
 * not yet reported on, or done.
 */
export function latest(f: Feature): { kind: string; date: string; text: string } | null {
  if (f.status === 'done') return null
  const heading = /^## (Report|Response) \(([^)]*)\)\s*$/gm
  let m: RegExpExecArray | null
  let last: { kind: string; date: string; at: number } | null = null
  while ((m = heading.exec(f.body)))
    last = { kind: m[1]!.toLowerCase(), date: m[2]!, at: m.index + m[0].length }
  if (!last) return null
  const rest = f.body.slice(last.at)
  const next = rest.search(/^## /m)
  const paragraphs = (next >= 0 ? rest.slice(0, next) : rest)
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/^#+\s.*$/gm, '')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
  const text = paragraphs.find((p) => p.length >= 40) ?? paragraphs[0]
  if (!text) return null
  return {
    kind: last.kind,
    date: last.date,
    text: text.length > 200 ? `${text.slice(0, 200)}…` : text,
  }
}

export const slugify = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
