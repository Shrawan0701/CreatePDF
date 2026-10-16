import { spawn } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import PptxGenJS from 'pptxgenjs'
import ExcelJS from 'exceljs'

const port = 4181
const baseUrl = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
const temp = await mkdtemp(join(tmpdir(), 'createpdf-conversion-'))
let browser

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) return } catch { /* Server is starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Production server did not start.')
}

try {
  const source = await PDFDocument.create()
  const page = source.addPage([595, 842])
  const font = await source.embedFont(StandardFonts.Helvetica)
  page.drawText('Report title', { x: 45, y: 780, size: 18, font })
  for (const [row, values] of [['Name', 'Qty', 'Price'], ['Apple', '2', '12'], ['Pear', '3', '15']].entries()) {
    values.forEach((value, column) => page.drawText(value, { x: [45, 240, 400][column], y: 720 - row * 30, size: 11, font }))
  }
  page.drawText('Report footer', { x: 45, y: 560, size: 11, font })
  await waitForServer()
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const browserPage = await browser.newPage({ acceptDownloads: true })
  const errors = []
  browserPage.on('pageerror', (error) => errors.push(error.message))
  await browserPage.goto(`${baseUrl}/pdf-to-word`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  const downloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Download DOCX' }).click()
  const download = await downloadPromise
  const path = join(temp, download.suggestedFilename())
  await download.saveAs(path)
  const zip = await JSZip.loadAsync(await readFile(path))
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('DOCX has no document.xml')
  const title = xml.indexOf('Report title')
  const table = xml.indexOf('<w:tbl>')
  const footer = xml.indexOf('Report footer')
  if (!(title >= 0 && table > title && footer > table)) throw new Error('DOCX content order is wrong')
  for (const value of ['Name', 'Qty', 'Price', 'Apple', 'Pear']) if (!xml.includes(value)) throw new Error(`DOCX lost ${value}`)

  await browserPage.goto(`${baseUrl}/word-to-pdf`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await readFile(path) })
  const wordPdfPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Convert and download' }).click()
  const wordPdfDownload = await wordPdfPromise
  const wordPdfPath = join(temp, 'word.pdf')
  await wordPdfDownload.saveAs(wordPdfPath)
  const wordPdf = await getDocument({ data: new Uint8Array(await readFile(wordPdfPath)) }).promise
  const wordText = (await (await wordPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!['Report title', 'Name', 'Qty', 'Apple', 'Report footer'].every((value) => wordText.includes(value))) throw new Error('DOCX to PDF lost table or paragraph text')

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Sales')
  sheet.addRow(['Item', 'Price'])
  sheet.addRow(['Apple', 12])
  sheet.addRow(['Pear', 15])
  await browserPage.goto(`${baseUrl}/excel-to-pdf`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'sales.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) })
  const excelPdfPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Convert and download' }).click()
  const excelPdfDownload = await excelPdfPromise
  const excelPdfPath = join(temp, 'excel.pdf')
  await excelPdfDownload.saveAs(excelPdfPath)
  const excelPdf = await getDocument({ data: new Uint8Array(await readFile(excelPdfPath)) }).promise
  const excelText = (await (await excelPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!['Sales', 'Item', 'Price', 'Apple', '12', 'Pear', '15'].every((value) => excelText.includes(value))) throw new Error('XLSX to PDF lost sheet table data')

  await browserPage.goto(`${baseUrl}/split-in-half`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  for (const [layout, expectedWidth, expectedHeight, names] of [
    ['vertical', 297.5, 842, ['left-half.pdf', 'right-half.pdf']],
    ['horizontal', 595, 421, ['top-half.pdf', 'bottom-half.pdf']],
  ]) {
    await browserPage.getByRole('combobox', { name: 'Split layout' }).selectOption(layout)
    const halvesDownloadPromise = browserPage.waitForEvent('download')
    await browserPage.getByRole('button', { name: 'Download two halves' }).click()
    const halvesDownload = await halvesDownloadPromise
    const halvesPath = join(temp, `${layout}-halves.zip`)
    await halvesDownload.saveAs(halvesPath)
    const halvesZip = await JSZip.loadAsync(await readFile(halvesPath))
    for (const name of names) {
      const halfBytes = await halvesZip.file(name)?.async('uint8array')
      if (!halfBytes) throw new Error(`${layout} split omitted ${name}`)
      const halfPdf = await PDFDocument.load(halfBytes)
      if (halfPdf.getPageCount() !== 1 || Math.abs(halfPdf.getPage(0).getWidth() - expectedWidth) > 1 || Math.abs(halfPdf.getPage(0).getHeight() - expectedHeight) > 1) throw new Error(`${layout} split has wrong page geometry`)
    }
  }

  await browserPage.goto(`${baseUrl}/invert-colors`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  await browserPage.getByRole('combobox', { name: 'Output mode' }).selectOption('light')
  const lightDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Convert colours' }).click()
  const lightDownload = await lightDownloadPromise
  const lightPath = join(temp, 'light.pdf')
  await lightDownload.saveAs(lightPath)
  const lightPdf = await PDFDocument.load(await readFile(lightPath))
  if (lightPdf.getPageCount() !== 1 || Math.abs(lightPdf.getPage(0).getWidth() - 595) > 1) throw new Error('Light PDF changed page geometry')

  await browserPage.goto(`${baseUrl}/thumbmark`, { waitUntil: 'networkidle' })
  const thumbprintBytes = await browserPage.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 100
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 100, 100)
    context.fillStyle = '#000000'
    context.fillRect(35, 35, 30, 30)
    return Array.from(new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()))
  })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'thumb.png', mimeType: 'image/png', buffer: Buffer.from(thumbprintBytes) })
  await browserPage.locator('.thumbmark-stage canvas').waitFor()
  await browserPage.getByRole('slider', { name: 'Crop left' }).fill('20')
  const preview = await browserPage.locator('.thumbmark-stage canvas').evaluate((canvas) => ({ width: canvas.width, clear: canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3], ink: canvas.getContext('2d').getImageData(30, 50, 1, 1).data[3] }))
  if (preview.width !== 80 || preview.clear !== 0 || preview.ink === 0) throw new Error('Thumbmark crop or transparency preview failed')
  const thumbDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Transparent PNG' }).click()
  const thumbDownload = await thumbDownloadPromise
  if (!thumbDownload.suggestedFilename().endsWith('.png')) throw new Error('Thumbmark did not export PNG')

  await browserPage.goto(`${baseUrl}/edit-pdf`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  await browserPage.locator('.pdf-text-item').first().waitFor()
  await browserPage.locator('.editor-bottom-dock').getByRole('button', { name: 'Text' }).click()
  const hitArea = await browserPage.locator('.pdf-text-item').first().boundingBox()
  await browserPage.mouse.click(hitArea.x + hitArea.width / 2, hitArea.y + hitArea.height / 2)
  await browserPage.locator('.editor-overlay textarea').fill('Added note')
  await browserPage.getByRole('combobox', { name: 'Font' }).selectOption('Courier')
  const addedDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.locator('.editor-download').click()
  const addedDownload = await addedDownloadPromise
  const addedPath = join(temp, 'added.pdf')
  await addedDownload.saveAs(addedPath)
  const addedPdf = await getDocument({ data: new Uint8Array(await readFile(addedPath)) }).promise
  const addedText = (await (await addedPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!/Added\s+note/.test(addedText) || !addedText.includes('Report title')) throw new Error(`Added text was not exported with the original page: ${addedText}`)

  await browserPage.locator('.editor-bottom-dock').getByRole('button', { name: 'Insert' }).click()
  const editorBounds = await browserPage.locator('.pdf-editor-workspace').boundingBox()
  await browserPage.mouse.click(editorBounds.x + 80, editorBounds.y + 120)
  await browserPage.locator('.editor-overlay.overlay-rect').waitFor()
  await browserPage.getByTitle('Undo').click()
  if (await browserPage.locator('.editor-overlay.overlay-rect').count()) throw new Error('Editor shape undo failed')
  await browserPage.getByTitle('Redo').click()
  await browserPage.locator('.editor-overlay.overlay-rect').waitFor()

  await browserPage.reload({ waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  await browserPage.locator('.pdf-text-item').first().click()
  await browserPage.locator('.editor-overlay textarea').fill('Revised heading')
  const replacedDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.locator('.editor-download').click()
  const replacedDownload = await replacedDownloadPromise
  const replacedPath = join(temp, 'replaced.pdf')
  await replacedDownload.saveAs(replacedPath)
  const replacedPdf = await getDocument({ data: new Uint8Array(await readFile(replacedPath)) }).promise
  const replacedText = (await (await replacedPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!replacedText.includes('Revised heading') || replacedText.includes('Report title')) throw new Error('Original text remains in replaced page content')

  await browserPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await browserPage.locator('.saved-documents-drop input[type="file"]').setInputFiles({ name: 'table.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) })
  await browserPage.locator('.saved-document-row').filter({ hasText: 'table.pdf' }).getByRole('link', { name: 'Edit' }).click()
  await browserPage.locator('.pdf-text-item').first().waitFor()
  await browserPage.locator('.editor-bottom-dock').getByRole('button', { name: 'Text' }).click()
  const savedPageBounds = await browserPage.locator('.pdf-editor-workspace').boundingBox()
  await browserPage.mouse.click(savedPageBounds.x + 70, savedPageBounds.y + 120)
  await browserPage.locator('.editor-overlay textarea').fill('Saved note')
  await browserPage.getByRole('button', { name: 'Save locally' }).click()
  await browserPage.getByText('Edited PDF saved on this device.').waitFor()
  await browserPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await browserPage.locator('.saved-document-row').filter({ hasText: 'edited-table.pdf' }).getByRole('link', { name: 'Edit' }).click()
  await browserPage.locator('.pdf-text-item').getByText('Saved note').waitFor()

  const presentation = new PptxGenJS()
  const firstSlide = presentation.addSlide()
  firstSlide.addText('Slide one heading', { x: 1, y: 1, w: 7, h: 1, fontSize: 25, bold: true })
  firstSlide.addShape(presentation.ShapeType.rect, { x: 1, y: 3, w: 3, h: 1, fill: { color: 'FF0000' } })
  firstSlide.addImage({ data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', x: 5, y: 3, w: 1, h: 1 })
  presentation.addSlide().addText('Slide two heading', { x: 1, y: 1, w: 7, h: 1 })
  const presentationBytes = await presentation.write({ outputType: 'nodebuffer' })
  await browserPage.goto(`${baseUrl}/powerpoint-to-pdf`, { waitUntil: 'networkidle' })
  await browserPage.locator('input[type="file"]').setInputFiles({ name: 'slides.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: presentationBytes })
  const slideDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Convert and download' }).click()
  const slideDownload = await slideDownloadPromise
  const slidePath = join(temp, 'slides.pdf')
  await slideDownload.saveAs(slidePath)
  const slidePdf = await getDocument({ data: new Uint8Array(await readFile(slidePath)) }).promise
  if (slidePdf.numPages !== 2) throw new Error('PowerPoint slide count was not preserved')
  const slideOneText = (await (await slidePdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  const slideTwoText = (await (await slidePdf.getPage(2)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!slideOneText.includes('Slide one heading') || !slideTwoText.includes('Slide two heading')) throw new Error('PowerPoint slide text was lost')

  await browserPage.goto(`${baseUrl}/csv-to-pdf`, { waitUntil: 'networkidle' })
  await browserPage.locator('.composer-editor').fill('Name,Qty,Price\n"Apple, red",2,12\nPear,3,15')
  await browserPage.getByRole('checkbox', { name: 'Qty' }).uncheck()
  await browserPage.getByRole('combobox', { name: 'Page orientation' }).selectOption('landscape')
  const csvPdfPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'Create table PDF' }).click()
  const csvPdfDownload = await csvPdfPromise
  const csvPdfPath = join(temp, 'csv.pdf')
  await csvPdfDownload.saveAs(csvPdfPath)
  const csvPdf = await getDocument({ data: new Uint8Array(await readFile(csvPdfPath)) }).promise
  const csvPage = await csvPdf.getPage(1)
  const csvText = (await csvPage.getTextContent()).items.map((item) => item.str).join(' ')
  if (!csvText.includes('Apple, red') || csvText.includes('Qty') || csvPage.view[2] <= csvPage.view[3]) throw new Error('CSV table, column selection, or landscape page failed')

  for (const [route, content] of [
    ['markdown-to-pdf', '# Rich heading\n\n| Item | Price |\n| --- | --- |\n| Apple | 12 |'],
    ['html-to-pdf', '<h1>Rich heading</h1><table><tr><th>Item</th><th>Price</th></tr><tr><td>Apple</td><td>12</td></tr></table>'],
  ]) {
    await browserPage.goto(`${baseUrl}/${route}`, { waitUntil: 'networkidle' })
    await browserPage.locator('.composer-editor').fill(content)
    const richDownloadPromise = browserPage.waitForEvent('download')
    await browserPage.getByRole('button', { name: 'Create PDF' }).click()
    const richDownload = await richDownloadPromise
    const richPath = join(temp, `${route}.pdf`)
    await richDownload.saveAs(richPath)
    const richPdf = await getDocument({ data: new Uint8Array(await readFile(richPath)) }).promise
    const richText = (await (await richPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
    if (!['Rich heading', 'Item', 'Price', 'Apple', '12'].every((value) => richText.includes(value))) throw new Error(`${route} lost structured content`)
  }

  await browserPage.goto(`${baseUrl}/gst-invoice`, { waitUntil: 'networkidle' })
  await browserPage.getByRole('textbox', { name: 'Trade / Brand Name' }).fill('शिव Stores')
  await browserPage.getByRole('button', { name: 'Invoice', exact: true }).click()
  await browserPage.getByRole('combobox', { name: 'Invoice Type' }).selectOption('bill-of-supply')
  await browserPage.getByRole('button', { name: 'Items', exact: true }).click()
  await browserPage.locator('tbody tr').first().locator('input').first().fill('आम')
  await browserPage.locator('tbody tr').first().locator('input').nth(5).fill('100')
  const invoiceDownloadPromise = browserPage.waitForEvent('download', { timeout: 10000 }).catch(() => null)
  await browserPage.getByRole('button', { name: 'Download PDF Invoice' }).click()
  const invoiceMessage = await browserPage.locator('.toast-message').first().textContent({ timeout: 10000 }).catch(() => '')
  const invoiceDownload = await invoiceDownloadPromise
  if (!invoiceDownload) throw new Error(`Invoice not downloaded: ${invoiceMessage}`)
  const invoicePath = join(temp, 'invoice.pdf')
  await invoiceDownload.saveAs(invoicePath)
  const invoicePdf = await getDocument({ data: new Uint8Array(await readFile(invoicePath)) }).promise
  const invoiceText = (await (await invoicePdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!invoiceText.includes('BILL OF SUPPLY') || !invoiceText.includes('आम') || invoiceText.includes('CreatePDF.si')) throw new Error('Invoice export lost the selected type, Unicode text, or added branding')

  await browserPage.goto(`${baseUrl}/pos-billing`, { waitUntil: 'networkidle' })
  await browserPage.getByRole('button', { name: 'Product', exact: true }).click()
  await browserPage.getByRole('textbox', { name: 'Name', exact: true }).fill('\u0906\u092e')
  await browserPage.getByRole('spinbutton', { name: 'Price' }).fill('75')
  await browserPage.getByRole('button', { name: 'Save product' }).click()
  await browserPage.getByRole('button', { name: /\u0906\u092e/ }).first().click()
  await browserPage.getByPlaceholder('Customer name').fill('\u0936\u093f\u0935')
  await browserPage.getByPlaceholder('Order reference').fill('ORDER-42')
  await browserPage.getByPlaceholder('Item note').fill('Ripe fruit')
  const receiptDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByRole('button', { name: 'PDF Bill' }).click()
  const receiptDownload = await receiptDownloadPromise
  const receiptPath = join(temp, 'receipt.pdf')
  await receiptDownload.saveAs(receiptPath)
  const receiptPdf = await getDocument({ data: new Uint8Array(await readFile(receiptPath)) }).promise
  const receiptText = (await (await receiptPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!['\u0906\u092e', 'ORDER-42', 'Ripe fruit'].every((value) => receiptText.includes(value)) || !(receiptText.includes('\u0936\u093f\u0935') || receiptText.includes('\u093f\u0936\u0935'))) throw new Error(`POS receipt lost Unicode, customer, reference, or item note: ${receiptText}`)
  await browserPage.getByRole('button', { name: 'Bills', exact: true }).click()
  const savedDownloadPromise = browserPage.waitForEvent('download')
  await browserPage.getByTitle('Download saved PDF').first().click()
  const savedDownload = await savedDownloadPromise
  if (savedDownload.suggestedFilename() !== receiptDownload.suggestedFilename()) throw new Error('Saved receipt changed bill number')

  await browserPage.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' })
  if (await browserPage.getByRole('button', { name: 'Export app data' }).count() || await browserPage.getByText('Import app data', { exact: true }).count() || await browserPage.getByRole('button', { name: 'Keep data on this device' }).count()) throw new Error('Removed settings actions reappeared')
  browserPage.once('dialog', (dialog) => dialog.accept())
  const clearReload = browserPage.waitForEvent('load')
  await browserPage.getByRole('button', { name: 'Clear all local data' }).click()
  await clearReload
  await browserPage.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' })
  if (await browserPage.locator('.settings-document').count()) throw new Error('Clear local data left saved documents behind')

  await browserPage.evaluate(() => navigator.serviceWorker.ready)
  await browserPage.context().setOffline(true)
  await browserPage.goto(`${baseUrl}/gst-invoice`, { waitUntil: 'domcontentloaded' })
  await browserPage.locator('.tool-page-title').getByText('GST Invoice Generator').waitFor()
  await browserPage.context().setOffline(false)

  const senderPage = await browser.newPage({ acceptDownloads: true })
  const receiverPage = await browser.newPage({ acceptDownloads: true })
  await Promise.all([
    senderPage.goto(`${baseUrl}/p2p-share`, { waitUntil: 'networkidle' }),
    receiverPage.goto(`${baseUrl}/p2p-share`, { waitUntil: 'networkidle' }),
  ])
  await senderPage.locator('.signal-room').fill('SMOKETEST123')
  await receiverPage.locator('.signal-room').fill('SMOKETEST123')
  await senderPage.getByRole('button', { name: 'Create room' }).click()
  await receiverPage.getByRole('button', { name: 'Join room' }).click()
  await Promise.all([
    senderPage.getByText('Direct connection ready').waitFor({ timeout: 15000 }),
    receiverPage.getByText('Direct connection ready').waitFor({ timeout: 15000 }),
  ])
  await senderPage.locator('input[type="file"]').setInputFiles({ name: 'peer.txt', mimeType: 'text/plain', buffer: Buffer.from('peer transfer works') })
  await senderPage.getByRole('button', { name: 'Send directly' }).click()
  const peerDownloadPromise = receiverPage.waitForEvent('download')
  await receiverPage.getByRole('button', { name: 'Download peer.txt' }).click()
  const peerDownload = await peerDownloadPromise
  const peerPath = join(temp, 'peer.txt')
  await peerDownload.saveAs(peerPath)
  if ((await readFile(peerPath, 'utf8')) !== 'peer transfer works') throw new Error('P2P file bytes changed in transit')
  await senderPage.close()
  await receiverPage.close()
  if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`)
  process.stdout.write('Word/Excel/CSV/PPTX conversions, PDF editing, page halves, colour modes, thumbmark, rich exports, invoice, POS, data clearing, offline routes, and P2P transfer validated.\n')
} finally {
  await browser?.close()
  server.kill()
  await rm(temp, { recursive: true, force: true })
}
