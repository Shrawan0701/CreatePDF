import JSZip from 'jszip'
import { sanitizeDocumentHtml } from './richPdf'

const escapeText = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function parseXml(content, name) {
  const document = new DOMParser().parseFromString(content, 'application/xml')
  if (document.getElementsByTagName('parsererror').length) throw new Error(`${name} contains invalid XML.`)
  return document
}

function resolveEntry(path, base) {
  const url = new URL(path, `https://ebook.local/${base}`)
  if (url.origin !== 'https://ebook.local') return null
  return decodeURIComponent(url.pathname.slice(1))
}

export async function importEbook(file) {
  if (!/\.(epub|txt)$/i.test(file.name)) throw new Error('Choose an EPUB or TXT file.')
  if (!file.name.toLowerCase().endsWith('.epub')) {
    const text = await file.text()
    if (!text.trim()) throw new Error('This text file is empty.')
    return { title: file.name.replace(/\.[^.]+$/, ''), author: '', contents: [], chapters: 1, markup: text.split(/\r?\n\s*\r?\n/).map((paragraph) => `<p>${escapeText(paragraph).replace(/\r?\n/g, '<br/>')}</p>`).join('') }
  }
  const zip = await JSZip.loadAsync(file)
  const uncompressed = Object.values(zip.files).reduce((size, entry) => size + (entry._data?.uncompressedSize || 0), 0)
  if (uncompressed > 200 * 1024 * 1024) throw new Error('This eBook exceeds the 200 MB expanded-content limit.')
  const containerXml = await zip.file('META-INF/container.xml')?.async('string')
  if (!containerXml) throw new Error('The EPUB is missing its container file.')
  const container = parseXml(containerXml, 'EPUB container')
  const packagePath = container.getElementsByTagNameNS('*', 'rootfile')[0]?.getAttribute('full-path')
  const packageXml = packagePath && await zip.file(packagePath)?.async('string')
  if (!packageXml) throw new Error('The EPUB package could not be found.')
  const packageDocument = parseXml(packageXml, 'EPUB package')
  const manifest = new Map([...packageDocument.getElementsByTagNameNS('*', 'item')].map((item) => [item.getAttribute('id'), item.getAttribute('href')]))
  const title = packageDocument.getElementsByTagNameNS('*', 'title')[0]?.textContent || file.name.replace(/\.epub$/i, '')
  const author = packageDocument.getElementsByTagNameNS('*', 'creator')[0]?.textContent || ''
  const chapters = []
  const contents = []
  for (const item of packageDocument.getElementsByTagNameNS('*', 'itemref')) {
    if (item.getAttribute('linear') === 'no') continue
    const href = manifest.get(item.getAttribute('idref'))
    const chapterPath = href && resolveEntry(href, packagePath)
    const chapterXml = chapterPath && await zip.file(chapterPath)?.async('string')
    if (!chapterXml) throw new Error('An EPUB chapter is missing from the archive.')
    const chapter = parseXml(chapterXml, 'EPUB chapter')
    const body = chapter.getElementsByTagNameNS('*', 'body')[0]
    if (!body) continue
    for (const image of body.getElementsByTagNameNS('*', 'img')) {
      const source = image.getAttribute('src') || ''
      if (/^data:image\/(png|jpe?g);base64,/i.test(source)) continue
      const imagePath = resolveEntry(source, chapterPath)
      const imageFile = imagePath && zip.file(imagePath)
      const type = /\.png$/i.test(imagePath || '') ? 'png' : /\.jpe?g$/i.test(imagePath || '') ? 'jpeg' : null
      if (imageFile && type) image.setAttribute('src', `data:image/${type};base64,${await imageFile.async('base64')}`)
      else image.removeAttribute('src')
    }
    const markup = sanitizeDocumentHtml(body.innerHTML)
    if (markup.trim()) {
      const heading = [...body.getElementsByTagNameNS('*', '*')].find(element => /^h[1-3]$/.test(element.localName))
      contents.push(heading?.textContent?.trim() || `Chapter ${chapters.length + 1}`)
      chapters.push(`<section${chapters.length ? ' data-page-break="before"' : ''}>${markup}</section>`)
    }
  }
  if (!chapters.length) throw new Error('No readable chapters were found in the EPUB.')
  return { title, author, contents, chapters: chapters.length, markup: chapters.join('') }
}
