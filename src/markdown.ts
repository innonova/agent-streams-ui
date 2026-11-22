import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** Markdown to HTML that is safe to put on the page: an agent's text is not ours. */
export const renderMarkdown = (text: string): string =>
  DOMPurify.sanitize(marked.parse(text, { async: false }) as string)

/**
 * A whole Markdown file, as it is on disk: the frontmatter some of them
 * begin with (a feature's title and status) is shown as what it is, a
 * block of fields, where a renderer would take its closing rule for the
 * underline of a heading and print the fields as one.
 */
export function renderDocument(text: string): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  return renderMarkdown(m ? `\`\`\`yaml\n${m[1]}\n\`\`\`\n\n${text.slice(m[0].length)}` : text)
}
