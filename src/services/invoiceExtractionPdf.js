import { getPdfLib } from './pdfEngine'
import { analyzeInvoice, invoiceAmount } from './invoiceExtraction'

// The export is a report of the reviewed data, not a regenerated tax invoice.
export async function createInvoiceExtractionPdf(invoice, { sourceName = 'Document', pageCount } = {}) {
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Extracted bill details - ${invoice.invoiceNumber || sourceName}`)
  pdf.setCreator('CreatePDF.tech')
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  await document.fonts.ready
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot create the PDF report.')
  const supported = new Map(), font = strong => strong ? bold : regular
  const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  const native = string => {
    if (!supported.has(string)) { try { regular.encodeText(string); supported.set(string, true) } catch { supported.set(string, false) } }
    return supported.get(string)
  }
  const browserFont = (size, strong) => `${strong ? 'bold ' : ''}${size}px Arial, sans-serif`
  const measure = (string, size, strong) => {
    if (native(string)) return font(strong).widthOfTextAtSize(string, size)
    context.font = browserFont(size, strong); return context.measureText(string).width
  }
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const width = 595.28, height = 841.89, margin = 42, usable = width - margin * 2
  const ink = rgb(.1, .15, .17), accent = rgb(.15, .43, .36), pale = rgb(.94, .97, .96), border = rgb(.82, .86, .84)
  const wrap = (value, maxWidth = usable, size = 10, strong = false) => {
    const lines = []
    for (const paragraph of clean(value).split(/\r?\n/)) {
      let line = ''
      for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
        if (line && measure(`${line} ${word}`, size, strong) > maxWidth) { lines.push(line); line = '' }
        if (measure(word, size, strong) > maxWidth) {
          for (const part of segmenter ? Array.from(segmenter.segment(word), entry => entry.segment) : Array.from(word)) {
            if (line && measure(line + part, size, strong) > maxWidth) { lines.push(line); line = '' }
            line += part
          }
        } else line += `${line ? ' ' : ''}${word}`
      }
      lines.push(line)
    }
    return lines
  }
  const images = []
  let page, y
  const draw = (value, x, top, size = 10, strong = false, color = ink) => {
    const string = clean(value).replace(/[\r\n\t]/g, ' ')
    if (native(string)) page.drawText(string, { x, y: top, size, font: font(strong), color })
    else images.push({ page, string, x, top, size, strong, color })
  }
  const newPage = () => {
    page = pdf.addPage([width, height]); y = height - 44
    draw('EXTRACTED BILL DETAILS', margin, y, 17, true, accent); y -= 27
  }
  const ensure = needed => { if (y - needed < 45) newPage() }
  const advance = (line, size, strong) => {
    context.font = browserFont(size, strong)
    const metrics = context.measureText(line)
    return Math.max(size + 5, (metrics.actualBoundingBoxAscent || size) + (metrics.actualBoundingBoxDescent || size * .25) + 5)
  }
  const flow = (value, size = 10, strong = false, color = ink) => {
    for (const line of wrap(value, usable, size, strong)) { const step = advance(line, size, strong); ensure(step); draw(line, margin, y, size, strong, color); y -= step }
  }
  const section = title => { ensure(45); y -= 12; flow(title, 11, true, accent); y -= 5 }
  const value = (label, content) => flow(`${label}: ${content === '' || content == null ? 'Not found' : content}`)
  const amount = number => invoiceAmount(number, invoice)
  try {
    newPage()
    flow(`Source: ${sourceName}`, 9)
    if (pageCount) flow(`${pageCount} source ${pageCount === 1 ? 'page' : 'pages'}`, 9)
    flow('Report of extracted values and your review edits.', 9)
    section('SUPPLIER & DOCUMENT')
    value('Supplier', invoice.supplierName)
    if (invoice.supplierAddress) value('Address', invoice.supplierAddress)
    if (invoice.gstin) value('Supplier tax ID', invoice.gstin)
    value('Invoice / receipt number', invoice.invoiceNumber); value('Invoice date', invoice.invoiceDate)
    value('Currency', invoice.currency)
    section('LINE ITEMS')
    const starts = [42, 66, 296, 346, 449], widths = [24, 230, 50, 103, 104]
    const headings = ['#', 'Description', 'Qty', 'Unit price', 'Line amount']
    const header = () => {
      ensure(30); page.drawRectangle({ x: margin, y: y - 7, width: usable, height: 22, color: pale })
      headings.forEach((label, index) => draw(label, starts[index] + 3, y, 8, true)); y -= 24
    }
    header()
    if (!invoice.items.length) flow('No line items identified.')
    invoice.items.forEach((item, index) => {
      const cells = [String(index + 1), item.description || 'Not found', item.quantity == null ? 'Not found' : String(item.quantity), item.price == null ? 'Not found' : `${invoice.currency ? invoice.currency + ' ' : ''}${Number(item.price).toLocaleString('en-US', { maximumFractionDigits: 20 })}`, amount(item.amount)]
      const parts = cells.map((cell, column) => wrap(cell, widths[column] - 9, 9, column === 1))
      for (let line = 0; line < Math.max(...parts.map(cell => cell.length)); line++) {
        const step = Math.max(...parts.map((cell, column) => advance(cell[line] || '', 9, column === 1)))
        if (y - step < 45) { newPage(); header() }
        parts.forEach((cell, column) => { if (cell[line]) draw(cell[line], starts[column] + 3, y, 9, column === 1) }); y -= step
      }
      const details = [item.amountBasis !== 'unknown' ? `Amount basis: ${item.amountBasis === 'gross' ? 'before line discount' : item.amountBasis === 'net' ? 'after line discount, before tax' : 'including line tax'}` : 'Amount basis: unspecified',
        item.discount != null ? `Line discount: ${item.discountType === 'percent' ? item.discount + '%' : amount(item.discount)}` : '', item.taxRate != null ? `Line tax rate: ${item.taxRate}%` : '', item.taxAmount != null ? `Line tax: ${amount(item.taxAmount)}` : ''].filter(Boolean).join(' | ')
      for (const line of wrap(details, usable - 24, 8)) { const step = advance(line, 8); if (y - step < 45) { newPage(); header() }; draw(line, margin + 24, y, 8); y -= step }
      ensure(12); page.drawLine({ start: { x: margin, y: y + 2 }, end: { x: width - margin, y: y + 2 }, thickness: .4, color: border }); y -= 12
    })
    section('BILL TOTALS')
    value('Subtotal', amount(invoice.subtotal))
    if (invoice.discount != null) value('Invoice discount', amount(invoice.discount))
    if (invoice.tax != null) value(invoice.taxLabel || 'Tax', amount(invoice.tax))
    for (const key of ['cgst', 'sgst', 'igst', 'charges', 'rounding']) if (invoice[key] != null) value(({ cgst: 'CGST', sgst: 'SGST', igst: 'IGST', charges: 'Other charges', rounding: 'Rounding adjustment' })[key], amount(invoice[key]))
    flow(`Grand total: ${amount(invoice.grandTotal)}`, 13, true)
    if (invoice.taxTreatment !== 'unknown') value('Tax treatment', invoice.taxTreatment === 'inclusive' ? 'Already included' : 'Added to subtotal')
    const analysis = analyzeInvoice(invoice)
    section('REVIEW')
    flow(analysis.status, 11, true)
    if (analysis.issues.length) { flow('Values to review:', 10, true); analysis.issues.forEach(issue => flow(`• ${issue}`, 9)) }
    if (analysis.checks.length) { flow('Amount checks:', 10, true); analysis.checks.forEach(check => flow(`• ${check}`, 9)) }
    if (analysis.notes.length) { flow('Reading notes:', 10, true); analysis.notes.forEach(note => flow(`• ${note}`, 9)) }
    for (const entry of images) {
      const { string, size, strong, color } = entry
      context.font = browserFont(size, strong)
      const metrics = context.measureText(string), ascent = Math.max(size, metrics.actualBoundingBoxAscent || 0), descent = Math.max(size * .3, metrics.actualBoundingBoxDescent || 0), left = Math.max(0, metrics.actualBoundingBoxLeft || 0)
      const imageWidth = Math.ceil(left + Math.max(metrics.width, metrics.actualBoundingBoxRight || 0) + 4), imageHeight = Math.ceil(ascent + descent + 4)
      canvas.width = imageWidth * 3; canvas.height = imageHeight * 3
      context.scale(3, 3); context.font = browserFont(size, strong); context.textBaseline = 'alphabetic'; context.fillStyle = `rgb(${Math.round(color.red * 255)},${Math.round(color.green * 255)},${Math.round(color.blue * 255)})`; context.fillText(string, left + 2, ascent + 2)
      const image = await pdf.embedPng(canvas.toDataURL('image/png'))
      entry.page.drawImage(image, { x: entry.x - left - 2, y: entry.top - (imageHeight - ascent - 2), width: imageWidth, height: imageHeight })
    }
    pdf.getPages().forEach((output, index) => output.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: margin, y: 22, size: 8, font: regular }))
    return new Blob([await pdf.save()], { type: 'application/pdf' })
  } finally { canvas.width = canvas.height = 0 }
}
