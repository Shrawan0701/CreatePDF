import JSZip from 'jszip'
import { getPdfjsLib, loadPdfBytes } from './pdfEngine'
import { htmlEscape, htmlReadingContent, htmlTextItems, linksForPage } from './pdfToHtml'
import { wordPageSelection } from './pdfWordLayout'
import { extractPdfImages } from './pdfImages'

const xml = htmlEscape
const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) && value !== '' ? Math.max(min, Math.min(max, Number(value))) : fallback
const check = signal => { if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError') }
const blobData = blob => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read an embedded image.')); reader.readAsDataURL(blob) })

export function epubSettings(options = {}, filename = 'document.pdf') {
  const language = String(options.language || 'en').trim()
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new Error('Enter a language code such as en, hi, or en-IN.')
  return { title: options.title?.trim() || filename.replace(/\.pdf$/i, '') || 'Untitled book', author: options.author?.trim() || '', description: options.description?.trim() || '', language,
    readingLayout: options.readingLayout === 'pages' ? 'pages' : 'reflow', fontFamily: options.fontFamily === 'sans-serif' ? 'sans-serif' : 'serif', fontSize: bounded(options.fontSize, 100, 80, 160), lineHeight: bounded(options.lineHeight, 1.6, 1.2, 2),
    includeImages: options.includeImages !== false, includeLinks: options.includeLinks !== false, includeCover: options.includeCover !== false, scale: [1, 1.5, 2, 3].includes(Number(options.scale)) ? Number(options.scale) : 2 }
}

export function epubStyles(settings) {
  return `html{color-scheme:light dark}body{font-family:${settings.fontFamily};font-size:${settings.fontSize}%;line-height:${settings.lineHeight};margin:6%;overflow-wrap:break-word}p{margin:.65em 0}h1,h2,h3{line-height:1.3;break-after:avoid}h1{font-size:1.8em}h2{font-size:1.4em;margin:1.2em 0 .6em}a{color:#157c68}img{max-width:100%;height:auto}figure{margin:1.5em 0;text-align:center}figure img{display:block;margin:auto}.table-scroll{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.9em}td,th{padding:.5em;border:1px solid #9daba4;text-align:start;vertical-align:top}th{font-weight:bold}ul,ol{padding-left:1.5em}ul+ul{margin-top:-.6em}.source-page{font-size:.65em;letter-spacing:.12em;text-transform:uppercase;color:#697970;margin-bottom:2em}.scan-note{font-size:.8em;color:#697970}.page-break{display:block;height:0;overflow:hidden}.page-links{font-size:.8em;margin-top:2em}.page-links a{display:block;margin:.4em 0}.cover-body{margin:0;padding:0;text-align:center}.cover-body img{width:100%;height:auto}.fixed-body{margin:0;padding:0;overflow:hidden}.fixed-page{position:relative;margin:0;padding:0}.fixed-image{position:absolute;inset:0;width:100%;height:100%;max-width:none}.fixed-links{position:absolute;inset:0;pointer-events:none}.fixed-links a{position:absolute;display:block;pointer-events:auto}.fixed-links a:focus{outline:2px solid #157c68}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}nav ol{padding-left:1.5em}nav li{margin:.6em 0}`
}

export function epubXhtml(title, body, settings, { width, height, className = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(settings.language)}" xml:lang="${xml(settings.language)}"><head><title>${xml(title)}</title>${width && height ? `<meta name="viewport" content="width=${width},height=${height}"/>` : ''}<link href="styles.css" rel="stylesheet" type="text/css"/></head><body${className ? ` class="${className}"` : ''}>${body}</body></html>`
}

export function epubPackage(chapters, assets, settings, { identifier, modified, cover = false } = {}) {
  const fixed = settings.readingLayout === 'pages'
  return `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" prefix="rendition: http://www.idpf.org/vocab/rendition/#"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${xml(identifier)}</dc:identifier><dc:title>${xml(settings.title)}</dc:title><dc:language>${xml(settings.language)}</dc:language>${settings.author ? `<dc:creator>${xml(settings.author)}</dc:creator>` : ''}${settings.description ? `<dc:description>${xml(settings.description)}</dc:description>` : ''}<meta property="dcterms:modified">${xml(modified)}</meta><meta property="rendition:layout">${fixed ? 'pre-paginated' : 'reflowable'}</meta>${fixed ? '<meta property="rendition:orientation">auto</meta><meta property="rendition:spread">none</meta>' : ''}${cover ? '<meta name="cover" content="cover-image"/>' : ''}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="styles.css" media-type="text/css"/>${cover ? '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>' : ''}${chapters.map(chapter => `<item id="${chapter.id}" href="${chapter.filename}" media-type="application/xhtml+xml"/>`).join('')}${assets.map(asset => `<item id="${asset.id}" href="${asset.path}" media-type="image/png"${asset.cover ? ' properties="cover-image"' : ''}/>`).join('')}</manifest><spine toc="ncx"${/^(ar|fa|he|ur)(?:-|$)/i.test(settings.language) ? ' page-progression-direction="rtl"' : ''}>${cover ? '<itemref idref="cover"/>' : ''}<itemref idref="nav"${fixed ? ' properties="rendition:layout-reflowable"' : ''}/>${chapters.map(chapter => `<itemref idref="${chapter.id}"/>`).join('')}</spine></package>`
}

function wrapText(context, text, maxWidth) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (context.measureText((line ? line + ' ' : '') + word).width <= maxWidth) { line += (line ? ' ' : '') + word; continue }
    if (line) { lines.push(line); line = '' }
    for (const character of word) {
      if (line && context.measureText(line + character).width > maxWidth) { lines.push(line); line = '' }
      line += character
    }
  }
  if (line) lines.push(line)
  return lines
}

