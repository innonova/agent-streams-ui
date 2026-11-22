import { describe, expect, it } from 'vitest'
import { renderDocument, renderMarkdown } from './markdown'

describe('markdown', () => {
  it('renders what an agent wrote without running any of it', () => {
    const html = renderMarkdown('**bold** <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it("shows a file's frontmatter as fields, not as a heading", () => {
    const html = renderDocument(
      '---\ntitle: sweep\nstatus: review\n---\n\n## Purpose\n\nEvery corner.\n',
    )
    expect(html).toMatch(/<pre><code[^>]*>title: sweep\nstatus: review\n<\/code><\/pre>/)
    expect(html).toContain('<h2>Purpose</h2>')
    expect(html).not.toMatch(/<h2>title/)
    // a file without any is rendered as it is, a rule in it included
    expect(renderDocument('# Title\n\n---\n\ntext')).toContain('<hr>')
  })
})
