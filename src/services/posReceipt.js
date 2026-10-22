import { getPdfLib } from './pdfEngine'
import { countryName, countryTax, currencyDigits, currencyFactor } from './invoiceLocale'
import { normalizePosBill, posPayment } from './posBilling'

const clean = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
const escapeHtml = value => clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function receiptRows(source) {
  const bill = normalizePosBill(source), { store, totals } = bill
  const number = value => (value / currencyFactor(store.currency)).toLocaleString('en-US', { minimumFractionDigits: currencyDigits(store.currency), maximumFractionDigits: currencyDigits(store.currency) })
  const money = value => `${store.currency} ${number(value)}`
  const rows = []
  const add = (label, value, strong = false, size = 9) => rows.push({ label: clean(label), value: value == null ? null : clean(value), strong, size })
  const rule = () => rows.push({ rule: true })
  add(store.name || 'Store', null, true, 15)
  if (store.address) add(store.address)
  if (store.country) add(countryName(store.country))
  if (store.phone) add(store.phone)
  if (store.taxId) add(`${countryTax(store.country).idLabel}: ${store.taxId}`)
  rule()
  add(bill.number, null, true)
  add(new Date(bill.createdAt).toLocaleString())
  if (bill.customer?.name || bill.customer?.phone) add([bill.customer.name, bill.customer.phone].filter(Boolean).join(' | '))
  if (bill.customer?.reference) add(`Reference: ${bill.customer.reference}`)
  rule()
  bill.items.forEach((item, index) => {
    add(item.name, money(totals.lines?.[index]?.gross ?? Math.round(Number(item.price) * Number(item.quantity) * currencyFactor(store.currency))), true)
    add(`${item.quantity} × ${store.currency} ${Number(item.price).toLocaleString('en-US', { minimumFractionDigits: currencyDigits(store.currency), maximumFractionDigits: 20 })}${Number(item.gstRate) ? ` | ${store.taxName} ${item.gstRate}%` : ''}`, null, false, 8)
    if (item.note || item.description) add(item.note || item.description, null, false, 8)
  })
  rule()
  add('Subtotal', money(totals.subtotal))
  if (totals.discountAmount) add(`Discount (${bill.discount}%)`, `-${money(totals.discountAmount)}`)
  if (store.taxInclusive && totals.tax) add('Net before tax', money(totals.taxable))
  if (totals.tax || bill.items.some(item => Number(item.gstRate))) add(`${store.taxName}${store.taxInclusive ? ' (included)' : ''}`, money(totals.tax))
  add('TOTAL', money(totals.total), true, 11)
  rule()
  const payment = posPayment(bill)
  add(payment.status, payment.method === 'Not paid' ? null : payment.method, true)
  if (payment.method === 'Cash') add('Cash received', money(payment.received))
  if (payment.change) add('Change', money(payment.change))
  if (payment.due) add('Balance due', money(payment.due), true)
  add('Thank you for your business.', null, false, 9)
  return { bill, rows }
}

export function posReceiptHtml(source) {
  const { bill, rows } = receiptRows(source)
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.number)}</title><style>body{font:12px Arial,sans-serif;width:72mm;max-width:100%;margin:16px auto;color:#111;background:#fff}p{display:flex;gap:10px;justify-content:space-between;margin:7px 0;break-inside:avoid;line-height:1.4}p span{min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}p span:last-child:not(:first-child){text-align:right;flex-shrink:0;max-width:65%}hr{border:0;border-top:1px dashed #999;margin:12px 0}.strong{font-weight:700}@media print{@page{size:auto;margin:4mm}body{margin:0;width:72mm;max-width:100%}}</style></head><body>${rows.map(row => row.rule ? '<hr>' : `<p class="${row.strong ? 'strong' : ''}" style="font-size:${row.size * 1.3}px"><span>${escapeHtml(row.label)}</span>${row.value == null ? '' : `<span>${escapeHtml(row.value)}</span>`}</p>`).join('')}</body></html>`
}

