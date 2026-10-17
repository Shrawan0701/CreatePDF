import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const origin = 'http://127.0.0.1:4194'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4194', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let attempt = 0; ; attempt++) {
    try { if ((await fetch(origin)).ok) break } catch { /* Starting Vite. */ }
    if (attempt >= 120) throw new Error('Vite did not start.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } })
  const errors = []
  const apiCalls = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/')) apiCalls.push(request.url()) })
  await page.addInitScript(() => {
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = function () { if (this.type === 'application/pdf') globalThis.previewPdfBlob = this; return read.call(this) }
  })
  await page.goto(`${origin}/resume-builder`, { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: 'Download PDF', exact: true }).isDisabled(), true)
  await page.evaluate(async () => {
    const { saveResume } = await import('/src/services/storage.js')
    await saveResume({ id: 'legacy-resume', name: 'Legacy Person', template: 'classic', experience: 'Legacy achievement preserved', education: 'Legacy education preserved', projects: 'Legacy project preserved', updatedAt: 1 })
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => document.querySelector('input[id]')?.value === 'Legacy Person' || [...document.querySelectorAll('input')].some(input => input.value === 'Legacy Person'))
  assert.equal(await page.getByRole('textbox', { name: 'Experience bullets', exact: true }).innerText(), 'Legacy achievement preserved')
  const openSection = async label => {
    const details = page.locator('.resume-builder-section').filter({ has: page.locator(':scope > summary').filter({ hasText: label }) })
    if (!(await details.getAttribute('open')) && await details.getAttribute('open') === null) await details.locator(':scope > summary').click()
    return details
  }
  const ready = async () => {
    await page.getByRole('status').filter({ hasText: 'Matches your download' }).waitFor()
    await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '1')
  }
  await page.getByRole('textbox', { name: 'Full name', exact: true }).fill('Alex Engineer')
  await page.getByRole('textbox', { name: 'Professional title', exact: true }).fill('Backend Engineer')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('alex@example.com')
  await page.getByRole('textbox', { name: 'Phone', exact: true }).fill('+91 9876543210')
  await page.getByRole('textbox', { name: 'City / location', exact: true }).fill('Pune, India')
  await page.getByRole('textbox', { name: 'Profile', exact: true }).fill('I build **reliable APIs** and *accessible products*. See my [writing](https://example.com/writing).')
  await page.getByRole('button', { name: 'Add link', exact: true }).click()
  await page.getByRole('textbox', { name: 'Link label', exact: true }).fill('GitHub')
  await page.getByRole('textbox', { name: 'Link URL', exact: true }).fill('github.com/alex')
  const experience = page.getByRole('group', { name: 'Experience entry 1', exact: true })
  await experience.getByRole('textbox', { name: 'Job title', exact: true }).fill('Software Engineer')
  await experience.getByRole('textbox', { name: 'Company', exact: true }).fill('Example Labs')
  await experience.getByRole('textbox', { name: 'Start date', exact: true }).fill('Jun 2024')
  await experience.getByRole('textbox', { name: 'End date', exact: true }).fill('Present')
  await experience.getByRole('textbox', { name: 'Experience bullets', exact: true }).fill('Improved API latency by **35%**.\nDelivered a [public demo](https://example.com/demo).')
  await page.getByRole('button', { name: 'Add experience', exact: true }).click()
  const secondExperience = page.getByRole('group', { name: 'Experience entry 2', exact: true })
  await secondExperience.getByRole('textbox', { name: 'Job title', exact: true }).fill('Intern')
  await secondExperience.getByRole('textbox', { name: 'Company', exact: true }).fill('Example Studio')
  await page.getByRole('button', { name: 'Move experience entry 2 up', exact: true }).click()
  assert.equal(await experience.getByRole('textbox', { name: 'Job title', exact: true }).inputValue(), 'Intern')
  await page.getByRole('button', { name: 'Move experience entry 1 down', exact: true }).click()
  await openSection('Education')
  await page.getByRole('textbox', { name: 'Degree or qualification', exact: true }).fill('B.E. Computer Engineering')
  await page.getByRole('textbox', { name: 'Institution', exact: true }).fill('Example University')
  await openSection('Skills')
  await page.getByRole('textbox', { name: 'Skills', exact: true }).fill('Java, Spring Boot, React, PostgreSQL')
  await openSection('Projects')
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Document Platform')
  await page.getByRole('textbox', { name: 'Project link', exact: true }).fill('https://example.com/project')
  await page.getByRole('textbox', { name: 'Project bullets', exact: true }).fill('Built a browser-based document platform.\nFinal project sentinel')
  await page.getByRole('button', { name: 'Add custom section', exact: true }).click()
  await page.getByRole('textbox', { name: 'Section title', exact: true }).fill('Certifications')
  await page.getByRole('textbox', { name: 'Section bullets', exact: true }).fill('Cloud Developer Certificate')
  await openSection('Photo')
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 180
    const context = canvas.getContext('2d'); context.fillStyle = '#2b7265'; context.fillRect(0, 0, 120, 180); context.fillStyle = '#eac69a'; context.beginPath(); context.arc(60, 65, 30, 0, Math.PI * 2); context.fill()
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('Resume photo file').setInputFiles({ name: 'synthetic-photo.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') })
  await page.getByRole('img', { name: 'Resume photo', exact: true }).waitFor()
  await page.getByRole('spinbutton', { name: 'Photo size (pt)', exact: true }).fill('56')
  await page.getByRole('combobox', { name: 'Resume font', exact: true }).selectOption('serif')
  await page.getByRole('spinbutton', { name: 'Name size (pt)', exact: true }).fill('32')
  await page.getByRole('spinbutton', { name: 'Section heading size (pt)', exact: true }).fill('13')
  await page.getByLabel('Body text color', { exact: true }).fill('#253247')
  await page.getByLabel('Link color', { exact: true }).fill('#2563eb')
  await page.getByLabel('Section line color', { exact: true }).fill('#99aabb')
  const selectWords = async (editor, words) => editor.evaluate((element, words) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const offset = walker.currentNode.textContent.indexOf(words)
      if (offset < 0) continue
      const range = document.createRange(); range.setStart(walker.currentNode, offset); range.setEnd(walker.currentNode, offset + words.length)
      element.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
      return
    }
    throw new Error(`Selection text missing: ${words}`)
  }, words)
  const achievements = experience.getByRole('textbox', { name: 'Experience bullets', exact: true })
  await selectWords(achievements, '35%')
  await experience.getByLabel('Experience bullets selected text color', { exact: true }).fill('#c2410c')
  await experience.getByRole('button', { name: 'Apply color', exact: true }).click()
  assert.ok((await achievements.innerHTML()).includes('#c2410c'), 'Selected color was not visible in the editor')
  await experience.getByRole('button', { name: 'Undo', exact: true }).click()
  assert.ok(!(await achievements.innerHTML()).includes('#c2410c'), 'Selected color cannot be undone')
  await experience.getByRole('button', { name: 'Redo', exact: true }).click()
  assert.ok((await achievements.innerHTML()).includes('#c2410c'), 'Selected color cannot be redone')
  const profile = page.getByRole('textbox', { name: 'Profile', exact: true })
  await selectWords(profile, 'accessible products')
  await page.getByRole('toolbar', { name: 'Profile formatting', exact: true }).getByRole('button', { name: 'Link', exact: true }).click()
  await page.getByRole('textbox', { name: 'Link address', exact: true }).fill('https://example.com/products')
  await page.getByRole('button', { name: 'Apply link', exact: true }).click()
  assert.equal(await profile.locator('a').getAttribute('href'), 'https://example.com/products')
  await selectWords(profile, 'accessible products')
  await page.getByLabel('Profile selected text color', { exact: true }).fill('#047857')
  await page.getByRole('toolbar', { name: 'Profile formatting', exact: true }).getByRole('button', { name: 'Apply color', exact: true }).click()
  const verifyPdf = async ({ long = false, hidden = false, photo = true, template, lines = true }) => page.evaluate(async ({ long, hidden, photo, template, lines }) => {
    const { getPdfjsLib } = await import('/src/services/pdfEngine.js')
    const pdfjs = await getPdfjsLib()
    const task = pdfjs.getDocument({ data: new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer()) })
    try {
      const pdf = await task.promise
      const first = await pdf.getPage(1)
      const items = (await first.getTextContent()).items
      const links = (await first.getAnnotations()).map(annotation => annotation.url || annotation.unsafeUrl)
      for (const link of ['mailto:alex@example.com', 'tel:+919876543210', 'https://github.com/alex', 'https://example.com/writing', 'https://example.com/products']) if (!links.includes(link)) throw new Error(`Missing resume link ${link}`)
      const name = items.find(item => item.str === 'Alex') || items.find(item => item.str.includes('Alex Engineer'))
      if (!name || Math.abs(name.transform[0] - 32) > .1) throw new Error('Name size setting was lost')
      const operators = await first.getOperatorList()
      const hasImage = operators.fnArray.includes(pdfjs.OPS.paintImageXObject)
      if (hasImage !== photo) throw new Error('Photo insertion/removal did not reach the PDF')
      const colorKey = args => {
        if (typeof args[0] === 'string') return args[0].toLowerCase()
        const channels = args.flatMap(value => ArrayBuffer.isView(value) ? Array.from(value) : Array.isArray(value) ? value : [value])
        return '#' + channels.slice(0, 3).map(value => Math.round(value <= 1 ? value * 255 : value).toString(16).padStart(2, '0')).join('')
      }
      let fill = ''
      const runs = []
      const strokes = []
      for (let index = 0; index < operators.fnArray.length; index++) {
        const op = operators.fnArray[index]
        const args = operators.argsArray[index]
        if (op === pdfjs.OPS.setFillRGBColor) fill = colorKey(args)
        if (op === pdfjs.OPS.setStrokeRGBColor) strokes.push(colorKey(args))
        if (op === pdfjs.OPS.showText) runs.push({ text: args[0].map(glyph => glyph?.unicode || '').join(''), fill })
      }
      if (!runs.some(run => run.text.includes('reliable') && run.fill === '#253247')) throw new Error('Body color did not reach the PDF')
      if (!runs.some(run => run.text.includes('writing') && run.fill === '#2563eb')) throw new Error('Link color did not reach the PDF')
      if (!runs.some(run => run.text.includes('accessible') && run.fill === '#047857')) throw new Error('Selected link color did not override the default link color')
      if (!long && !runs.some(run => run.text.includes('35%') && run.fill === '#c2410c')) throw new Error(`Selected color did not reach the PDF: ${JSON.stringify(runs.slice(0, 40))}`)
      if (strokes.includes('#99aabb') !== lines) throw new Error('Section divider switch or color did not reach the PDF')
      let text = ''
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const content = await page.getTextContent()
        if (number > 1 && content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').includes('Alex Engineer')) throw new Error('Resume repeats the name on a continuation page')
        for (const item of content.items) {
          if (item.transform[4] < 23 || item.transform[4] + item.width > page.view[2] - 22 || item.transform[5] < 20) throw new Error(`Resume content was clipped: ${item.str}`)
          if (item.str.trim() && item.transform[5] < 35) throw new Error(`Resume must not print page numbers: ${item.str}`)
        }
        text += content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ') + ' '
      }
      for (const value of ['Alex Engineer', 'Software Engineer', 'Example Labs', 'Intern', 'B.E. Computer Engineering', 'Example University', 'Final project sentinel', 'Cloud Developer Certificate']) if (!text.includes(value)) throw new Error(`Resume lost ${value}`)
      if (text.includes('Spring Boot') === hidden) throw new Error('Section visibility was not applied')
      if (long && (pdf.numPages < 2 || !text.includes('LAST_EXPERIENCE_MARKER'))) throw new Error('Long resume content did not paginate fully')
      if (template === 'sidebar' && !hidden) {
        const skill = items.find(item => item.str.includes('Spring'))
        const role = items.find(item => item.str.includes('Software'))
        if (!skill || !role || skill.transform[4] >= role.transform[4]) throw new Error('Sidebar template did not use distinct columns')
      }
    } finally { await task.destroy() }
  }, { long, hidden, photo, template, lines })
  for (const template of ['modern', 'classic', 'sidebar', 'compact']) {
    await page.getByRole('combobox', { name: 'Template', exact: true }).selectOption(template)
    await ready()
    await verifyPdf({ template })
    if (process.env.RESUME_SCREENSHOT && ['modern', 'sidebar'].includes(template)) {
      await page.locator('.pdf-document-preview').scrollIntoViewIfNeeded()
      await page.screenshot({ path: process.env.RESUME_SCREENSHOT.replace(/\.png$/, `-${template}.png`) })
    }
  }
  await page.getByRole('combobox', { name: 'Section divider lines', exact: true }).selectOption('none')
  await ready(); await verifyPdf({ lines: false })
  await page.getByRole('combobox', { name: 'Section divider lines', exact: true }).selectOption('above')
  await ready(); await verifyPdf({ lines: true })
  await page.getByRole('combobox', { name: 'Section divider lines', exact: true }).selectOption('below')
  await page.getByRole('checkbox', { name: 'Show Skills section', exact: true }).uncheck()
  await ready(); await verifyPdf({ hidden: true })
  await page.getByRole('checkbox', { name: 'Show Skills section', exact: true }).check()
  await page.getByRole('button', { name: 'Move Skills section up', exact: true }).click()
  await page.getByRole('combobox', { name: 'Template', exact: true }).selectOption('sidebar')
  await experience.getByRole('textbox', { name: 'Experience bullets', exact: true }).fill(Array.from({ length: 65 }, (_, index) => `Achievement ${index + 1}: Built reliable software and improved delivery for the team.`).join('\n') + '\nLAST_EXPERIENCE_MARKER')
  await ready(); await verifyPdf({ long: true, template: 'sidebar' })
  await page.getByRole('button', { name: 'Save locally', exact: true }).click()
  await page.getByText('Resume saved locally.', { exact: true }).waitFor()
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForFunction(() => [...document.querySelectorAll('input')].some(input => input.value === 'Alex Engineer'))
  assert.equal(await page.getByRole('combobox', { name: 'Template', exact: true }).inputValue(), 'sidebar')
  assert.ok((await page.getByRole('textbox', { name: 'Experience bullets', exact: true }).first().innerText()).includes('LAST_EXPERIENCE_MARKER'))
  await ready(); await verifyPdf({ long: true, template: 'sidebar' })
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click()
  const download = await pending
  assert.equal(download.suggestedFilename(), 'Alex Engineer_Resume.pdf')
  const bytes = await readFile(await download.path())
  assert.deepEqual(Buffer.from(await page.evaluate(async () => Array.from(new Uint8Array(await globalThis.previewPdfBlob.arrayBuffer())))), bytes, 'Resume download differs from preview')
  await page.getByRole('button', { name: 'Next preview page', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.pdf-preview-viewport canvas')?.dataset.renderedPage === '2')
  await openSection('Photo')
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
  await ready(); await verifyPdf({ long: true, template: 'sidebar', photo: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => parseFloat(document.querySelector('.pdf-preview-viewport canvas').style.width) < 390)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Resume builder overflows on mobile')
  assert.deepEqual(errors, [])
  assert.deepEqual(apiCalls, [], 'Resume conversion must stay local')
  console.log('Resume checks passed: section divider positions/on/off, global and selected colors, visible rich editing, color undo/redo, inline link editing, no printed page numbers, four templates, legacy data, photos, local persistence, multi-page export and matching preview/download.')
} finally {
  await browser?.close()
  server.kill()
}
