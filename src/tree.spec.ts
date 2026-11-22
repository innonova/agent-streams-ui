import { describe, expect, it } from 'vitest'
import type { AgentCounts } from '@/api/types'
import type { ProjectRow } from '@/stores/projects'
import { addRollups, groupNames, groupRows, matches, rollup } from './tree'

const counts = (c: Partial<AgentCounts> = {}): AgentCounts => ({
  starting: 0,
  idle: 0,
  working: 0,
  'waiting-input': 0,
  'waiting-permission': 0,
  error: 0,
  exited: 0,
  ...c,
})
const row = (name: string, group?: string | null, kind: 'project' | 'stream' = 'stream') =>
  ({
    project: { id: name, name, group, kind },
    agentCounts: counts(),
  }) as unknown as ProjectRow

describe('the tree', () => {
  it('lists streams and projects under their groups, the ungrouped last', () => {
    const groups = groupRows([
      row('zebra'),
      row('payments', 'mimiri'),
      row('estate', ' infra '),
      row('api', 'mimiri', 'project'),
      row('attic', ''),
    ])
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.project.name)])).toEqual([
      ['infra', ['estate']],
      ['mimiri', ['api', 'payments']],
      [null, ['attic', 'zebra']],
    ])
    expect(groupNames([row('a', 'x'), row('b', 'x'), row('c'), row('d', 'a')])).toEqual(['a', 'x'])
  })

  it('is one unnamed list when nothing is grouped', () => {
    const groups = groupRows([row('b'), row('a')])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.name).toBeNull()
    expect(groups[0]!.rows.map((r) => r.project.name)).toEqual(['a', 'b'])
    expect(groupRows([])).toEqual([])
  })

  it('says of a folded row only what needs someone or is under way', () => {
    expect(
      rollup(
        counts({ working: 2, idle: 5, 'waiting-input': 1, 'waiting-permission': 1, error: 1 }),
        3,
      ),
    ).toEqual({ working: 2, waiting: 5, failed: 1 })
    expect(rollup(undefined)).toEqual({ working: 0, waiting: 0, failed: 0 })
    expect(
      addRollups([
        { working: 1, waiting: 0, failed: 0 },
        { working: 0, waiting: 2, failed: 1 },
      ]),
    ).toEqual({ working: 1, waiting: 2, failed: 1 })
  })

  it('finds a stream by its name, its group or an agent in it', () => {
    const r = row('payments', 'Mimiri')
    expect(matches('', r, [])).toBe(true)
    expect(matches('PAY', r, [])).toBe(true)
    expect(matches('mimi', r, [])).toBe(true)
    expect(matches('opus', r, ['opus', 'helper'])).toBe(true)
    expect(matches('opus', r, [])).toBe(false)
  })
})