// A narrow, selectable-text receipt with wrapped names and automatic pages.
// Browser-shaped text images retain characters unavailable in PDF base fonts.
export async function createPosReceiptPdf(source) {
  const { bill, rows } = receiptRows(source)
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Receipt ${bill.number}`); pdf.setCreator('CreatePDF.tech')
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  await document.fonts.ready
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot create receipt PDFs.')
  const native = new Map(), font = strong => strong ? bold : regular
  const supported = string => {
    if (!native.has(string)) { try { regular.encodeText(string); native.set(string, true) } catch { native.set(string, false) } }
    return native.get(string)
  }
  const browserFont = (size, strong) => `${strong ? 'bold ' : ''}${size}px Arial, sans-serif`
  const measure = (string, size, strong) => {
    if (supported(string)) return font(strong).widthOfTextAtSize(string, size)
    context.font = browserFont(size, strong); return context.measureText(string).width
  }
  const width = 226.77, margin = 14, available = width - margin * 2
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  const wrap = (value, maxWidth, size, strong) => {
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
  const advance = (string, size, strong) => {
    context.font = browserFont(size, strong)
    const metrics = context.measureText(string)
    return Math.max(size + 5, (metrics.actualBoundingBoxAscent || size) + (metrics.actualBoundingBoxDescent || size * .25) + 5)
  }
  const layout = []
  for (const row of rows) {
    if (row.rule) { layout.push({ rule: true, height: 17 }); continue }
    let valueSize = row.size
    if (row.value != null) while (valueSize > 6 && measure(row.value, valueSize, row.strong) > available * .65) valueSize -= .25
    const valueWidth = row.value == null ? 0 : measure(row.value, valueSize, row.strong)
    if (valueWidth > available * .8) {
      for (const label of wrap(row.label, available, row.size, row.strong)) layout.push({ ...row, label, value: null, height: advance(label, row.size, row.strong) })
      for (const label of wrap(row.value, available, valueSize, row.strong)) layout.push({ label, size: valueSize, strong: row.strong, height: advance(label, valueSize, row.strong) })
    } else wrap(row.label, available - (valueWidth ? valueWidth + 9 : 0), row.size, row.strong).forEach((label, index) => layout.push({ ...row, label, value: index ? null : row.value, valueSize, height: Math.max(advance(label, row.size, row.strong), valueSize + 5) }))
  }
  const chunks = [[]]; let used = 0
  for (const row of layout) {
    if (used + row.height > 740) { chunks.push([]); used = 0 }
    chunks[chunks.length - 1].push(row); used += row.height
  }
  const draw = async (page, string, x, y, size, strong) => {
    if (!string) return
    if (supported(string)) { page.drawText(string, { x, y, size, font: font(strong), color: rgb(.08, .1, .11) }); return }
    context.font = browserFont(size, strong)
    const metrics = context.measureText(string), ascent = Math.max(size, metrics.actualBoundingBoxAscent || 0), descent = Math.max(size * .3, metrics.actualBoundingBoxDescent || 0), left = Math.max(0, metrics.actualBoundingBoxLeft || 0)
    const imageWidth = Math.ceil(left + Math.max(metrics.width, metrics.actualBoundingBoxRight || 0) + 4), imageHeight = Math.ceil(ascent + descent + 4)
    canvas.width = imageWidth * 3; canvas.height = imageHeight * 3
    context.scale(3, 3); context.font = browserFont(size, strong); context.textBaseline = 'alphabetic'; context.fillStyle = '#141a1c'; context.fillText(string, left + 2, ascent + 2)
    const image = await pdf.embedPng(canvas.toDataURL('image/png'))
    page.drawImage(image, { x: x - left - 2, y: y - (imageHeight - ascent - 2), width: imageWidth, height: imageHeight })
  }
  try {
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index], height = Math.max(230, chunk.reduce((sum, row) => sum + row.height, 0) + 46), page = pdf.addPage([width, height])
      let y = height - 26
      for (const row of chunk) {
        if (row.rule) page.drawLine({ start: { x: margin, y: y - 3 }, end: { x: width - margin, y: y - 3 }, thickness: .5, color: rgb(.65, .68, .67) })
        else {
          await draw(page, row.label, margin, y, row.size, row.strong)
          if (row.value != null) await draw(page, row.value, width - margin - measure(row.value, row.valueSize, row.strong), y, row.valueSize, row.strong)
        }
        y -= row.height
      }
      if (chunks.length > 1) page.drawText(`${index + 1} / ${chunks.length}`, { x: margin, y: 12, size: 7, font: regular })
    }
    return new Blob([await pdf.save()], { type: 'application/pdf' })
  } finally { canvas.width = canvas.height = 0 }
}
