import { marked } from 'marked'
import { getPdfLib } from './pdfEngine'
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from './unicodePdf'
import { sanitizeDocumentHtml } from './richPdf'
import { isResumeColor, resumeDesign, resumeSections, safeResumeUrl } from './resumeModel'

async function photoImage(pdf, source, shape) {
  if (!/^data:image\/(png|jpe?g);base64,/i.test(source || '')) return null
  const image = new Image()
  image.src = source
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 400
  const context = canvas.getContext('2d')
  if (shape === 'circle') { context.beginPath(); context.arc(200, 200, 200, 0, Math.PI * 2); context.clip() }
  const size = Math.min(image.naturalWidth, image.naturalHeight)
  context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 400, 400)
  return pdf.embedPng(await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer())
}

export async function resumeToPdf(data) {
  const { PDFDocument, PDFString, StandardFonts, rgb } = await getPdfLib()
  const design = resumeDesign(data)
  const pdf = await PDFDocument.create()
  pdf.setTitle(`${data.name || 'Resume'} — Resume`)
  const names = design.fontFamily === 'serif' ? ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'] : design.fontFamily === 'monospace' ? ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'] : ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique']
  const [regular, bold, italic, boldItalic] = await Promise.all(names.map(name => pdf.embedFont(StandardFonts[name])))
  const fonts = { ...await embedUnicodeFonts(pdf), baseBold: bold }
  const width = design.pageSize === 'Letter' ? 612 : 595
  const height = design.pageSize === 'Letter' ? 792 : 842
  const margin = design.margin
  const fullWidth = width - margin * 2
  const hex = design.accent.slice(1)
  const accentValues = [0, 2, 4].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
  const accent = rgb(...accentValues)
  const colorFromHex = color => rgb(...[1, 3, 5].map(start => parseInt(color.slice(start, start + 2), 16) / 255))
  const ink = colorFromHex(design.bodyColor)
  const linkColor = colorFromHex(design.linkColor)
  const dividerColor = colorFromHex(design.dividerColor)
  const muted = rgb(.35, .39, .44)
  const sidebar = data.template === 'sidebar'
  const compact = data.template === 'compact'
  const sideWidth = Math.max(125, fullWidth * .31)
  const pageTop = height - margin
  let firstBodyTop = pageTop
  const pages = []
  const background = (page, top) => {
    if (sidebar) page.drawRectangle({ x: margin - 10, y: margin + 12, width: sideWidth + 18, height: Math.max(0, top - margin - 4), color: rgb(...accentValues.map(channel => .93 + .07 * channel)) })
  }
  const pageAt = index => {
    while (pages.length <= index) {
      const page = pdf.addPage([width, height])
      if (data.template === 'modern' || sidebar) page.drawRectangle({ x: 0, y: height - 9, width, height: 9, color: accent })
      if (pages.length) background(page, pageTop)
      pages.push(page)
    }
    return pages[index]
  }
  const ensure = (flow, needed) => {
    if (flow.y - needed < margin + 16) { flow.page++; flow.y = pageTop }
    return pageAt(flow.page)
  }
  const inline = (text, forceBold = false, href = '') => {
    const document = new DOMParser().parseFromString(sanitizeDocumentHtml(marked.parseInline(String(text || ''), { async: false })), 'text/html')
    const runs = []
    const visit = (node, style) => {
      if (node.nodeType === 3) { runs.push({ ...style, text: node.textContent.replace(/\s+/g, ' ') }); return }
      if (node.localName === 'br') { runs.push({ ...style, text: '\n' }); return }
      const selectedColor = node.getAttribute('data-resume-color') || node.getAttribute('color')
      const next = { bold: style.bold || ['strong', 'b'].includes(node.localName), italic: style.italic || ['em', 'i'].includes(node.localName), href: node.localName === 'a' ? safeResumeUrl(node.getAttribute('href')) : style.href, color: isResumeColor(selectedColor) ? selectedColor : style.color }
      for (const child of node.childNodes) visit(child, next)
    }
    visit(document.body, { bold: forceBold, href })
    return runs
  }
  const paragraph = (flow, text, { size = design.fontSize, strong = false, color = ink, after = compact ? 4 : 6, bullet = false, align = 'left', href = '', runs = null } = {}) => {
    const source = runs || inline(text, strong, href)
    const indent = bullet ? 12 : 0
    const available = flow.width - indent
    const lines = []
    let line = []; let lineWidth = 0
    const flush = () => { while (line.at(-1)?.text === ' ') lineWidth -= line.pop().width; lines.push({ runs: line, width: lineWidth }); line = []; lineWidth = 0 }
    const add = (text, run) => {
      const font = run.bold && run.italic ? boldItalic : run.bold ? bold : run.italic ? italic : regular
      const measured = measureUnicodeText(text, font, size, fonts)
      if (line.length && lineWidth + measured > available) flush()
      if (!line.length && text === ' ') return
      line.push({ ...run, text, font, width: measured }); lineWidth += measured
    }
    for (const run of source) {
      const font = run.bold && run.italic ? boldItalic : run.bold ? bold : run.italic ? italic : regular
      for (const token of run.text.split(/(\n| +)/).filter(Boolean)) {
        if (token === '\n') { flush(); continue }
        const value = /^ +$/.test(token) ? ' ' : token
        if (measureUnicodeText(value, font, size, fonts) > available) for (const character of value) add(character, run)
        else add(value, run)
      }
    }
    if (line.length) flush()
    for (const [index, line] of lines.entries()) {
      const lineHeight = size * design.lineHeight
      const page = ensure(flow, lineHeight)
      const y = flow.y - size
      let x = flow.x + indent + (align === 'center' ? Math.max(0, available - line.width) / 2 : 0)
      if (bullet && index === 0) page.drawCircle({ x: flow.x + 3, y: y + size * .33, size: 1.4, color: accent })
      for (const run of line.runs) {
        const link = /^(https?:|mailto:|tel:)/i.test(run.href || '')
        const runColor = run.color ? colorFromHex(run.color) : link ? linkColor : color
        drawUnicodeText(page, run.text, { x, y, size, font: run.font, color: runColor }, fonts)
        if (link) {
          page.drawLine({ start: { x, y: y - 1 }, end: { x: x + run.width, y: y - 1 }, thickness: .4, color: runColor })
          page.node.addAnnot(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, y - 2, x + run.width, y + size], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(run.href) } })))
        }
        x += run.width
      }
      flow.y -= lineHeight
    }
    if (lines.length) flow.y -= after
  }
  const first = pageAt(0)
  const photo = await photoImage(pdf, data.photo, design.photoShape)
  const photoLeft = design.photoPosition === 'left'
  const header = { page: 0, x: margin + (photo && photoLeft ? design.photoSize + 16 : 0), width: fullWidth - (photo ? design.photoSize + 16 : 0), y: height - margin }
  const align = data.template === 'classic' ? 'center' : 'left'
  paragraph(header, data.name || 'Your name', { size: design.nameSize, strong: true, color: data.template === 'modern' || sidebar ? accent : ink, align, after: 4 })
  if (data.title) paragraph(header, data.title, { size: design.fontSize + 1.5, color: muted, align, after: 8 })
  const contacts = []
  if (data.location) contacts.push({ text: data.location })
  if (data.email) contacts.push({ text: data.email, href: `mailto:${data.email.trim()}` })
  if (data.phone) contacts.push({ text: data.phone, href: `tel:${data.phone.replace(/[^+0-9]/g, '')}` })
  for (const link of data.links || []) if (link.label || link.url) contacts.push({ text: link.label || link.url, href: safeResumeUrl(link.url) })
  const contactRuns = contacts.flatMap((contact, index) => [...(index ? [{ text: '  ·  ' }] : []), contact])
  paragraph(header, '', { runs: contactRuns, size: Math.max(8, design.fontSize - 1), align, color: muted })
  if (photo) first.drawImage(photo, { x: photoLeft ? margin : width - margin - design.photoSize, y: height - margin - design.photoSize, width: design.photoSize, height: design.photoSize })
  firstBodyTop = Math.min(header.y, height - margin - (photo ? design.photoSize : 0)) - 12
  if (!compact) first.drawLine({ start: { x: margin, y: firstBodyTop + 5 }, end: { x: width - margin, y: firstBodyTop + 5 }, thickness: data.template === 'modern' ? 1.5 : .6, color: accent })
  background(first, firstBodyTop)
  const main = { page: 0, x: sidebar ? margin + sideWidth + 28 : margin, width: sidebar ? fullWidth - sideWidth - 28 : fullWidth, y: firstBodyTop - 8 }
  const side = { page: 0, x: margin, width: sideWidth, y: firstBodyTop - 8 }
  const title = (flow, label) => {
    const hasDivider = design.sectionDividers !== 'none'
    ensure(flow, design.headingSize * 1.5 + design.fontSize * design.lineHeight * 4 + 20 + (hasDivider ? 8 : 0))
    flow.y -= compact ? 7 : 10
    const rule = () => pageAt(flow.page).drawLine({ start: { x: flow.x, y: flow.y }, end: { x: flow.x + flow.width, y: flow.y }, thickness: design.dividerWidth, color: dividerColor })
    if (design.sectionDividers === 'above') { rule(); flow.y -= 8 }
    paragraph(flow, data.template === 'classic' ? label : label.toUpperCase(), { size: design.headingSize, strong: true, color: accent, after: design.sectionDividers === 'below' ? 4 : 7 })
    if (design.sectionDividers === 'below') { rule(); flow.y -= 7 }
  }
  const bullets = (flow, value) => {
    for (const line of String(value || '').split(/\r?\n/).filter(line => line.trim())) paragraph(flow, line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), { bullet: true, after: compact ? 2 : 3 })
  }
  const entry = (flow, item, kind) => {
    const name = kind === 'experience' ? item.role : kind === 'education' ? item.degree : item.name
    const organization = kind === 'experience' ? item.organization : kind === 'education' ? item.institution : item.role
    const dates = [item.start, item.end].filter(Boolean).join(' – ')
    ensure(flow, design.fontSize * design.lineHeight * 3 + 8)
    if (name) paragraph(flow, name, { strong: true, after: 3, href: kind === 'projects' ? safeResumeUrl(item.url) : '' })
    const metadata = [organization, item.location, dates].filter(Boolean).join(' · ')
    if (metadata) paragraph(flow, metadata, { size: Math.max(8, design.fontSize - 1), color: muted, after: 5 })
    if (kind === 'projects' && item.url && !name) paragraph(flow, item.url, { href: safeResumeUrl(item.url), after: 4 })
    bullets(flow, item.details)
    flow.y -= compact ? 3 : 6
  }
  for (const key of data.sectionOrder || Object.keys(resumeSections)) {
    if (data.hiddenSections?.includes(key)) continue
    const flow = sidebar && ['skills', 'education'].includes(key) ? side : main
    const custom = data.custom?.find(section => section.id === key)
    if (key === 'summary' && data.summary?.trim()) { title(flow, 'Profile'); for (const text of data.summary.split(/\n+/).filter(Boolean)) paragraph(flow, text) }
    else if (['experience', 'education', 'projects'].includes(key)) {
      const items = (data[key] || []).filter(item => Object.entries(item).some(([field, value]) => field !== 'id' && String(value || '').trim()))
      if (!items.length) continue
      title(flow, resumeSections[key])
      for (const item of items) entry(flow, item, key)
    } else if (key === 'skills' && data.skills?.trim()) {
      title(flow, 'Skills')
      const skills = data.skills.split(/[,\n;]+/).map(value => value.trim()).filter(Boolean)
      if (sidebar) for (const skill of skills) paragraph(flow, skill, { bullet: true, after: 3 })
      else paragraph(flow, skills.join(' · '))
    } else if (custom && custom.details?.trim()) { title(flow, custom.title || 'Additional information'); bullets(flow, custom.details) }
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' })
}
