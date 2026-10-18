import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { AlignmentType, Document, ExternalHyperlink, ImageRun, Packer, PageBreak, Paragraph, TextRun } from 'docx'

const port = 4182
const baseUrl = `http://127.0.0.1:${port}`
const temporary = await mkdtemp(join(tmpdir(), 'createpdf-exports-'))
const server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
let browser

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${baseUrl}/health`)).ok) { ready = true; break } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('Export smoke server did not start.')
  const source = await PDFDocument.create()
  const font = await source.embedFont(StandardFonts.Helvetica)
  const first = source.addPage([595, 842])
  first.drawText('Report title', { x: 45, y: 780, size: 20, font })
  for (const [index, row] of [['Name', 'Qty', 'Price'], ['Apple', '2', '12'], ['Pear', '3', '15']].entries()) {
    row.forEach((value, column) => first.drawText(value, { x: [45, 230, 420][column], y: 720 - index * 25, size: 11, font }))
  }
  const annotation = source.context.register(source.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [45, 770, 200, 800], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/report?x=1&y=2') } }))
  first.node.set(PDFName.of('Annots'), source.context.obj([annotation]))
  const second = source.addPage([842, 595])
  second.drawText('Second chapter', { x: 45, y: 520, size: 22, font })
  second.drawText('Landscape content', { x: 45, y: 480, size: 11, font })
  const sourceBytes = Buffer.from(await source.save())
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  const openTool = async (route) => {
    await page.goto(`${baseUrl}/${route}`, { waitUntil: 'networkidle' })
    await page.locator('input[type="file"]').first().setInputFiles({ name: 'report & notes.pdf', mimeType: 'application/pdf', buffer: sourceBytes })
  }
  const download = async (button, name) => {
    const pending = page.waitForEvent('download')
    const failed = page.locator('.toast-error .toast-message').first().textContent({ timeout: 30000 }).then((message) => { throw new Error(`${button}: ${message}`) })
    await page.getByRole('button', { name: button, exact: true }).click()
    const result = await Promise.race([pending, failed])
    const path = join(temporary, name)
    await result.saveAs(path)
    return readFile(path)
  }

  await openTool('pdf-to-html')
  const singleHtml = (await download('Download HTML', 'pages.html')).toString('utf8')
  if (!singleHtml.includes('Report title') || !singleHtml.includes('Second chapter') || !singleHtml.includes('href="https://example.com/report?x=1&amp;y=2"')) throw new Error('HTML lost text or links')
  const htmlPage = await browser.newPage()
  const remoteRequests = []
  htmlPage.on('request', (request) => { if (/^https?:/.test(request.url())) remoteRequests.push(request.url()) })
  await htmlPage.setContent(singleHtml)
  await htmlPage.waitForFunction(() => [...document.images].length === 2 && [...document.images].every((image) => image.complete && image.naturalWidth > 0))
  if ((await htmlPage.locator('.pdf-page').count()) !== 2 || remoteRequests.length) throw new Error('HTML layout failed or loaded remote assets')
  await htmlPage.close()
  await page.getByRole('checkbox', { name: 'Package HTML and page images in a ZIP' }).check()
  const htmlZip = await JSZip.loadAsync(await download('Download ZIP', 'pages.zip'))
  if (!htmlZip.file('index.html') || !htmlZip.file('assets/page-1.png') || !htmlZip.file('assets/page-2.png')) throw new Error('HTML package omitted page assets')

  await openTool('pdf-to-epub')
  await page.getByRole('textbox', { name: 'Book title' }).fill('Report & Notes')
  await page.getByRole('combobox', { name: 'Reading font' }).selectOption('sans-serif')
  await page.getByRole('spinbutton', { name: 'Text size (%)' }).fill('120')
  const epubBytes = await download('Download EPUB', 'book.epub')
  if (epubBytes.readUInt16LE(8) !== 0 || epubBytes.subarray(30, 38).toString() !== 'mimetype') throw new Error('EPUB mimetype is not first and uncompressed')
  const epub = await JSZip.loadAsync(epubBytes)
  const packageXml = await epub.file('EPUB/content.opf')?.async('string')
  const navigation = await epub.file('EPUB/nav.xhtml')?.async('string')
  const chapter = await epub.file('EPUB/page-1.xhtml')?.async('string')
  const stylesheet = await epub.file('EPUB/styles.css')?.async('string')
  if (!packageXml?.includes('properties="nav"') || !packageXml.includes('dcterms:modified') || !navigation?.includes('page-2.xhtml') || !chapter?.includes('<table>') || !stylesheet?.includes('font-size:120%')) throw new Error('EPUB lost navigation, structure, metadata, or reading settings')
  const xmlFiles = await Promise.all(Object.values(epub.files).filter((entry) => /\.(xhtml|opf|xml)$/.test(entry.name)).map((entry) => entry.async('string')))
  const validXml = await page.evaluate((sources) => sources.every((source) => !new DOMParser().parseFromString(source, 'application/xml').querySelector('parsererror')), xmlFiles)
  if (!validXml) throw new Error('EPUB contains malformed XML')
  await page.getByRole('combobox', { name: 'Reading layout' }).selectOption('pages')
  const imageEpub = await JSZip.loadAsync(await download('Download EPUB', 'image-book.epub'))
  if (!imageEpub.file('EPUB/page-1.png') || !imageEpub.file('EPUB/page-2.png') || !(await imageEpub.file('EPUB/page-1.xhtml')?.async('string'))?.includes('<img')) throw new Error('EPUB page-image mode omitted page images')
  if (process.env.EPUBCHECK_JAR) {
    for (const filename of ['book.epub', 'image-book.epub']) {
      const validation = spawn('java', ['-jar', process.env.EPUBCHECK_JAR, join(temporary, filename)])
      let report = ''
      validation.stdout.on('data', (chunk) => { report += chunk.toString() })
      validation.stderr.on('data', (chunk) => { report += chunk.toString() })
      const exitCode = await new Promise((resolve, reject) => { validation.on('close', resolve); validation.on('error', reject) })
      if (exitCode !== 0) throw new Error(`EPUBCheck failed for ${filename}: ${report}`)
      process.stdout.write(report)
    }
  }

  await openTool('pdf-to-ppt')
  const presentation = await JSZip.loadAsync(await download('Download PPTX', 'slides.pptx'))
  const presentationXml = await presentation.file('ppt/presentation.xml')?.async('string')
  const dimensions = presentationXml?.match(/<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/)
  if (!dimensions || Math.abs(Number(dimensions[1]) / Number(dimensions[2]) - 595 / 842) > .001) throw new Error('PDF presentation changed the first page aspect ratio')
  const landscapeXml = await presentation.file('ppt/slides/slide2.xml')?.async('string')
  const imageDimensions = landscapeXml?.match(/<a:ext cx="(\d+)" cy="(\d+)"/)
  if (!imageDimensions || Math.abs(Number(imageDimensions[1]) / Number(imageDimensions[2]) - 842 / 595) > .001) throw new Error('Landscape PDF page was stretched in its slide')

  await openTool('pdf-to-excel')
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('1')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await download('Download XLSX', 'tables.xlsx'))
  const sheet = workbook.worksheets[0]
  if (workbook.worksheets.length !== 1 || sheet.getCell('A1').value !== 'Name' || sheet.getCell('B2').value !== '2' || sheet.getCell('C3').value !== '15') throw new Error('Excel page selection or table columns failed')
  await page.getByRole('combobox', { name: 'Output format' }).selectOption('csv')
  const csv = (await download('Download CSV', 'tables.csv')).toString('utf8')
  if (!csv.includes('"Name","Qty","Price"') || !csv.includes('"Apple","2","12"')) throw new Error('PDF table CSV export lost columns')
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('99')
  await page.getByRole('button', { name: 'Download CSV' }).click()
  await page.locator('.toast-error').filter({ hasText: 'Page selection must be between' }).waitFor()

  await page.goto(`${baseUrl}/markdown-to-pdf`, { waitUntil: 'networkidle' })
  const markdown = '# Imported heading\n\n[Open report](https://example.com/report)\n\n' + Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1} contains readable text.`).join('\n\n')
  await page.locator('input[type="file"]').setInputFiles({ name: 'document.md', mimeType: 'text/markdown', buffer: Buffer.from(markdown) })
  await page.getByRole('combobox', { name: 'Page size', exact: true }).selectOption('Letter')
  await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('landscape')
  await page.getByRole('spinbutton', { name: 'Margins (points)' }).fill('60')
  await page.getByRole('textbox', { name: 'Header', exact: true }).fill('Company report')
  await page.getByRole('textbox', { name: 'Footer', exact: true }).fill('Page {page} of {total}')
  const markdownBytes = await download('Download PDF', 'markdown.pdf')
  const markdownPdf = await getDocument({ data: new Uint8Array(markdownBytes), useSystemFonts: true }).promise
  const markdownFirst = await markdownPdf.getPage(1)
  const markdownText = (await markdownFirst.getTextContent()).items.map((item) => item.str).join(' ')
  const markdownLinks = await markdownFirst.getAnnotations()
  if (markdownPdf.numPages < 2 || markdownFirst.view[2] !== 792 || markdownFirst.view[3] !== 612 || !markdownText.includes('Company report') || !markdownText.includes(`Page 1 of ${markdownPdf.numPages}`) || !markdownLinks.some((link) => link.url === 'https://example.com/report')) throw new Error('Markdown import lost page layout, running text, or clickable links')
  await markdownPdf.loadingTask.destroy()

  await page.goto(`${baseUrl}/html-to-pdf`, { waitUntil: 'networkidle' })
  const previewRemoteRequests = []
  await page.route('https://example.com/**', (route) => { previewRemoteRequests.push(route.request().url()); route.abort() })
  await page.locator('.composer-editor').fill('<h1>Safe import</h1><p>Local content</p><img src="https://example.com/remote.png"><div style="background-image:url(https://example.com/remote.jpg)">Safe body</div><script>alert(1)</script>')
  await page.locator('.pdf-preview-viewport canvas[data-rendered-page="1"]').waitFor()
  if (await page.locator('.pdf-preview-viewport img, .pdf-preview-viewport script').count() || previewRemoteRequests.length) throw new Error('HTML preview loaded an unexpected remote resource')
  const safeHtmlBytes = await download('Create PDF', 'safe-html.pdf')
  if ((await PDFDocument.load(safeHtmlBytes)).getPageCount() !== 1) throw new Error('Sanitized HTML did not produce a PDF')
  await page.locator('.composer-editor').fill(`<table><tr><th>Description</th><th>Amount</th></tr><tr><td>${'Long table cell content '.repeat(650)} EndOfLongCell</td><td>99</td></tr></table>`)
  const longTablePdf = await getDocument({ data: new Uint8Array(await download('Create PDF', 'long-table.pdf')), useSystemFonts: true }).promise
  let longTableText = ''
  for (let pageNumber = 1; pageNumber <= longTablePdf.numPages; pageNumber++) {
    const content = await (await longTablePdf.getPage(pageNumber)).getTextContent()
    if (content.items.some((item) => item.str?.trim() && item.transform[5] < 35)) throw new Error('Long table cell overflowed below the page margin')
    longTableText += content.items.map((item) => item.str).join(' ')
  }
  if (longTablePdf.numPages < 2 || !longTableText.includes('EndOfLongCell')) throw new Error('Long table cell content was clipped')
  await longTablePdf.loadingTask.destroy()

  await page.goto(`${baseUrl}/ebook-to-pdf`, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"]').setInputFiles({ name: 'book.epub', mimeType: 'application/epub+zip', buffer: epubBytes })
  await page.getByText('Edit book content', { exact: true }).click()
  await page.locator('.ebook-editor').getByText('Report title', { exact: true }).waitFor()
  const bookPdf = await getDocument({ data: new Uint8Array(await download('Download PDF', 'ebook.pdf')), useSystemFonts: true }).promise
  const bookFirstText = (await (await bookPdf.getPage(1)).getTextContent()).items.map((item) => item.str).join(' ')
  const bookSecondText = (await (await bookPdf.getPage(2)).getTextContent()).items.map((item) => item.str).join(' ')
  if (!bookFirstText.includes('Report title') || !bookSecondText.includes('Second chapter')) throw new Error('EPUB import changed chapter order or page breaks')
  await bookPdf.loadingTask.destroy()
  await page.locator('input[type="file"]').setInputFiles({ name: 'images.epub', mimeType: 'application/epub+zip', buffer: await readFile(join(temporary, 'image-book.epub')) })
  await page.waitForFunction(() => document.querySelectorAll('.ebook-editor img').length === 2)
  const imageBookPdf = await PDFDocument.load(await download('Download PDF', 'image-ebook.pdf'))
  const embeddedImages = imageBookPdf.context.enumerateIndirectObjects().filter(([, object]) => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image')
  if (embeddedImages.length < 2) throw new Error('EPUB import omitted local chapter images')

  await page.goto(`${baseUrl}/resume-builder`, { waitUntil: 'networkidle' })
  await page.getByRole('textbox', { name: 'Full name' }).fill('Alex Engineer')
  await page.getByRole('textbox', { name: 'Professional title' }).fill('Developer')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('alex@example.com')
  await page.getByRole('button', { name: 'Add experience', exact: true }).click()
  await page.getByRole('textbox', { name: 'Experience bullets', exact: true }).fill(Array.from({ length: 60 }, (_, index) => `Role ${index + 1}: Built reliable document software with detailed project delivery.`).join('\n'))
  await page.locator('details.resume-builder-section').filter({ has: page.locator('summary').filter({ hasText: 'Projects' }) }).locator('summary').click()
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  await page.getByRole('textbox', { name: 'Project bullets', exact: true }).fill('Final project sentinel')
  await page.getByRole('combobox', { name: 'Template', exact: true }).selectOption('classic')
  await page.getByRole('button', { name: 'Save locally' }).click()
  await page.getByText('Resume saved locally.').waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('details.resume-builder-section').filter({ has: page.locator('summary').filter({ hasText: 'Projects' }) }).locator('summary').click()
  if (await page.getByRole('combobox', { name: 'Template', exact: true }).inputValue() !== 'classic' || await page.getByRole('textbox', { name: 'Project bullets', exact: true }).innerText() !== 'Final project sentinel') throw new Error('Resume template or project data was not restored')
  const resumePdf = await getDocument({ data: new Uint8Array(await download('Download PDF', 'resume.pdf')), useSystemFonts: true }).promise
  let resumeText = ''
  for (let pageNumber = 1; pageNumber <= resumePdf.numPages; pageNumber++) resumeText += (await (await resumePdf.getPage(pageNumber)).getTextContent()).items.map((item) => item.str).join(' ')
  if (resumePdf.numPages < 2 || !resumeText.includes('Alex Engineer') || !resumeText.includes('Final project sentinel')) throw new Error('Long resume export clipped content')
  await resumePdf.loadingTask.destroy()

  const wordDocument = new Document({ sections: [{ properties: { page: { size: { width: 12240, height: 15840 } } }, children: [
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Centered Word title', bold: true, size: 40 })] }),
    new Paragraph({ children: [new ExternalHyperlink({ link: 'https://example.com/word', children: [new TextRun('Report link')] })] }),
    new Paragraph({ children: [new ImageRun({ type: 'png', data: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), transformation: { width: 160, height: 80 } })] }),
    new Paragraph({ children: [new PageBreak(), new TextRun('After explicit break')] }),
  ] }] })
  await page.goto(`${baseUrl}/word-to-pdf`, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"]').setInputFiles({ name: 'structured.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await Packer.toBuffer(wordDocument) })
  const wordBytes = await download('Convert and download', 'structured-word.pdf')
  const wordPdf = await getDocument({ data: new Uint8Array(wordBytes), useSystemFonts: true }).promise
  const wordFirst = await wordPdf.getPage(1)
  const wordFirstItems = (await wordFirst.getTextContent()).items
  const wordSecondText = (await (await wordPdf.getPage(2)).getTextContent()).items.map((item) => item.str).join(' ')
  const wordAnnotations = await wordFirst.getAnnotations()
  const wordImagePdf = await PDFDocument.load(wordBytes)
  if (wordPdf.numPages !== 2 || wordFirst.view[2] !== 612 || !wordFirstItems.some((item) => item.str === 'Centered Word title' && item.transform[4] > 100) || !wordSecondText.includes('After explicit break') || !wordAnnotations.some((link) => link.url === 'https://example.com/word') || !wordImagePdf.context.enumerateIndirectObjects().some(([, object]) => object.dict?.get(PDFName.of('Subtype'))?.toString() === '/Image')) throw new Error('Word import lost source page size, alignment, link, image, or explicit page break')
  await wordPdf.loadingTask.destroy()

  const sourceWorkbook = new ExcelJS.Workbook()
  const sales = sourceWorkbook.addWorksheet('Sales')
  sales.addRow(['Description', 'Value'])
  sales.addRow(['Zero cached result', { formula: '1-1', result: 0 }])
  sales.addRow(['Formula error', { formula: '1/0', result: { error: '#DIV/0!' } }])
  sourceWorkbook.addWorksheet('Summary').addRow(['Summary sentinel'])
  sourceWorkbook.addWorksheet('Private', { state: 'hidden' }).addRow(['Hidden sentinel'])
  await page.goto(`${baseUrl}/excel-to-pdf`, { waitUntil: 'networkidle' })
  await page.locator('input[type="file"]').setInputFiles({ name: 'print.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await sourceWorkbook.xlsx.writeBuffer()) })
  await page.getByRole('checkbox', { name: 'Sales', exact: true }).waitFor()
  if (await page.getByRole('checkbox', { name: 'Private (hidden)', exact: true }).isChecked()) throw new Error('Hidden workbook sheet was selected automatically')
  await page.getByRole('checkbox', { name: 'Summary', exact: true }).uncheck()
  await page.getByRole('combobox', { name: 'Page size', exact: true }).selectOption('Letter')
  await page.getByRole('combobox', { name: 'Orientation', exact: true }).selectOption('landscape')
  await page.getByRole('spinbutton', { name: 'Table text size' }).fill('10')
  const printPdf = await getDocument({ data: new Uint8Array(await download('Convert and download', 'spreadsheet-print.pdf')), useSystemFonts: true }).promise
  const printPage = await printPdf.getPage(1)
  const printText = (await printPage.getTextContent()).items.map((item) => item.str).join(' ')
  if (printPdf.numPages !== 1 || printPage.view[2] !== 792 || printPage.view[3] !== 612 || !printText.includes('Zero cached result') || !/(?:^|\s)0(?:\s|$)/.test(printText) || !printText.includes('#DIV/0!') || printText.includes('Summary sentinel') || printText.includes('Hidden sentinel')) throw new Error(`Spreadsheet import lost selection, print layout, cached zero, or error values: ${printPdf.numPages}; ${printPage.view}; ${printText}`)
  await printPdf.loadingTask.destroy()
  if (errors.length) throw new Error(errors.join('; '))
  process.stdout.write('HTML, EPUB, PPTX, Excel/CSV, creation imports/layout/links, eBook chapters/images, and resume persistence/pagination validated.\n')
} finally {
  await browser?.close()
  server.kill()
  await rm(temporary, { recursive: true, force: true })
}