async function bookCover(settings, file) {
  const canvas = document.createElement('canvas')
  try {
    if (file) {
      if (file.size > 20 * 1024 * 1024) throw new Error('Choose a cover image smaller than 20 MB.')
      let bitmap
      try { bitmap = await createImageBitmap(file) } catch { throw new Error('Could not read the cover. Choose a valid JPG or PNG image.') }
      try {
        const scale = Math.min(1, 1600 / bitmap.width, 2400 / bitmap.height)
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      } finally { bitmap.close() }
    } else {
      canvas.width = 1000; canvas.height = 1400
      const context = canvas.getContext('2d')
      context.fillStyle = '#0c5147'; context.fillRect(0, 0, 1000, 1400)
      context.fillStyle = '#135f53'; context.fillRect(740, 0, 260, 1400)
      context.strokeStyle = '#82b7a7'; context.lineWidth = 2; context.strokeRect(52, 52, 896, 1296)
      context.fillStyle = '#bcdbcd'; context.font = '24px Arial'; context.fillText('A PERSONAL EDITION', 105, 170)
      let size = 76, lines
      do { context.font = `bold ${size}px Georgia`; lines = wrapText(context, settings.title, 760); if (lines.length * size * 1.2 <= 720) break; size -= 4 } while (size > 16)
      context.fillStyle = '#ffffff'; lines.forEach((line, index) => context.fillText(line, 105, 340 + index * size * 1.2))
      context.fillStyle = '#bcdbcd'; context.fillRect(105, 1125, 100, 3)
      context.font = '30px Arial'; wrapText(context, settings.author || 'Collected pages', 760).slice(0, 2).forEach((line, index) => context.fillText(line, 105, 1200 + index * 40))
    }
    return { id: 'cover-image', path: 'cover.png', cover: true, data: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally { canvas.width = canvas.height = 0 }
}

export async function pdfToEpub(file, options = {}, progress = () => {}) {
  const settings = epubSettings(options, file.name)
  const signal = options.signal
  check(signal)
  const pdfjs = await getPdfjsLib()
  const bytes = await loadPdfBytes(file)
  check(signal)
  const task = pdfjs.getDocument({ data: bytes, password: options.password || undefined })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const chapters = [], assets = [], warnings = []
  let render, cover
  try {
    const pdf = await task.promise
    const pages = wordPageSelection(options.pageRange || '', pdf.numPages), included = new Set(pages)
    for (const [index, number] of pages.entries()) {
      check(signal); progress(Math.round(index / pages.length * 65), `Preparing page ${number} of ${pdf.numPages}`)
      const page = await pdf.getPage(number)
      let canvas
      try {
        const viewport = page.getViewport({ scale: 1 })
        // Reading order should not change when the PDF page is displayed rotated.
        const textViewport = page.getViewport({ scale: 1, rotation: 0 })
        // Resolve fonts for weight and emphasis without rasterizing every text page.
        await page.getOperatorList()
        const content = await page.getTextContent()
        const items = htmlTextItems(content, textViewport, pdfjs, page)
        const isImage = !items.length || settings.readingLayout === 'pages'
        const links = settings.includeLinks ? await linksForPage(page, pdf, isImage ? viewport : textViewport, included) : []
        for (const link of links) {
          if (link.href.startsWith('#page-')) link.href = `page-${Number(link.href.slice(6))}.xhtml${link.href}`
        }
        const largestSize = items.reduce((largest, item) => Math.max(largest, item.size), 1)
        const label = items.filter(item => item.size >= largestSize * .9).slice(0, 4).map(item => item.text).join(' ').trim().slice(0, 100)
        const chapter = { id: `page-${number}`, number, filename: `page-${number}.xhtml`, label: `Page ${number}${label ? `: ${label}` : ''}`, items, links, width: viewport.width, height: viewport.height, isImage, scanned: !items.length, images: [] }
        if (isImage) {
          const scale = Math.min(settings.scale, Math.sqrt(24_000_000 / (viewport.width * viewport.height)), 16000 / Math.max(viewport.width, viewport.height))
          if (scale < settings.scale) warnings.push(`Page ${number}: image resolution was reduced to fit browser limits.`)
          const output = page.getViewport({ scale })
          canvas = document.createElement('canvas'); canvas.width = Math.ceil(output.width); canvas.height = Math.ceil(output.height)
          render = page.render({ canvasContext: canvas.getContext('2d'), viewport: output }); await render.promise
          const asset = { id: `image-${number}`, path: `page-${number}.png`, data: canvas.toDataURL('image/png') }
          assets.push(asset); chapter.image = asset
        }
        chapters.push(chapter)
      } finally { if (canvas) canvas.width = canvas.height = 0; render = null; page.cleanup() }
    }
    if (settings.readingLayout === 'reflow' && settings.includeImages && chapters.some(chapter => !chapter.isImage)) {
      const extracted = await extractPdfImages(file, { signal, pageRange: options.pageRange, password: options.password }, (value, label) => progress(65 + Math.round(value * .18), label))
      warnings.push(...extracted.warnings)
      const byHash = new Map(), seen = new Set()
      for (const image of extracted.images) {
        check(signal)
        const chapter = chapters.find(chapter => chapter.number === image.pageNumber)
        const key = `${image.pageNumber}-${image.hash}`
        if (!chapter || chapter.isImage || (image.width === 1 && image.height === 1) || seen.has(key)) continue
        seen.add(key)
        let asset = byHash.get(image.hash)
        if (!asset) {
          asset = { id: `embedded-${byHash.size + 1}`, path: `images/${image.name}`, data: await blobData(image.blob), width: image.width, height: image.height }
          byHash.set(image.hash, asset); assets.push(asset)
        }
        chapter.images.push(asset)
      }
    }
    check(signal); progress(85, 'Building your book')
    if (settings.includeCover) { cover = await bookCover(settings, options.cover); assets.push(cover) }
    check(signal)
    for (const chapter of chapters) {
      const marker = `<span class="page-break" epub:type="pagebreak" role="doc-pagebreak" id="source-page-${chapter.number}" aria-label="${chapter.number}"></span>`
      let body
      if (settings.readingLayout === 'pages') {
        body = `<section id="${chapter.id}" class="fixed-page" style="width:${chapter.width}px;height:${chapter.height}px">${marker}<img class="fixed-image" src="${chapter.image.path}" alt="PDF page ${chapter.number}"/><div class="fixed-links">${chapter.links.map(link => `<a href="${xml(link.href)}" aria-label="${xml(link.href)}" style="left:${link.x}px;top:${link.y}px;width:${link.width}px;height:${link.height}px"></a>`).join('')}</div></section>`
      } else if (chapter.scanned) body = `<section id="${chapter.id}">${marker}<p class="source-page">Page ${chapter.number}</p><p class="scan-note">Scanned page preserved as an image. Text recognition has not been applied.</p><img src="${chapter.image.path}" alt="Scanned PDF page ${chapter.number}"/></section>`
      else body = `<section id="${chapter.id}">${marker}<p class="source-page">Page ${chapter.number}</p>${htmlReadingContent(chapter.items, chapter.links)}${chapter.images.map(image => `<figure><img src="${image.path}" alt="Embedded image from page ${chapter.number}" width="${image.width}" height="${image.height}"/></figure>`).join('')}${chapter.links.length ? `<nav class="page-links" aria-label="Links on page ${chapter.number}"><p>Page links</p>${chapter.links.map(link => `<a href="${xml(link.href)}">${xml(link.href)}</a>`).join('')}</nav>` : ''}</section>`
      chapter.xhtml = epubXhtml(chapter.label, body, settings, settings.readingLayout === 'pages' ? { width: chapter.width, height: chapter.height, className: 'fixed-body' } : {})
    }
    const coverXhtml = cover ? epubXhtml(settings.title, `<section epub:type="cover"><img src="cover.png" alt="${xml(settings.title)}${settings.author ? ` by ${xml(settings.author)}` : ''}"/></section>`, settings, { width: cover.width, height: cover.height, className: 'cover-body' }) : ''
    const navXhtml = epubXhtml('Contents', `<nav epub:type="toc" id="toc" role="doc-toc"><h1>Contents</h1><ol>${cover ? '<li><a href="cover.xhtml">Cover</a></li>' : ''}${chapters.map(chapter => `<li><a href="${chapter.filename}">${xml(chapter.label)}</a></li>`).join('')}</ol></nav><nav epub:type="page-list" hidden="hidden"><h2>Original PDF pages</h2><ol>${chapters.map(chapter => `<li><a href="${chapter.filename}#source-page-${chapter.number}">${chapter.number}</a></li>`).join('')}</ol></nav>`, settings)
    const identifier = `urn:uuid:${crypto.randomUUID()}`
    const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
    zip.file('EPUB/styles.css', epubStyles(settings))
    zip.file('EPUB/nav.xhtml', navXhtml)
    if (cover) zip.file('EPUB/cover.xhtml', coverXhtml)
    for (const chapter of chapters) zip.file(`EPUB/${chapter.filename}`, chapter.xhtml)
    for (const asset of assets) zip.file(`EPUB/${asset.path}`, asset.data.split(',')[1], { base64: true })
    zip.file('EPUB/content.opf', epubPackage(chapters, assets, settings, { identifier, modified, cover: !!cover }))
    const ncxEntries = [...(cover ? [{ id: 'cover', filename: 'cover.xhtml', label: 'Cover' }] : []), ...chapters]
    zip.file('EPUB/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${xml(settings.language)}"><head><meta name="dtb:uid" content="${identifier}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>${xml(settings.title)}</text></docTitle><navMap>${ncxEntries.map((chapter, index) => `<navPoint id="${chapter.id}" playOrder="${index + 1}"><navLabel><text>${xml(chapter.label)}</text></navLabel><content src="${chapter.filename}"/></navPoint>`).join('')}</navMap></ncx>`)
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' }, meta => progress(90 + Math.round(meta.percent * .1), 'Packaging EPUB'))
    check(signal)
    return { blob, extension: 'epub', settings, chapters, assets, coverXhtml, navXhtml, pages: chapters.length, sourcePages: pdf.numPages, scannedPages: chapters.filter(chapter => chapter.scanned).length, images: assets.length, links: chapters.reduce((count, chapter) => count + chapter.links.length, 0), warnings }
  } catch (error) {
    check(signal)
    if (error.name === 'PasswordException') throw new Error('Enter the correct PDF opening password and try again.')
    if (error.name === 'InvalidPDFException') throw new Error('Could not read this PDF. Choose a valid PDF document.')
    throw error
  } finally { render?.cancel(); signal?.removeEventListener('abort', abort); await task.destroy() }
}

export function epubPreviewDocument(result, selected = 'cover', theme = 'paper') {
  const chapter = result.chapters.find(chapter => chapter.id === selected)
  const source = selected === 'cover' && result.coverXhtml ? result.coverXhtml : selected === 'contents' ? result.navXhtml : chapter?.xhtml || result.chapters[0].xhtml
  const colors = theme === 'night' ? ['#17231e', '#e7ece7'] : theme === 'sepia' ? ['#f4ead4', '#473e30'] : ['#ffffff', '#23352b']
  const assets = new Map(result.assets.map(asset => [asset.path, asset.data]))
  const body = source.replace(/^<\?xml[^>]*>\s*/, '').replace(/<link [^>]*href="styles\.css"[^>]*\/>/, `<style>${epubStyles(result.settings)}html{color-scheme:light}body{background:${colors[0]};color:${colors[1]}}.cover-body img{display:block;width:auto;height:auto;max-width:100%;max-height:95vh;margin:auto}.fixed-body{overflow:auto}.fixed-page{position:absolute;transform-origin:top left}</style>`).replace(/src="([^"]+)"/g, (match, path) => assets.has(path) ? `src="${assets.get(path)}"` : match)
  // Navigation stays in the parent reader. No PDF-provided code runs inside the frame.
  const script = `<script>(()=>{const fixed=document.querySelector('.fixed-page');const fit=()=>{if(!fixed)return;const width=parseFloat(fixed.style.width);fixed.style.transform='scale('+Math.min(1,innerWidth/width)+')';document.body.style.height=parseFloat(fixed.style.height)*Math.min(1,innerWidth/width)+'px'};fit();addEventListener('resize',fit);document.addEventListener('click',event=>{const anchor=event.target.closest('a');if(!anchor)return;const href=anchor.getAttribute('href');if(/^(page-\\d+\\.xhtml|cover\\.xhtml)/.test(href)){event.preventDefault();parent.postMessage({type:'epub-preview-navigation',href},'*')}else if(/^(https?:|mailto:|tel:)/.test(href)){anchor.target='_blank';anchor.rel='noopener noreferrer'}})})();</script>`
  return body.replace('</body>', `${script}</body>`)
}
