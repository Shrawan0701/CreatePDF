import JSZip from 'jszip'
import { richHtmlToPdf } from './richPdf'

const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const relationshipNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const pageBreak = '\u0000PAGE_BREAK\u0000'
const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
const wordAttribute = (element, name) => element?.getAttributeNS(wordNamespace, name) || element?.getAttribute(`w:${name}`) || ''
const descendant = (element, name) => element.getElementsByTagNameNS('*', name)[0]

export async function wordToPdf(file, progress = () => {}) {
  const zip = await JSZip.loadAsync(file)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) throw new Error('The DOCX document is missing its main content.')
  const document = new DOMParser().parseFromString(documentXml, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error('The DOCX content contains invalid XML.')
  const relationshipsXml = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const relationshipsDocument = new DOMParser().parseFromString(relationshipsXml || '<Relationships/>', 'application/xml')
  const relationships = new Map([...relationshipsDocument.getElementsByTagNameNS('*', 'Relationship')].map((entry) => [entry.getAttribute('Id'), { target: entry.getAttribute('Target'), external: entry.getAttribute('TargetMode') === 'External' }]))

  const imageHtml = async (run) => {
    const image = descendant(run, 'blip') || descendant(run, 'imagedata')
    const relationId = image?.getAttributeNS(relationshipNamespace, 'embed') || image?.getAttributeNS(relationshipNamespace, 'id')
    const relationship = relationships.get(relationId)
    if (!relationship || relationship.external) return ''
    const url = new URL(relationship.target, 'https://docx.local/word/document.xml')
    if (url.origin !== 'https://docx.local') return ''
    const path = decodeURIComponent(url.pathname.slice(1))
    const imageFile = zip.file(path)
    const mime = /\.png$/i.test(path) ? 'png' : /\.jpe?g$/i.test(path) ? 'jpeg' : null
    if (!imageFile || !mime) return ''
    const extent = descendant(run, 'extent')
    const width = Number(extent?.getAttribute('cx') || 0) / 12700
    const height = Number(extent?.getAttribute('cy') || 0) / 12700
    return `<img src="data:image/${mime};base64,${await imageFile.async('base64')}"${width > 0 && height > 0 ? ` width="${width}" height="${height}"` : ''}/>`
  }

  const renderRun = async (run) => {
    let html = ''
    for (const child of run.children) {
      if (child.localName === 't') html += escapeText(child.textContent)
      else if (child.localName === 'tab') html += '    '
      else if (child.localName === 'br') html += wordAttribute(child, 'type') === 'page' ? pageBreak : '<br/>'
      else if (child.localName === 'lastRenderedPageBreak') html += pageBreak
      else if (child.localName === 'drawing' || child.localName === 'pict') html += await imageHtml(child)
    }
    const properties = [...run.children].find((child) => child.localName === 'rPr')
    const bold = properties && descendant(properties, 'b')
    const italic = properties && descendant(properties, 'i')
    return html.split(pageBreak).map((part) => `${bold && !['0', 'false'].includes(wordAttribute(bold, 'val')) ? '<strong>' : ''}${italic && !['0', 'false'].includes(wordAttribute(italic, 'val')) ? '<em>' : ''}${part}${italic && !['0', 'false'].includes(wordAttribute(italic, 'val')) ? '</em>' : ''}${bold && !['0', 'false'].includes(wordAttribute(bold, 'val')) ? '</strong>' : ''}`).join(pageBreak)
  }

  const renderParagraph = async (paragraph) => {
    const properties = [...paragraph.children].find((child) => child.localName === 'pPr')
    const style = properties && wordAttribute(descendant(properties, 'pStyle'), 'val')
    const heading = style?.match(/Heading([1-6])/i)
    const tag = heading ? `h${heading[1]}` : style === 'Title' ? 'h1' : 'p'
    const alignment = properties && wordAttribute(descendant(properties, 'jc'), 'val')
    const fontSize = Number(wordAttribute(descendant(paragraph, 'sz'), 'val')) / 2
    let html = ''
    for (const child of paragraph.children) {
      if (child.localName === 'r') html += await renderRun(child)
      else if (child.localName === 'hyperlink') {
        const relation = relationships.get(child.getAttributeNS(relationshipNamespace, 'id'))
        const content = (await Promise.all([...child.getElementsByTagNameNS('*', 'r')].map(renderRun))).join('')
        html += relation?.external && /^(https?:|mailto:|tel:)/i.test(relation.target) ? `<a href="${escapeText(relation.target)}">${content}</a>` : content
      }
    }
    const before = properties && descendant(properties, 'pageBreakBefore')
    const prefix = before && !['0', 'false'].includes(wordAttribute(before, 'val')) ? '<div data-page-break="before"></div>' : ''
    const attributes = `${['center', 'right'].includes(alignment) ? ` data-align="${alignment}"` : ''}${fontSize >= 6 && fontSize <= 72 ? ` data-font-size="${fontSize}"` : ''}`
    return prefix + html.split(pageBreak).map((part) => `<${tag}${attributes}>${part}</${tag}>`).join('<div data-page-break="before"></div>')
  }

  const renderTable = async (table) => {
    const rows = []
    for (const row of [...table.children].filter((child) => child.localName === 'tr')) {
      const cells = []
      for (const cell of [...row.children].filter((child) => child.localName === 'tc')) cells.push(`<td>${(await Promise.all([...cell.children].filter((child) => child.localName === 'p').map(renderParagraph))).join('')}</td>`)
      rows.push(`<tr>${cells.join('')}</tr>`)
    }
    return `<table>${rows.join('')}</table>`
  }

  const body = document.getElementsByTagNameNS('*', 'body')[0]
  if (!body) throw new Error('The DOCX document has no content body.')
  const blocks = []
  for (const block of body.children) {
    if (block.localName === 'p') blocks.push(await renderParagraph(block))
    else if (block.localName === 'tbl') blocks.push(await renderTable(block))
  }
  progress(70)
  const section = document.getElementsByTagNameNS('*', 'sectPr')[0]
  const size = section && descendant(section, 'pgSz')
  const width = Number(wordAttribute(size, 'w')) / 20
  const height = Number(wordAttribute(size, 'h')) / 20
  const margins = section && descendant(section, 'pgMar')
  const margin = Number(wordAttribute(margins, 'left')) / 20 || 46
  return richHtmlToPdf(blocks.join(''), { pageSize: Math.abs(Math.min(width, height) - 612) < 5 ? 'Letter' : 'A4', orientation: width > height ? 'landscape' : 'portrait', margin })
}
