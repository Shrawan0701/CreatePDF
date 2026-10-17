import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4196'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4196', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite starting. */ }
    if (attempt >= 120) throw new Error('Vite did not start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const original = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () {
      if (this.type === 'application/pdf') globalThis.previewPdfBlob = this
      return original.call(this)
    }
  })
  await page.goto(`${origin}/csv-to-pdf`, { waitUntil: 'networkidle' })
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.pdf-document-preview')?.getAttribute('aria-busy') === 'false' && document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
    assert.equal(await page.locator('.pdf-preview-error').count(), 0)
  }
  const upload = async (name, csv) => {
    await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await ready()
  }
  const download = async () => {
    await ready()
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Create table PDF', exact: true }).click()
    const file = await pending
    const bytes = await readFile(await file.path())
    const preview = await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))
    assert.deepEqual(bytes, Buffer.from(preview), 'Download must match the preview')
    const result = await page.evaluate(async bytes => {
      const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
      const task = (await getPdfjsLib()).getDocument({ data: new Uint8Array(bytes) })
      try {
        const pdf = await task.promise
        const pages = []
        for (let index = 1; index <= pdf.numPages; index++) {
          const page = await pdf.getPage(index)
          const content = await page.getTextContent()
          pages.push({ width: page.view[2], height: page.view[3], items: content.items.filter(item => item.str?.trim()).map(item => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width })) })
        }
        return pages
      } finally { await task.destroy() }
    }, Array.from(bytes))
    return { name: file.suggestedFilename(), pages: result, text: result.flatMap(page => page.items.map(item => item.text)).join(' ').replace(/\s+/g, ' ') }
  }

  // A report title is not a complete list of its columns.
  await upload('business-report.csv', 'BUSINESS DASHBOARD\nReport Date Range:,2026-07-18,to,2026-08-17\nTotal Orders:,39\nITEM NAME,QUANTITY SOLD,REVENUE\n"Apple, red",0,1250.50\nDATE,DAY,ORDERS,REVENUE,AVERAGE\n2026-07-19,Sunday,7,910.00,130.00')
  const data = page.getByRole('region', { name: 'CSV data preview', exact: true })
  assert.equal(await data.locator('tr').count(), 7)
  assert.equal(await data.locator('tr').first().locator('th').count(), 5)
  assert.equal(await data.locator('tr').last().locator('td').count(), 5)
  assert.equal(await page.getByRole('checkbox').count(), 5)
  let pdf = await download()
  assert.equal(pdf.name, 'business-report.pdf')
  for (const value of ['BUSINESS DASHBOARD', '2026-07-18', '2026-08-17', '39', 'Apple, red', '0', '1250.50', 'Sunday', '910.00', '130.00']) assert.ok(pdf.text.includes(value), `Missing report value ${value}`)
  assert.ok(!pdf.text.includes('CSV'), 'No generated CSV heading')
  assert.ok(pdf.pages[0].width > pdf.pages[0].height)
  const date = pdf.pages[0].items.find(item => item.text === '2026-07-19')
  const average = pdf.pages[0].items.find(item => item.text === '130.00')
  assert.equal(date.y, average.y, 'CSV values must remain on the same row')
  assert.ok(average.x > date.x, 'CSV values must retain their columns')

  await page.getByRole('checkbox', { name: 'Column 5', exact: true }).uncheck()
  pdf = await download()
  assert.ok(!pdf.text.includes('130.00'))
  // Import must reset a previous file's column selection.
  await upload('quoted.csv', 'Name,Qty,Price\n"Apple, red",0,12\n"Multiline","first line\nsecond line",3')
  assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 3)
  await page.getByRole('checkbox', { name: 'Qty', exact: true }).uncheck()
  await page.getByRole('combobox', { name: 'Page orientation' }).selectOption('portrait')
  await page.getByRole('combobox', { name: 'Page size' }).selectOption('Letter')
  pdf = await download()
  assert.ok(pdf.text.includes('Apple, red') && !pdf.text.includes('Qty') && !pdf.text.includes('first line'))
  assert.equal(pdf.pages[0].width, 612)
  assert.equal(pdf.pages[0].height, 792)
  await page.getByRole('checkbox', { name: 'Name', exact: true }).uncheck()
  await page.getByRole('checkbox', { name: 'Price', exact: true }).uncheck()
  assert.ok(await page.getByRole('button', { name: 'Create table PDF' }).isDisabled())
  await page.getByRole('button', { name: 'Select all', exact: true }).click()
  pdf = await download()
  assert.ok(pdf.text.includes('first line second line'))

  // Portrait must retain the ninth column beside each order, without bands.
  const orders = ['Order ID,Date,Customer,City,Product,Quantity,Unit Price,Total,Status']
  for (let index = 1; index <= 40; index++) orders.push(`ORD-${index},2026-10-01,Alex Sharma,Pune,Mechanical Keyboard,2,599.00,1198.00,Delivered`)
  await upload('portrait-orders.csv', orders.join('\n'))
  pdf = await download()
  assert.ok(!pdf.text.includes('Columns'), 'Portrait must not separate Status into a column group')
  for (const sheet of pdf.pages) {
    assert.ok(sheet.items.some(item => item.text === 'Status'), 'Each portrait page needs all nine headers')
    for (const order of sheet.items.filter(item => /^ORD-\d+$/.test(item.text))) {
      assert.ok(sheet.items.some(item => item.text === 'Delivered' && Math.abs(item.y - order.y) < 1), `Status separated from ${order.text}`)
    }
  }
  assert.ok(pdf.text.includes('ORD-40'))

  // Explicit column grouping remains available for exceptionally wide tables.
  await page.getByRole('combobox', { name: 'Column spacing' }).selectOption('readable')
  const rows = [Array.from({ length: 14 }, (_, col) => `Header${col + 1}`)]
  for (let row = 1; row <= 45; row++) rows.push(Array.from({ length: 14 }, (_, col) => `R${row}C${col + 1}`))
  await upload('wide.csv', rows.map(row => row.join(',')).join('\n'))
  assert.equal(await data.locator('tr').count(), 46)
  assert.equal(await data.locator('tr').last().locator('td').count(), 14)
  pdf = await download()
  assert.ok(pdf.pages.length > 1 && pdf.text.includes('Columns'))
  for (let row = 1; row <= 45; row++) for (let col = 1; col <= 14; col++) assert.ok(pdf.text.includes(`R${row}C${col}`), `Missing R${row}C${col}`)
  for (const sheet of pdf.pages) for (const item of sheet.items) {
    assert.ok(item.x >= 35 && item.x + item.width <= sheet.width - 35, `Text clipped horizontally: ${item.text}`)
    assert.ok(item.y >= 35 && item.y < sheet.height - 35, `Text clipped vertically: ${item.text}`)
  }
  await page.getByRole('button', { name: 'Next preview page' }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '2')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.deepEqual(await data.evaluate(element => ({ horizontal: element.scrollWidth > element.clientWidth, vertical: element.scrollHeight > element.clientHeight, overflow: document.documentElement.scrollWidth > window.innerWidth })), { horizontal: true, vertical: true, overflow: false })
  await page.getByRole('textbox', { name: 'CSV data', exact: true }).fill('Name,Value\n"unclosed,1')
  await page.getByRole('alert').first().waitFor()
  assert.ok(await page.getByRole('button', { name: 'Create table PDF' }).isDisabled())
  await page.getByRole('textbox', { name: 'CSV data', exact: true }).fill('')
  assert.ok(await page.getByRole('button', { name: 'Create table PDF' }).isDisabled())
  assert.deepEqual(errors, [])
  console.log('CSV checks passed: ragged title rows, complete columns, selection reset, quoted values, PDF preview/download parity, layout, pagination, mobile, and invalid input.')
} finally {
  await browser?.close()
  server.kill()
}
