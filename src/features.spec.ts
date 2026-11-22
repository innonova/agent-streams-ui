import { describe, expect, it } from 'vitest'
import type { Feature } from '@/api/types'
import { latest, slugify } from './features'

const feature = (body: string, status: Feature['status'] = 'review') =>
  ({
    slug: 'x',
    title: 'x',
    status,
    priority: 1,
    dependsOn: [],
    body,
    repo: '',
    path: '',
    mtime: 0,
    range: null,
  }) as Feature

describe('a feature row', () => {
  it('says where the feature stands: its latest report or response, first real paragraph', () => {
    const f = feature(
      [
        'Do the thing.',
        '',
        '## Report (2026-11-20)',
        '',
        'An early report that is long enough to be the paragraph shown.',
        '',
        '## Response (2026-11-21)',
        '',
        '### Heading',
        '',
        'ok',
        '',
        '- The `second` *paragraph* is the first one long enough to say something.',
      ].join('\n'),
    )
    expect(latest(f)).toEqual({
      kind: 'response',
      date: '2026-11-21',
      // a heading and a two-letter line are not what the report says
      text: 'The second paragraph is the first one long enough to say something.',
    })
    expect(latest(feature('## Report (2026-11-22)\n\n' + 'word '.repeat(80)))!.text).toMatch(/…$/)
  })

  it('says nothing for a feature not reported on, or done', () => {
    expect(latest(feature('Just the spec.'))).toBeNull()
    expect(
      latest(feature('## Report (2026-11-22)\n\nAll of it works as asked.', 'done')),
    ).toBeNull()
  })

  it('names a file after a title', () => {
    expect(slugify('  Sweep the floor, twice! ')).toBe('sweep-the-floor-twice')
  })
})
