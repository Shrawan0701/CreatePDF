import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import JSZip from 'jszip'

const sample = 'artifacts/Small_Steps_Better_Projects_Test.epub'
try { await readFile(sample) } catch { execFileSync(process.execPath, ['scripts/generate-ebook-sample.mjs'], { stdio: 'inherit' }) }
const zip = await JSZip.loadAsync(await readFile(sample))
const chapters = await Promise.all(Array.from({ length: 5 }, (_, index) => zip.file(`EPUB/chapter-${index + 1}.xhtml`).async('string')))
const illustration = await zip.file('EPUB/images/sample.png').async('base64')
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
const outputPath = 'artifacts/Small_Steps_Better_Projects_Test.pdf'
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 1200 } })
  const content = await page.evaluate(({ chapters, illustration }) => {
    const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])
    const parsed = chapters.map(source => new DOMParser().parseFromString(source, 'application/xhtml+xml'))
    const headings = parsed.map(document => document.querySelector('h1').textContent)
    const bodies = parsed.map(document => {
      document.querySelector('h1').remove()
      for (const image of document.querySelectorAll('img')) image.setAttribute('src', `data:image/png;base64,${illustration}`)
      // Give the real-world scenario table a third field to exercise column preservation.
      if (document.querySelector('table tr')?.children.length === 2) {
        [...document.querySelectorAll('table tr')].forEach((row, index) => {
          const cell = document.createElementNS('http://www.w3.org/1999/xhtml', index ? 'td' : 'th')
          cell.textContent = index ? (index === 3 ? 'High' : 'Normal') : 'Priority'
          row.append(cell)
        })
      }
      return document.querySelector('body').innerHTML
    })
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 330
    const context = canvas.getContext('2d')
    context.fillStyle = '#eef5f1'; context.fillRect(0, 0, canvas.width, canvas.height)
    const labels = ['Understand', 'Plan', 'Build', 'Test', 'Review']
    context.strokeStyle = '#9dbfb1'; context.lineWidth = 6; context.beginPath(); context.moveTo(120, 130); context.lineTo(1080, 130); context.stroke()
    labels.forEach((label, index) => {
      const x = 120 + index * 240
      context.fillStyle = index === 4 ? '#d9a73d' : '#0d7865'; context.beginPath(); context.arc(x, 130, 39, 0, Math.PI * 2); context.fill()
      context.fillStyle = 'white'; context.textAlign = 'center'; context.font = 'bold 31px Arial'; context.fillText(String(index + 1), x, 141)
      context.fillStyle = '#24483a'; context.font = '26px Arial'; context.fillText(label, x, 225)
    })
    const diagram = canvas.toDataURL('image/png')
    bodies[4] = bodies[4].replace(/<p>\s*<strong>END OF SAMPLE BOOK<\/strong>\s*<\/p>/, '')
    bodies[4] += `<div style="break-before:page"><p class="eyebrow">THE NEXT CHAPTER IS YOURS</p><h1>Keep the cycle moving</h1><p>A useful project is rarely finished in one perfect pass. The first working version gives you something concrete to observe. It reveals which assumptions were right, which details confused people, and which improvements deserve attention next.</p><p>The five steps below are a repeatable cycle, not a rigid schedule. Return to understanding whenever new evidence changes the problem. Adjust the plan when a small experiment teaches you more than a long discussion could.</p><figure><img src="${diagram}" alt="A five-step project cycle: understand, plan, build, test, review"/><figcaption>Figure 2. A simple cycle that connects a useful goal with evidence from real use.</figcaption></figure><h2>A note for your next project</h2><p>Choose one person, one problem, and one useful result. Write down the action that person should be able to complete, then build the smallest version that supports the whole journey. Ask someone to try it before adding another layer of features.</p><p>Keep a short record of what you learn. Clear observations make the next decision easier, and a modest improvement repeated over time can change the quality of the entire product.</p><p><strong>END OF SAMPLE BOOK</strong></p></div>`
    return {
      headings,
      body: `<section class="cover"><p class="cover-kicker">THE PRACTICAL PROJECT SERIES</p><div class="cover-rule"></div><h1>Small Steps,<br/>Better Projects</h1><p class="cover-subtitle">A practical guide to clear goals,<br/>manageable work, and thoughtful design.</p><div class="cover-mark">01 — 05</div><p class="cover-author">CreatePDF.tech Sample Library</p><p class="cover-edition">An original sample book · English edition</p></section><section class="contents"><p class="eyebrow">A SHORT GUIDE WITH REAL CONTENT</p><h1>Before you begin</h1><p>Good projects do not depend on dramatic beginnings. They grow from a clear purpose, small decisions, and regular attention to the person who will use the result. This guide follows a community library as its volunteers improve the way they lend and return books.</p><p>Each chapter introduces a useful idea, shows it in a familiar setting, and ends with something you can try. Read the chapters in order, or use the contents below to jump to a topic.</p><h2>Contents</h2><ol class="contents-list">${headings.map((heading, index) => `<li><a href="#chapter-${index + 1}">${escape(heading)}</a></li>`).join('')}</ol><aside><h3>About this test PDF</h3><p>This is an unlocked, text-based PDF. It includes five chapters, paragraphs, lists, bold and italic text, two tables, two embedded illustrations, and clickable links. It is ready for PDF-to-EPUB, PDF-to-HTML, and image-extraction testing. No password is required.</p><p><strong>Suggested EPUB settings:</strong> reflow text, serif font, 100% text size, 1.6 line spacing, and all pages.</p></aside></section>${headings.map((heading, index) => `<section class="book-chapter" id="chapter-${index + 1}"><p class="eyebrow">CHAPTER ${String(index + 1).padStart(2, '0')}</p><h1>${escape(heading.replace(/^\d+\.\s*/, ''))}</h1>${bodies[index]}</section>`).join('')}`,
    }
  }, { chapters, illustration })
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Small Steps, Better Projects</title><style>
    @page{size:A4;margin:18mm 17mm 19mm}*{box-sizing:border-box}html{font-family:Georgia,'Times New Roman',serif;color:#273d33}body{margin:0;font-size:11pt;line-height:1.6}h1,h2,h3{font-family:Arial,sans-serif;color:#173e33;break-after:avoid}h1{font-size:29pt;line-height:1.16;letter-spacing:-.7pt;margin:0 0 20pt}h2{font-size:14.5pt;line-height:1.3;margin:21pt 0 9pt}h3{font-size:12pt;margin:0 0 8pt}p{margin:0 0 11pt;orphans:3;widows:3}strong{font-weight:700}em{color:#526b5c}a{color:#0d7865;text-decoration:underline;text-underline-offset:3px}.eyebrow{font:8pt Arial,sans-serif;letter-spacing:2pt;color:#567e69;margin:0 0 12pt}section{break-before:page}section:first-child{break-before:auto}.cover{height:251mm;background:#0c5147;color:#edf8f1;padding:24mm 17mm 18mm;position:relative;-webkit-print-color-adjust:exact;print-color-adjust:exact}.cover h1{color:white;font:700 43pt/1.15 Georgia,serif;letter-spacing:-1.2pt;margin:0 0 22pt}.cover-kicker{font:9pt Arial,sans-serif;letter-spacing:2.6pt;color:#b1d1c1;margin-bottom:32pt}.cover-rule{width:50pt;height:3pt;background:#d7b268;margin-bottom:45pt}.cover-subtitle{font-size:14pt;line-height:1.75;color:#dceee3}.cover-mark{margin-top:54pt;font:42pt Georgia,serif;color:#74a58f;letter-spacing:5pt}.cover-author{position:absolute;bottom:31mm;left:17mm;font:13pt Arial,sans-serif;color:#edf8f1}.cover-edition{position:absolute;bottom:21mm;left:17mm;font:8pt Arial,sans-serif;color:#b1d1c1}.contents-list{padding-left:22pt;margin:0 0 24pt}.contents-list li{margin-bottom:12pt;font-size:12pt}aside{border-left:3pt solid #0d7865;background:#edf5ef;padding:16pt 18pt;margin-top:20pt;font-size:9.5pt;break-inside:avoid}aside p:last-child{margin-bottom:0}ul,ol{padding-left:20pt;margin:8pt 0 15pt}li{margin-bottom:6pt}li p{margin:0}blockquote{margin:19pt 0;padding:10pt 18pt;border-left:3pt solid #a8bfae;color:#355c47;font-size:13pt;line-height:1.5;break-inside:avoid}table{width:100%;border-collapse:collapse;margin:12pt 0 20pt;font:9pt/1.4 Arial,sans-serif;table-layout:fixed}th,td{border:1px solid #cbd9d0;padding:7pt;text-align:left;vertical-align:top;overflow-wrap:break-word}th{background:#e4eee7;color:#244837;font-weight:bold}thead{display:table-header-group}tr{break-inside:avoid}img{max-width:100%;height:auto;display:block;margin:15pt auto}figure{margin:20pt 0;break-inside:avoid}figcaption{font-size:9pt;line-height:1.5;text-align:center;color:#586f60;margin-top:8pt}
  </style></head><body>${content.body}</body></html>`
  await page.setContent(html, { waitUntil: 'load' })
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())))
  const raw = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true, preferCSSPageSize: true,
    headerTemplate: '<div></div>', footerTemplate: '<div style="width:100%;font-family:Arial,sans-serif;font-size:8px;color:#6a7c70;display:flex;justify-content:space-between;padding:0 64px"><span>SMALL STEPS, BETTER PROJECTS</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  })
  const document = await PDFDocument.load(raw)
  document.setTitle('Small Steps, Better Projects')
  document.setAuthor('CreatePDF.tech Sample Library')
  document.setSubject('A practical guide and complete sample for PDF conversion testing')
  document.setKeywords(['sample book', 'PDF to EPUB', 'chapters', 'tables', 'images', 'links'])
  const bytes = await document.save()
  await mkdir('artifacts', { recursive: true })
  await writeFile(outputPath, bytes)
  const task = getDocument({ data: bytes.slice(), useSystemFonts: true, verbosity: 0 })
  let allText = '', links = 0, images = 0
  try {
    const pdf = await task.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      const source = await pdf.getPage(number)
      allText += (await source.getTextContent()).items.map(item => item.str).join(' ') + '\n'
      links += (await source.getAnnotations()).filter(annotation => annotation.subtype === 'Link').length
      const operators = await source.getOperatorList()
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      images += operators.fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)).length
    }
    for (const heading of ['Start With a Clear Goal', 'Plan a Manageable Week', 'Design for the Reader', 'Test the Complete Journey', 'Review, Learn, and Continue', 'END OF SAMPLE BOOK']) assert.ok(allText.includes(heading), `Missing content: ${heading}`)
    assert.ok(images >= 2, 'Embedded illustrations were lost')
    assert.ok(links >= 6, 'Contents or external links were lost')
    assert.ok(pdf.numPages >= 7)
    console.log(JSON.stringify({ file: resolve(outputPath), pages: pdf.numPages, chapters: 5, tables: 2, embeddedImages: images, links, words: allText.split(/\s+/).length, bytes: bytes.length, password: 'none' }, null, 2))
  } finally { await task.destroy() }
} finally { await browser.close() }
