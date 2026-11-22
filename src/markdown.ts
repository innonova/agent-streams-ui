import DOMPurify from 'dompurify'
import { marked } from 'marked'

/** Markdown to HTML that is safe to put on the page: an agent's text is not ours. */
export const renderMarkdown = (text: string): string =>
  DOMPurify.sanitize(marked.parse(text, { async: false }) as string)
