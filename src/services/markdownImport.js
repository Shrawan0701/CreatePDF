import { marked } from 'marked'
import { sanitizeDocumentHtml } from './richPdf'

const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function markdownToHtml(text, format = 'markdown') {
  if (format === 'code') return `<pre><code>${escapeHtml(text)}</code></pre>`
  const html = marked.parse(text, { gfm: true, breaks: false, async: false })
  const document = new DOMParser().parseFromString(html, 'text/html')
  for (const cell of document.querySelectorAll('th,td')) {
    if (['left', 'center', 'right'].includes(cell.style.textAlign)) cell.dataset.align = cell.style.textAlign
  }
  for (const checkbox of document.querySelectorAll('input[type="checkbox"]')) checkbox.replaceWith(document.createTextNode(checkbox.checked ? '[x] ' : '[ ] '))
  return sanitizeDocumentHtml(document.body.innerHTML)
}
