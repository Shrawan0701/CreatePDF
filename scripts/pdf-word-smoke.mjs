import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'
import JSZip from 'jszip'

const origin = 'http://127.0.0.1:4198'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4198', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Vite starting. */ }
    if (attempt > 120) throw new Error('Vite failed to start')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const times = await pdf.embedFont(StandardFonts.TimesRoman)
  const timesBold = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic)
  const page = pdf.addPage([842, 595])
  page.drawText('Sales report', { x: 36, y: 550, size: 20, font: bold })
  const headings = ['Order ID', 'Date', 'Customer', 'Product', 'Qty', 'Price', 'Total', 'Status']
  const xs = [36, 122, 212, 322, 452, 502, 582, 662, 806]
  const ys = [510, 482, 434, 386, 338]
  const rows = [headings, ['ORD-1', '2026-10-01', 'Alex Sharma', 'Mechanical\nKeyboard', '2', '599.00', '1198.00', 'Delivered'], ['ORD-2', '2026-10-02', 'Priya Patel', 'Wireless\nMouse', '0', '0.00', '0.00', 'Cancelled'], ['ORD-3', '2026-10-03', 'Rohan Mehta', 'USB Cable', '3', '299.00', '897.00', 'Shipped']]
  for (let row = 0; row < rows.length; row++) for (let col = 0; col < headings.length; col++) {
    page.drawRectangle({ x: xs[col], y: ys[row + 1], width: xs[col + 1] - xs[col], height: ys[row] - ys[row + 1], borderWidth: .5, borderColor: rgb(.6, .6, .6), color: row === 0 ? rgb(.94, .95, .97) : rgb(1, 1, 1) })
    rows[row][col].split('\n').forEach((value, line) => page.drawText(value, { x: xs[col] + 5, y: ys[row] - 16 - line * 13, size: 10, font: row === 0 ? bold : regular }))
  }
  page.drawText('Report footer', { x: 36, y: 50, size: 10, font: regular })
  const letter = pdf.addPage([595, 842])
  letter.drawText('EXAMPLE COMPANY', { x: 190, y: 790, size: 18, font: timesBold })
  letter.drawLine({ start: { x: 48, y: 760 }, end: { x: 547, y: 760 }, thickness: .5, color: rgb(0, 0, 0) })
  letter.drawRectangle({ x: 48, y: 120, width: 499, height: .6, color: rgb(0, 0, 0) })
  letter.drawSvgPath('M 0 0 C 10 20 35 -20 50 0 C 40 15 10 15 25 -5 L 65 8', { x: 65, y: 250, borderColor: rgb(0, 0, 0), borderWidth: 1.3 })
  letter.drawText('Dear Reader,', { x: 48, y: 700, size: 11, font: times })
  letter.drawText('This letter keeps its original spacing and typography.', { x: 48, y: 660, size: 11, font: times })
  letter.drawText('An italic note', { x: 48, y: 630, size: 11, font: italic })
  letter.drawText('DIRECTOR ONE', { x: 48, y: 210, size: 11, font: timesBold })
  letter.drawText('DIRECTOR TWO', { x: 350, y: 210, size: 11, font: timesBold })
  letter.drawText('support@example.com', { x: 48, y: 110, size: 11, font: times })
  letter.drawText('Project website', { x: 48, y: 90, size: 11, font: times })
  const annotations = []
  for (const [url, rect] of [['mailto:support@example.com', [48, 108, 160, 122]], ['https://example.com/project', [48, 88, 125, 102]]]) {
    annotations.push(pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(url) } })))
  }
  letter.node.set(PDFName.of('Annots'), pdf.context.obj(annotations))
  const logo = await pdf.embedPng(await readFile('public/icons/createpdf-f4545349bb-icon192.png'))
  letter.drawImage(logo, { x: 250, y: 240, width: 55, height: 55 })
  const scan = pdf.addPage([595, 842])
  scan.drawImage(logo, { x: 100, y: 300, width: 300, height: 300 })

  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const tab = await browser.newPage({ acceptDownloads: true })
  const errors = []
  tab.on('pageerror', error => errors.push(error.message))
  await tab.goto(`${origin}/pdf-to-word`, { waitUntil: 'networkidle' })
  assert.ok(await tab.getByRole('button', { name: 'Download DOCX' }).isDisabled())
  await tab.locator('input[type=file]').setInputFiles({ name: 'layout-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  if (process.env.PDF_WORD_DEBUG) await tab.evaluate(async bytes => {
    const { pdfToWord } = await import('/src/services/pdfToWord.js')
    await pdfToWord(new File([new Uint8Array(bytes)], 'sample.pdf', { type: 'application/pdf' }))
  }, Array.from(await pdf.save()))
  const download = async () => {
    const pending = tab.waitForEvent('download')
    await tab.getByRole('button', { name: 'Download DOCX', exact: true }).click()
    const file = await pending.catch(async error => { throw new Error(`${error.message}; UI: ${await tab.locator('.pdf-preview-error').allTextContents()}`) })
    const bytes = await readFile(await file.path())
    const archive = await JSZip.loadAsync(bytes)
    return { bytes, archive, xml: await archive.file('word/document.xml').async('string'), name: file.suggestedFilename() }
  }
  let doc = await download()
  assert.equal(doc.name, 'layout-test.docx')
  const info = await tab.evaluate(async xml => {
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    const elements = (node, name) => [...node.getElementsByTagNameNS(ns, name)]
    return { tables: elements(document, 'tbl').map(table => elements(table, 'tr').map(row => elements(row, 'tc').map(cell => elements(cell, 't').map(t => t.textContent).join(' ')))), sections: elements(document, 'pgSz').map(size => ({ width: size.getAttributeNS(ns, 'w'), height: size.getAttributeNS(ns, 'h') })), frames: elements(document, 'framePr').length, bold: elements(document, 'b').length, italic: elements(document, 'i').length }
  }, doc.xml)
  assert.equal(info.tables.length, 1)
  assert.equal(info.tables[0].length, 4)
  assert.equal(info.tables[0][1].length, 8)
  assert.equal(info.tables[0][1][3], 'Mechanical Keyboard')
  assert.equal(info.tables[0][2][3], 'Wireless Mouse')
  assert.equal(info.tables[0][2][4], '0')
  assert.deepEqual(info.sections, [{ width: '16840', height: '11900' }, { width: '11900', height: '16840' }, { width: '11900', height: '16840' }])
  assert.ok(info.frames >= 6 && info.bold > 0 && info.italic > 0)
  assert.ok(doc.xml.includes('Times New Roman'))
  assert.ok(doc.xml.includes('behindDoc="1"'), 'Original PDF drawings were not retained behind the editable text')
  const relationships = await doc.archive.file('word/_rels/document.xml.rels').async('string')
  assert.ok(doc.xml.includes('<w:hyperlink'), 'PDF links were not retained as Word hyperlinks')
  assert.ok(relationships.includes('mailto:support@example.com') && relationships.includes('https://example.com/project'), 'PDF email and website links lost their targets')
  assert.equal(Object.keys(doc.archive.files).filter(name => /^word\/media\/.*\.png$/.test(name)).length, 2)
  const pictures = await Promise.all(Object.keys(doc.archive.files).filter(name => /^word\/media\/.*\.png$/.test(name)).map(async name => Array.from(await doc.archive.file(name).async('uint8array'))))
  const drawingCheck = await tab.evaluate(async pictures => {
    for (const bytes of pictures) {
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
      if (bitmap.width !== 1190 || bitmap.height !== 1684) { bitmap.close(); continue }
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height
      const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close()
      const ink = (x, y, width, height) => {
        const pixels = context.getImageData(x * 2, y * 2, width * 2, height * 2).data
        let count = 0
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 30 && pixels[index] < 180 && pixels[index + 1] < 180 && pixels[index + 2] < 180) count++
        return count
      }
      return { header: ink(48, 80, 499, 5), footer: ink(48, 719, 499, 6), signature: ink(55, 565, 90, 60), duplicatedText: ink(180, 30, 260, 40) }
    }
    return null
  }, pictures)
  assert.ok(drawingCheck?.header > 400 && drawingCheck.footer > 400 && drawingCheck.signature > 20, `Missing line or vector signature: ${JSON.stringify(drawingCheck)}`)
  assert.equal(drawingCheck.duplicatedText, 0, 'The drawing layer must not duplicate editable PDF text')
  for (const value of ['Report footer', 'EXAMPLE COMPANY', 'Dear Reader,', 'DIRECTOR ONE', 'DIRECTOR TWO']) assert.ok(doc.xml.includes(value))
  if (process.env.PDF_WORD_ROUNDTRIP) {
    const directory = await mkdtemp(join(tmpdir(), 'createpdf-word-roundtrip-'))
    const input = join(directory, 'layout.docx')
    await writeFile(input, doc.bytes)
    console.log(`Roundtrip input: ${input}`)
    const { createWasmExporter } = await import('../server/wordWasm.js')
    const converter = createWasmExporter()
    try {
      const output = await converter(doc.bytes, message => console.log(message), 'layout.docx')
      await writeFile(join(directory, 'layout.pdf'), output)
      console.log(`Roundtrip output: ${join(directory, 'layout.pdf')}`)
      const rendered = await tab.evaluate(async bytes => {
        const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
        const task = (await getPdfjsLib()).getDocument({ data: new Uint8Array(bytes) })
        try {
          const pdf = await task.promise
          const result = []
          for (let index = 1; index <= pdf.numPages; index++) {
            const page = await pdf.getPage(index)
            const viewport = page.getViewport({ scale: 1 })
            const canvas = document.createElement('canvas')
            canvas.width = viewport.width; canvas.height = viewport.height
            await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
            const ink = (x, y, width, height) => {
              const pixels = canvas.getContext('2d').getImageData(x, y, width, height).data
              let count = 0
              for (let offset = 0; offset < pixels.length; offset += 4) if (pixels[offset] < 245 && pixels[offset + 1] < 245 && pixels[offset + 2] < 245) count++
              return count
            }
            result.push({ width: viewport.width, height: viewport.height, text: (await page.getTextContent()).items.map(item => item.str).join(' '), drawings: index === 2 ? { header: ink(48, 80, 499, 6), footer: ink(48, 719, 499, 7), signature: ink(55, 565, 90, 60) } : null, png: canvas.toDataURL('image/png').split(',')[1] })
          }
          return result
        } finally { await task.destroy() }
      }, Array.from(output))
      console.log(JSON.stringify(rendered.map(({ width, height, text }) => ({ width, height, text }))))
      for (const [index, page] of rendered.entries()) await writeFile(join(directory, `roundtrip-${index + 1}.png`), Buffer.from(page.png, 'base64'))
      assert.equal(rendered.length, 3, 'Word renderer added or lost pages')
      assert.ok(rendered[0].text.includes('Mechanical') && rendered[0].text.includes('Keyboard') && rendered[0].text.includes('Report footer'))
      assert.ok(rendered[1].text.includes('EXAMPLE COMPANY') && rendered[1].text.includes('DIRECTOR TWO'))
      assert.ok(rendered[1].drawings.header > 150 && rendered[1].drawings.footer > 150 && rendered[1].drawings.signature > 10, `Word dropped drawings: ${JSON.stringify(rendered[1].drawings)}`)
    } finally { await converter.destroy() }
  }
  await tab.getByRole('textbox', { name: 'Pages', exact: true }).fill('2')
  doc = await download()
  assert.ok(doc.xml.includes('EXAMPLE COMPANY') && !doc.xml.includes('ORD-1'))
  assert.equal((doc.xml.match(/<w:sectPr>/g) || []).length, 1)
  await tab.getByRole('combobox', { name: 'Conversion mode' }).selectOption('appearance')
  doc = await download()
  assert.ok(!doc.xml.includes('EXAMPLE COMPANY'))
  assert.equal(Object.keys(doc.archive.files).filter(name => /^word\/media\/.*\.png$/.test(name)).length, 1)
  await tab.getByRole('textbox', { name: 'Pages', exact: true }).fill('99')
  await tab.getByRole('button', { name: 'Download DOCX' }).click()
  await tab.getByRole('alert').filter({ hasText: 'Choose pages between 1 and 3.' }).waitFor()
  await tab.setViewportSize({ width: 390, height: 844 })
  assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.deepEqual(errors, [])
  console.log('PDF to Word checks passed: wrapped editable tables, fonts, spacing, images, scanned pages, page sizes, page selection, appearance mode, and mobile.')
} finally {
  await browser?.close()
  server.kill()
}
