import type { AgentCounts, AgentState } from '@/api/types'
import type { ProjectRow } from '@/stores/projects'

/**
 * The tree's top level. Streams and projects are listed under the group
 * they were put in, so that many of them are not one flat list; a group
 * is a label on a stream and nothing else. Named groups come first, by
 * name, and what nobody has put anywhere comes last, without a heading
 * when there are no groups at all (then the tree is the flat list it
 * would have been).
 */
export interface TreeGroup {
  /** The label; null for what is in no group. */
  name: string | null
  rows: ProjectRow[]
}

export function groupRows(rows: ProjectRow[]): TreeGroup[] {
  const named = new Map<string, ProjectRow[]>()
  const loose: ProjectRow[] = []
  for (const r of rows) {
    const g = r.project.group?.trim()
    if (g) named.set(g, [...(named.get(g) ?? []), r])
    else loose.push(r)
  }
  const byName = (a: ProjectRow, b: ProjectRow) => a.project.name.localeCompare(b.project.name)
  const groups: TreeGroup[] = [...named.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, list]) => ({ name, rows: list.sort(byName) }))
  if (loose.length) groups.push({ name: null, rows: loose.sort(byName) })
  return groups
}

/** The groups there are, for offering them when one is being chosen. */
export function groupNames(rows: ProjectRow[]): string[] {
  return [
    ...new Set(rows.map((r) => r.project.group?.trim()).filter((g): g is string => !!g)),
  ].sort((a, b) => a.localeCompare(b))
}

/**
 * What a folded row says about what is inside it: how many agents are at
 * work, how many wait for a person (for input, for a permission, or with
 * a question open in their chat), how many failed. Nothing else is worth
 * a mark on a row that is folded: an idle agent needs nobody.
 */
export interface Rollup {
  working: number
  waiting: number
  failed: number
}

const NEEDS_A_PERSON: AgentState[] = ['waiting-input', 'waiting-permission']

export function rollup(counts: AgentCounts | undefined, questions = 0): Rollup {
  return {
    working: counts?.working ?? 0,
    waiting: NEEDS_A_PERSON.reduce((n, s) => n + (counts?.[s] ?? 0), 0) + questions,
    failed: counts?.error ?? 0,
  }
}

export function addRollups(list: Rollup[]): Rollup {
  return list.reduce(
    (sum, r) => ({
      working: sum.working + r.working,
      waiting: sum.waiting + r.waiting,
      failed: sum.failed + r.failed,
    }),
    { working: 0, waiting: 0, failed: 0 },
  )
}

/**
 * Finding something in a long tree: a stream is kept when its own name
 * or its group's matches, or when one of its agents' names does (the
 * agents that are loaded: a folded stream's are not, and its name is
 * what it is found by).
 */
export function matches(query: string, row: ProjectRow, agentNames: string[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [row.project.name, row.project.group ?? '', ...agentNames].some((s) =>
    s.toLowerCase().includes(q),
  )
}
