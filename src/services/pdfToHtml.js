import JSZip from 'jszip'
import { getPdfjsLib, loadPdfBytes } from './pdfEngine'
import { detectBorderlessWordTables, groupWordLines, wordLinkRectangle, wordPageSelection } from './pdfWordLayout'
import { extractPdfImages } from './pdfImages'

export const htmlEscape = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

export function htmlSafeLink(value) {
  try { const url = new URL(value); return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '' } catch { return '' }
}

function fontDetails(page, item, styles) {
  let font
  try { font = page.commonObjs.get(item.fontName) } catch { /* Use a browser font for the selectable text layer. */ }
  const name = font?.name || ''
  const fallback = styles[item.fontName]?.fontFamily || ''
  const family = /courier|mono/i.test(name + fallback) ? 'monospace' : /times|serif/i.test(name + fallback) && !/sans/i.test(name + fallback) ? 'serif' : 'sans-serif'
  return { family, bold: !!(font?.bold || /bold|black|heavy/i.test(name)), italic: !!(font?.italic || /italic|oblique/i.test(name)) }
}

export function htmlTextItems(content, viewport, pdfjs, page) {
  return content.items.filter(item => item.str?.trim()).map(item => {
    const matrix = pdfjs.Util.transform(viewport.transform, item.transform)
    const style = content.styles[item.fontName] || {}
    const size = Math.max(1, Math.hypot(matrix[2], matrix[3]))
    const angle = Math.atan2(matrix[1], matrix[0]) + (style.vertical ? Math.PI / 2 : 0)
    const ascent = size * (style.ascent ?? (style.descent ? 1 + style.descent : .8))
    return { text: item.str, x: matrix[4], y: matrix[5], left: matrix[4] + ascent * Math.sin(angle), top: matrix[5] - ascent * Math.cos(angle), angle, size, width: (style.vertical ? item.height : item.width) * (viewport.scale || 1) * (viewport.userUnit || 1), dir: item.dir === 'rtl' ? 'rtl' : 'ltr', ...fontDetails(page, item, content.styles) }
  })
}

function textLayer(items) {
  const context = document.createElement('canvas').getContext('2d')
  return items.map(item => {
    context.font = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${item.size}px ${item.family}`
    const measured = context.measureText(item.text).width
    const scale = measured > 0 && item.width > 0 ? item.width / measured : 1
    return `<span dir="${item.dir}" style="left:${item.left}px;top:${item.top}px;font:${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${item.size}px ${item.family};transform:rotate(${item.angle}rad) scaleX(${scale})">${htmlEscape(item.text)}</span>`
  }).join('')
}

export async function linksForPage(page, pdf, viewport, included) {
  const links = []
  for (const annotation of await page.getAnnotations({ intent: 'display' })) {
    if (annotation.subtype !== 'Link') continue
    const box = wordLinkRectangle(annotation.rect, viewport.transform)
    if (!box) continue
    let href = htmlSafeLink(annotation.url || annotation.unsafeUrl || '')
    if (!href && annotation.dest) {
      try {
        const destination = typeof annotation.dest === 'string' ? await pdf.getDestination(annotation.dest) : annotation.dest
        if (destination?.[0] != null) {
          const target = (typeof destination[0] === 'number' ? destination[0] : await pdf.getPageIndex(destination[0])) + 1
          if (included.has(target)) href = `#page-${target}`
        }
      } catch { /* Ignore broken PDF destinations. */ }
    }
    if (href) links.push({ ...box, href })
  }
  return links
}

function itemMarkup(item, links) {
  let text = htmlEscape(item.text)
  if (item.bold) text = `<strong>${text}</strong>`
  if (item.italic) text = `<em>${text}</em>`
  const link = links.find(link => item.x + item.width / 2 >= link.x && item.x + item.width / 2 <= link.x + link.width && item.y >= link.y - 2 && item.y <= link.y + link.height + 2)
  return link ? `<a href="${htmlEscape(link.href)}"${link.href.startsWith('#') ? '' : ' rel="noopener noreferrer"'}>${text}</a>` : text
}

