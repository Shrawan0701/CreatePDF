import { marked } from 'marked'
import { sanitizeDocumentHtml } from './richPdf'
import { isResumeColor } from './resumeModel'

export function resumeEditorHtml(value) {
  return String(value || '').split(/\r?\n/).map(line => `<p>${sanitizeDocumentHtml(marked.parseInline(line, { async: false })) || '<br>'}</p>`).join('')
}

export function readResumeEditor(editor) {
  const clone = editor.cloneNode(true)
  for (const element of clone.querySelectorAll('font,span')) {
    const color = element.getAttribute('color') || element.getAttribute('data-resume-color') || element.style.color
    if (isResumeColor(color)) {
      const span = document.createElement('span')
      span.dataset.resumeColor = color.toLowerCase()
      span.innerHTML = element.innerHTML
      element.replaceWith(span)
    }
  }
  const lines = []
  let inline = ''
  for (const node of clone.childNodes) {
    if (['p', 'div', 'li'].includes(node.localName)) {
      if (inline) { lines.push(inline); inline = '' }
      lines.push(node.innerHTML)
    } else inline += node.nodeType === 3 ? node.textContent.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') : node.outerHTML
  }
  if (inline) lines.push(inline)
  return lines.map(line => line === '<br>' ? '' : line).join('\n').replace(/\n+$/, '')
}

export function paintResumeEditor(editor) {
  for (const element of editor.querySelectorAll('[data-resume-color]')) {
    if (isResumeColor(element.dataset.resumeColor)) element.style.color = element.dataset.resumeColor
  }
}
