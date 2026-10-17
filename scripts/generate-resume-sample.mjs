import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4195'
const withPhoto = process.argv.includes('--photo')
const source = JSON.parse(await readFile(new URL('./fixtures/resume-classic.json', import.meta.url), 'utf8'))
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4195', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt > 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage()
  await page.goto(`${origin}/resume-builder`, { waitUntil: 'networkidle' })
  const result = await page.evaluate(async ({ source, withPhoto }) => {
    const { normalizeResume } = await import('/src/services/resumeModel.js')
    const { resumeToPdf } = await import('/src/services/resumePdf.js')
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const resume = normalizeResume(source)
    if (withPhoto) {
      // A neutral illustrated placeholder demonstrates the photo layout without
      // implying that a generated face belongs to the sample resume's author.
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 400
      const context = canvas.getContext('2d')
      context.fillStyle = '#e8edf3'; context.fillRect(0, 0, 400, 400)
      context.fillStyle = '#788ba5'; context.beginPath(); context.arc(200, 145, 70, 0, Math.PI * 2); context.fill()
      context.beginPath(); context.ellipse(200, 365, 135, 125, 0, 0, Math.PI * 2); context.fill()
      resume.photo = canvas.toDataURL('image/png')
      resume.design.photoSize = 72
      resume.design.photoShape = 'circle'
    }
    const blob = await resumeToPdf(resume)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: bytes.slice() })
    try {
      const pdf = await task.promise
      const previews = []
      let text = ''; let links = 0
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const items = (await page.getTextContent()).items
        const pageText = items.map(item => item.str).join(' ').replace(/\s+/g, ' ')
        text += pageText + ' '
        if (number > 1 && pageText.includes('Alex Sharma')) throw new Error('Resume name was repeated on a continuation page')
        const hasPhoto = (await page.getOperatorList()).fnArray.includes(pdfjs.OPS.paintImageXObject)
        if (number === 1 && hasPhoto !== withPhoto) throw new Error('Sample photo was not embedded correctly')
        for (const item of items) {
          if (item.transform[4] < 23 || item.transform[4] + item.width > 573 || item.transform[5] < 35) throw new Error(`Clipped text or printed page numbers: ${item.str}`)
        }
        links += (await page.getAnnotations()).length
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        previews.push(canvas.toDataURL('image/png').split(',')[1])
      }
      for (const value of ['Alex Sharma', '35%', '8.6/10', 'Unit Testing', 'Document Management Platform', 'Certifications & Achievements', 'Presented a technical workshop']) if (!text.includes(value)) throw new Error(`Missing sample content: ${value}`)
      return { bytes: Array.from(bytes), previews, pages: pdf.numPages, links }
    } finally { await task.destroy() }
  }, { source, withPhoto })
  const output = resolve('artifacts')
  await mkdir(output, { recursive: true })
  const stem = withPhoto ? 'Alex_Sharma_Classic_Resume_With_Photo' : 'Alex_Sharma_Classic_Resume_Updated'
  const filename = resolve(output, `${stem}.pdf`)
  await writeFile(filename, Buffer.from(result.bytes))
  for (const [index, png] of result.previews.entries()) await writeFile(resolve(output, `${stem}_page_${index + 1}.png`), Buffer.from(png, 'base64'))
  console.log(JSON.stringify({ pdf: filename, pages: result.pages, clickableLinks: result.links, bytes: result.bytes.length }))
} finally {
  await browser?.close()
  server.kill()
}