export function htmlReadingContent(items, links = []) {
  if (!items.length) return ''
  const sizes = items.map(item => item.size).sort((a, b) => a - b)
  const bodySize = sizes[Math.floor((sizes.length - 1) / 2)] || 12
  const tables = detectBorderlessWordTables(items)
  const tableItems = new Set(tables.flatMap(table => table.items))
  const blocks = tables.map(table => ({ y: table.y, html: `<div class="table-scroll"><table><thead><tr>${table.rows[0].map(cell => `<th scope="col">${cell.map(item => itemMarkup(item, links)).join(' ')}</th>`).join('')}</tr></thead><tbody>${table.rows.slice(1).map(row => `<tr>${row.map(cell => `<td>${cell.map(item => itemMarkup(item, links)).join(' ')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` }))
  const lines = groupWordLines(items.filter(item => !tableItems.has(item)))
  let paragraph = null
  const flush = () => { if (paragraph) { blocks.push({ y: paragraph.y, html: `<p dir="${paragraph.dir}">${paragraph.parts.join(' ')}</p>` }); paragraph = null } }
  for (const line of lines) {
    const text = line.items.map(item => item.text).join(' ')
    const markup = line.items.map(item => itemMarkup(item, links)).join(' ')
    const heading = line.size >= bodySize * 1.22 && text.length < 180
    const bullet = /^[•●▪◦‣]|^[-–]\s/.test(text)
    if (heading || bullet) {
      flush()
      blocks.push({ y: line.y, html: heading ? `<h2 dir="${line.items[0].dir}">${markup}</h2>` : `<ul><li>${line.items.map((item, index) => itemMarkup(index === 0 ? { ...item, text: item.text.replace(/^(?:[•●▪◦‣]|[-–])\s*/, '') } : item, links)).join(' ')}</li></ul>` })
    } else {
      const x = line.items[0].x
      if (paragraph && (line.y - paragraph.lastY > line.size * 1.8 || Math.abs(x - paragraph.x) > line.size * 2 || tables.some(table => table.y > paragraph.lastY && table.y < line.y))) flush()
      if (!paragraph) paragraph = { y: line.y, lastY: line.y, x, dir: line.items[0].dir, parts: [] }
      paragraph.parts.push(markup); paragraph.lastY = line.y
    }
  }
  flush()
  return blocks.sort((a, b) => a.y - b.y).map(block => block.html).join('\n')
}

const documentStyles = `
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:75px}body{margin:0;background:#edf0ef;color:#1f2925;font:15px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}a{color:#0a705e}button,select{font:inherit}button,select,.viewer-toolbar a{padding:6px 10px;border:1px solid #d5ded9;border-radius:6px;background:#fff;color:#294038}.viewer-toolbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 24px;background:#fffffff5;border-bottom:1px solid #d9e0dc;backdrop-filter:blur(10px)}.viewer-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.viewer-controls{display:flex;align-items:center;gap:8px;flex-shrink:0}.viewer-controls a{text-decoration:none}.viewer-pages{padding:26px 20px}.page-frame{position:relative;width:min(100%,var(--page-width));aspect-ratio:var(--page-ratio);margin:0 auto 24px;background:#fff;box-shadow:0 2px 15px #243b2f18;scroll-margin-top:80px}.pdf-page{position:absolute;left:0;top:0;background:#fff;overflow:hidden;transform-origin:top left}.pdf-page>img{position:absolute;inset:0;width:100%;height:100%;user-select:none}.text-layer{position:absolute;inset:0;line-height:1;letter-spacing:normal;word-spacing:normal;text-size-adjust:none}.text-layer span{position:absolute;color:transparent;white-space:pre;cursor:text;transform-origin:0 0}.text-layer span::selection{color:transparent;background:#42bba65c}.link-layer{position:absolute;inset:0;pointer-events:none}.link-layer a{position:absolute;display:block;pointer-events:auto}.link-layer a:focus-visible{outline:2px solid #0a806a;outline-offset:2px;background:#0a806a15}.reading-page{max-width:850px;margin:0 auto 24px;padding:clamp(22px,5vw,60px);background:#fff;border-radius:4px;box-shadow:0 2px 15px #243b2f18;overflow-wrap:anywhere}.reading-page h2{font-size:1.4em;line-height:1.35;margin:1.3em 0 .5em}.reading-page p{margin:.6em 0}.reading-page ul{margin:.4em 0;padding-left:1.5em}.reading-page ul+ul{margin-top:-.35em}.page-marker{display:block;margin-bottom:22px;color:#6b7b71;font:11px system-ui;letter-spacing:.1em;text-transform:uppercase}.reading-page figure{margin:24px 0}.reading-page figure img{display:block;max-width:100%;height:auto;margin:auto}.reading-page figcaption{color:#66746b;text-align:center;font-size:12px;margin-top:8px}.table-scroll{max-width:100%;overflow:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:.9em}td,th{border:1px solid #dce3df;padding:9px 12px;text-align:start;vertical-align:top}th{background:#f1f6f3}.scan-note{font-size:12px;color:#65726b}.scan-page{width:100%;height:auto}.source-links{margin-top:20px;font-size:12px}.source-links a{display:inline-block;margin:3px 12px 3px 0}.viewer-footer{text-align:center;color:#6c7b72;padding:0 20px 24px;font-size:11px}@media(max-width:600px){.viewer-toolbar{padding:10px 12px;flex-wrap:wrap;gap:8px}.viewer-title{flex-basis:100%;font-size:13px}.viewer-controls{width:100%;justify-content:space-between;font-size:12px}.viewer-pages{padding:14px 10px}.reading-page{padding:22px 18px}.viewer-controls select{max-width:160px}}@media print{body{background:#fff}.viewer-toolbar,.viewer-footer,.page-marker,.scan-note{display:none!important}.viewer-pages{padding:0}.page-frame{break-after:page;box-shadow:none;margin:0 auto;max-width:100%}.reading-page{box-shadow:none;padding:0;margin:0;break-after:page}.page-frame:last-child,.reading-page:last-child{break-after:auto}.pdf-page{-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit;text-decoration:none}}`

const viewerScript = `(()=>{const frames=[...document.querySelectorAll('.page-frame')];const fit=()=>frames.forEach(frame=>{const page=frame.querySelector('.pdf-page');page.style.transform='scale('+frame.clientWidth/Number(frame.dataset.width)+')'});if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(fit);frames.forEach(frame=>observer.observe(frame))}window.addEventListener('resize',fit);window.addEventListener('beforeprint',fit);window.addEventListener('afterprint',fit);fit();const pages=document.querySelector('select[data-pages]');if(pages)pages.addEventListener('change',()=>document.getElementById('page-'+pages.value)?.scrollIntoView({behavior:'smooth'}));document.querySelector('[data-print]')?.addEventListener('click',()=>window.print())})();`

export function buildHtmlDocument(pages, options = {}, inline = false) {
  const reading = options.layout === 'reading'
  const title = htmlEscape(options.title || 'Converted PDF')
  const imageSource = image => options.packageAssets && !inline ? image.path : image.data
  const sections = pages.map(page => {
    if (reading) {
      const body = page.items.length ? htmlReadingContent(page.items, page.links) + (page.images || []).map(image => `<figure><img src="${imageSource(image)}" alt="Embedded image from page ${page.number}" loading="lazy" width="${image.width}" height="${image.height}"></figure>`).join('') : `<p class="scan-note">Scanned page preserved as an image. Text recognition has not been applied.</p><img class="scan-page" src="${imageSource(page)}" alt="Scanned page ${page.number}" loading="lazy" width="${page.width}" height="${page.height}">`
      const links = page.links.length ? `<nav class="source-links" aria-label="Links on page ${page.number}">${page.links.map(link => `<a href="${htmlEscape(link.href)}" rel="noopener noreferrer">${htmlEscape(link.label || link.href)}</a>`).join('')}</nav>` : ''
      return `<section class="reading-page" id="page-${page.number}" aria-label="Page ${page.number}"><span class="page-marker">Page ${page.number}</span>${body}${links}</section>`
    }
    const links = page.links.map(link => `<a href="${htmlEscape(link.href)}" aria-label="${htmlEscape(link.label || link.href)}" style="left:${link.x}px;top:${link.y}px;width:${link.width}px;height:${link.height}px" rel="noopener noreferrer"></a>`).join('')
    return `<div class="page-frame" id="page-${page.number}" data-width="${page.width}" style="--page-width:${page.width}px;--page-ratio:${page.width}/${page.height}"><section class="pdf-page" aria-label="Page ${page.number}" style="width:${page.width}px;height:${page.height}px"><img src="${imageSource(page)}" alt="" loading="lazy" width="${page.pixelWidth}" height="${page.pixelHeight}"><div class="text-layer">${page.textHtml}</div><div class="link-layer">${links}</div></section></div>`
  }).join('\n')
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="CreatePDF.tech"><title>${title}</title><style>${documentStyles}</style></head><body><header class="viewer-toolbar"><div class="viewer-title">${title}</div><nav class="viewer-controls" aria-label="Document controls"><select data-pages aria-label="Go to page">${pages.map(page => `<option value="${page.number}">Page ${page.number}</option>`).join('')}</select><span>${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</span><button type="button" data-print>Print</button></nav></header><main class="viewer-pages">${sections}</main><footer class="viewer-footer">Converted with CreatePDF.tech · Available offline</footer><script>${viewerScript}</script></body></html>`
}

function cancelled(signal) { if (signal?.aborted) throw new DOMException('Conversion cancelled.', 'AbortError') }
function dataUrl(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not encode an image.')); reader.readAsDataURL(blob) }) }

export async function pdfToHtml(file, options = {}, progress = () => {}) {
  const signal = options.signal
  cancelled(signal)
  const pdfjs = await getPdfjsLib()
  const bytes = await loadPdfBytes(file)
  cancelled(signal)
  const task = pdfjs.getDocument({ data: bytes, password: options.password || undefined })
  const abort = () => { task.destroy().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })
  const pages = [], warnings = []
  let render
  try {
    const pdf = await task.promise
    const selected = wordPageSelection(options.pageRange || '', pdf.numPages)
    const included = new Set(selected)
    const scale = [1, 1.5, 2, 3].includes(Number(options.scale)) ? Number(options.scale) : 2
    const reading = options.layout === 'reading'
    for (const [index, number] of selected.entries()) {
      cancelled(signal)
      progress(Math.round(index / selected.length * 80), `Converting page ${number} of ${pdf.numPages}`)
      const page = await pdf.getPage(number)
      const canvas = document.createElement('canvas')
      try {
        const viewport = page.getViewport({ scale: 1 })
        const renderScale = Math.min(scale, Math.sqrt(24_000_000 / (viewport.width * viewport.height)), 16000 / Math.max(viewport.width, viewport.height))
        if (renderScale < scale) warnings.push(`Page ${number}: image resolution was reduced to fit browser limits.`)
        const output = page.getViewport({ scale: renderScale })
        canvas.width = Math.ceil(output.width); canvas.height = Math.ceil(output.height)
        render = page.render({ canvasContext: canvas.getContext('2d'), viewport: output })
        await render.promise
        cancelled(signal)
        const content = await page.getTextContent()
        // Reading order follows the document's text axes, independent of page display rotation.
        const textViewport = reading ? page.getViewport({ scale: 1, rotation: 0 }) : viewport
        const items = htmlTextItems(content, textViewport, pdfjs, page)
        const links = options.includeLinks === false ? [] : await linksForPage(page, pdf, textViewport, included)
        for (const link of links) link.label = items.filter(item => item.x + item.width / 2 >= link.x && item.x + item.width / 2 <= link.x + link.width && item.y >= link.y && item.y <= link.y + link.height + 2).map(item => item.text).join(' ') || link.href
        pages.push({ number, width: viewport.width, height: viewport.height, pixelWidth: canvas.width, pixelHeight: canvas.height, data: canvas.toDataURL('image/png'), path: `assets/page-${number}.png`, items, textHtml: options.selectableText === false ? '' : textLayer(items), links, images: [] })
      } finally { canvas.width = canvas.height = 0; page.cleanup(); render = null }
    }
    if (reading && options.includeImages !== false && pages.some(page => page.items.length)) {
      const extracted = await extractPdfImages(file, { pageRange: options.pageRange, password: options.password, signal }, (value, label) => progress(80 + Math.round(value * .12), label))
      warnings.push(...extracted.warnings)
      const seen = new Set()
      for (const image of extracted.images) {
        cancelled(signal)
        const target = pages.find(page => page.number === image.pageNumber)
        const key = `${image.pageNumber}-${image.hash}`
        if (!target?.items.length || (image.width === 1 && image.height === 1) || seen.has(key)) continue
        seen.add(key)
        target.images.push({ width: image.width, height: image.height, path: `assets/${image.name}`, data: await dataUrl(image.blob) })
      }
    }
    cancelled(signal)
    progress(94, 'Preparing your HTML')
    const title = options.title?.trim() || file.name?.replace(/\.pdf$/i, '') || 'Converted PDF'
    const settings = { ...options, title }
    const html = buildHtmlDocument(pages, settings)
    const previewHtml = options.packageAssets ? buildHtmlDocument(pages, settings, true) : html
    let blob
    if (options.packageAssets) {
      const zip = new JSZip()
      zip.file('index.html', html)
      for (const page of pages) {
        if (!reading || !page.items.length) zip.file(page.path, page.data.split(',')[1], { base64: true })
        for (const image of page.images) zip.file(image.path, image.data.split(',')[1], { base64: true })
      }
      blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }, meta => progress(94 + Math.round(meta.percent * .06), 'Packaging HTML and images'))
    } else blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    cancelled(signal)
    progress(100, 'HTML ready')
    return { blob, extension: options.packageAssets ? 'zip' : 'html', html, previewHtml, pages: pages.length, pageNumbers: selected, sourcePages: pdf.numPages, textItems: pages.reduce((count, page) => count + page.items.length, 0), links: pages.reduce((count, page) => count + page.links.length, 0), scannedPages: pages.filter(page => !page.items.length).length, warnings }
  } catch (error) {
    cancelled(signal)
    if (error.name === 'PasswordException') throw new Error('Enter the correct PDF opening password and try again.')
    if (error.name === 'InvalidPDFException') throw new Error('Could not read this PDF. Choose a valid PDF document.')
    throw error
  } finally { render?.cancel(); signal?.removeEventListener('abort', abort); await task.destroy() }
}
