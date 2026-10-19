import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'

const out = 'artifacts'
const mainFile = `${out}/Bookmark_Split_Complete_Test.pdf`
const edgeFile = `${out}/Bookmark_Split_Edge_Cases_Test.pdf`
const guideFile = `${out}/Bookmark_Split_Test_Guide.md`
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
const p = text => `<p>${text}</p>`
const h = text => `<h3>${text}</h3>`
const ul = items => `<ul>${items.map(item => `<li>${item}</li>`).join('')}</ul>`
const table = (headers, rows) => `<table><thead><tr>${headers.map(value => `<th>${value}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`
const note = (title, text) => `<aside><strong>${title}</strong><p>${text}</p></aside>`
const link = (label, type, target) => `<span class="pdf-link" data-link-type="${type}" data-link-target="${escape(target)}">${label}</span>`
const internal = (label, page) => link(label, 'page', page)
const named = (label, target) => link(label, 'named', target)
const external = (label, url = 'https://example.com') => link(label, 'url', url)
const figure = (visual, caption) => `<figure><img data-visual="${visual}" alt="${escape(caption)}"><figcaption>${caption}</figcaption></figure>`

const pages = [
  { kind: 'cover', eyebrow: 'A COMPLETE SAMPLE DOCUMENT', title: 'Northstar\nProject Handbook', subtitle: 'A practical plan for a community learning and repair hub', body:
    figure('landscape', 'A welcoming place to learn, repair, and build together.') +
    p('This handbook follows a fictional team from its first community interviews through a small public launch. It includes a project brief, operating procedures, a budget, a sample invoice, a delivery plan, and a review checklist.') +
    `<div class="cover-meta"><span>EDITION 1.0</span><span>12 PAGES</span><span>5 BOOKMARKED SECTIONS</span></div>` +
    note('About this sample', 'All names, dates, amounts, and scenarios are fictional. The file contains selectable text, nested bookmarks, images, tables, internal links, external links, and editable form fields. No password is required.') },
  { eyebrow: 'FRONT MATTER', title: 'Contents & reading map', body:
    p('Read this handbook in order, or use the clickable contents and the PDF bookmark panel to jump directly to a chapter. The two front-matter pages are deliberately placed before the first top-level bookmark.') +
    table(['Section', 'What you will find', 'Pages'], [
      [internal('Chapter 1: Planning', 3), 'Purpose, users, scope, and measurable requirements', '3-4'],
      [named('Chapter 2: Operations', 'operations-start'), 'Daily workflow, ownership, and quality checks', '5-6'],
      [internal('Chapter 3: Finance', 7), 'A consistent launch budget and a sample invoice', '7-8'],
      [internal('Chapter 4: Delivery', 9), 'A 90-day roadmap and a structured review', '9-10'],
      [internal('Appendix: Reference', 11), 'Glossary, acceptance checklist, and review form', '11-12'],
    ]) +
    h('How the document is organized') +
    p('Five top-level bookmarks identify chapters and the appendix. Each contains two second-level entries, and the second entry contains one third-level detail bookmark. Some child entries share a page with their parent, which is normal in real reports.') +
    ul(['Chapter starts are on pages 3, 5, 7, 9, and 11.', 'Page numbers in this document refer to physical PDF positions, starting with the cover as page 1.', 'Cross-chapter links work in the complete document. A split section can retain only internal links whose destination remains inside that section.', 'The form on page 12 can be filled in with a PDF viewer that supports interactive forms.']) +
    note('Navigation practice', `Start with ${internal('the project brief on page 3', 3)}, then follow its link to the requirements page. For an external-link check, use the ${external('example reference website')}.`) },
  { marker: true, eyebrow: 'CHAPTER 1 / PLANNING', title: 'Start with a useful purpose', body:
    h('1.1 The project brief') +
    p('Northstar is a proposed neighborhood space where residents can attend practical workshops, borrow basic tools, and get help with small repairs. The team will begin with two sessions each week, using a shared room rather than signing a long lease. A modest pilot makes it possible to learn before committing to larger running costs.') +
    p('The first objective is clear: help 60 residents complete at least one practical activity during a 90-day pilot. Success means more than registrations. The team will record attendance, completed activities, equipment availability, and whether visitors feel confident trying the same task again at home.') +
    h('Who the service is for') +
    ul(['First-time visitors who want patient guidance and simple instructions.', 'Volunteer hosts who need clear opening, booking, and closing procedures.', 'Partner organizations that can refer residents or provide workshop space.', 'The small coordination team responsible for schedules, spending, and follow-up.']) +
    note('A decision rule', 'Choose an activity only when it can be explained simply, supervised safely, and completed with the tools available during the pilot. A smaller reliable offer is more useful than a broad list that the team cannot deliver.') +
    p(`The next page turns this purpose into concrete requirements. ${internal('Continue to 1.2 Requirements on page 4', 4)}.`) },
  { eyebrow: 'CHAPTER 1 / PLANNING', title: 'Define the first release', body:
    h('1.2 Requirements') +
    p('The first release needs a booking list, a visible workshop schedule, a short equipment register, and a simple way to record a completed visit. The team can use a spreadsheet for the pilot as long as every record has an owner and a review date. A new custom application is outside the initial scope.') +
    table(['Requirement', 'Acceptance condition', 'Owner'], [
      ['Booking', 'A resident receives a clear session date and capacity status.', 'Coordinator'],
      ['Equipment', 'Every shared tool has a label, location, and condition entry.', 'Workshop host'],
      ['Attendance', 'The host can record arrivals without collecting unnecessary data.', 'Session lead'],
      ['Feedback', 'Visitors can answer three short questions after the activity.', 'Volunteer'],
    ]) +
    h('1.2.1 Constraints and change control') +
    p('A requirement is ready only when another person can check it without guessing. If a new request arrives, the coordinator records its purpose, effort, and effect on the current plan. Requests that add cost or new equipment wait for the weekly review instead of quietly expanding the pilot.') +
    ul(['Use plain language on signs and booking messages.', 'Keep a paper fallback for sessions with unreliable connectivity.', 'Do not promise specialist repairs that the team cannot supervise.', 'Record assumptions that need confirmation during the first month.']) +
    p(`Within-chapter return link: ${internal('back to the project brief on page 3', 3)}. Cross-chapter reference: ${named('see the funding assumptions on page 7', 'finance-start')}.`) },
  { marker: true, eyebrow: 'CHAPTER 2 / OPERATIONS', title: 'Make the work repeatable', body:
    h('2.1 Session workflow') +
    p('A good session feels simple to a visitor because the team has prepared the details in advance. The host checks the room, confirms the equipment list, and reads the booking notes before opening. Visitors receive a short introduction that explains what the session includes, how to ask for help, and where to find shared materials.') +
    `<div class="workflow"><span>Prepare</span><b>›</b><span>Welcome</span><b>›</b><span>Practice</span><b>›</b><span>Review</span></div>` +
    table(['Stage', 'Practical action', 'Record'], [
      ['Before opening', 'Check the room and inspect the equipment needed today.', 'Opening checklist'],
      ['At arrival', 'Confirm the booking and explain the activity boundaries.', 'Attendance list'],
      ['During practice', 'Demonstrate one task at a time and invite questions.', 'Host notes'],
      ['Before departure', 'Return equipment and ask for brief feedback.', 'Completion record'],
    ]) +
    p('Each stage has one named owner. Shared responsibility can work, but the team still needs to know who will act if a visitor is waiting or a tool is unavailable. The coordinator reviews recurring problems and changes the next session plan when needed.') +
    note('A useful handover', 'At the end of a shift, leave three facts for the next host: what changed, what needs attention, and what is already ready. This is more useful than a long unstructured message.') +
    p(`${internal('Continue to the quality checks on page 6', 6)}. External reference placeholder: ${external('example.com/operations', 'https://example.com/operations')}.`) },
  { eyebrow: 'CHAPTER 2 / OPERATIONS', title: 'Check the complete experience', body:
    h('2.2 Quality checks') +
    p('Quality means that a visitor can complete the whole journey, from seeing a session notice to finding the correct room and returning equipment. The team should therefore review the complete sequence rather than checking only individual signs or forms. A clear booking message is not enough if the arrival instructions are missing.') +
    ul(['Read a booking message as a first-time visitor and identify the next action.', 'Follow the arrival route and confirm that room signs are visible.', 'Check the equipment register against the tools actually available.', 'Complete one attendance entry and one feedback entry using sample data.', 'Ask a different host to follow the closing checklist without extra explanation.']) +
    h('2.2.1 Document and link checks') +
    p('When a document is shared, its links should lead to the intended place. A link within a section should remain useful after that section is exported. A reference to another chapter may need the complete handbook, so the section should still explain the subject clearly without depending on that jump.') +
    note('Review the result', 'Check the exported PDF itself. Confirm that the text is readable, images are present, tables have complete rows, and page order follows the planned section. Keep a short list of observations so that another person can repeat the same review.') +
    p(`Within-chapter navigation: ${named('return to the session workflow on page 5', 'operations-start')}. To try an external email link, use ${external('qa@example.com', 'mailto:qa@example.com')}; opening it does not send a message.`) },
  { marker: true, eyebrow: 'CHAPTER 3 / FINANCE', title: 'Give the plan a budget', body:
    h('3.1 Funding and forecasts') +
    p('The fictional launch budget is $9,000. The team separates one-time setup costs from ordinary running costs so that an inexpensive first month does not create a misleading impression of long-term affordability. Every purchase needs a short explanation connecting it to an agreed pilot activity.') +
    table(['Launch item', 'Budget', 'Purpose'], [
      ['Room preparation', '$2,400', 'Make the shared space usable for the pilot.'],
      ['Furniture and storage', '$1,800', 'Provide tables, seating, and labeled storage.'],
      ['Tools and materials', '$1,600', 'Support the first four workshop topics.'],
      ['Digital setup', '$900', 'Booking, printing, and basic communication.'],
      ['Host training', '$1,100', 'Prepare the volunteer team.'],
      ['Contingency', '$1,200', 'Allow for agreed unexpected costs.'],
      ['TOTAL', '$9,000', 'Illustrative figures, not financial advice.'],
    ]) +
    figure('budget', 'Illustrative monthly income and costs. Exact values are listed on page 8.') +
    p(`A review should compare actual spending with this plan and explain the differences. ${internal('Continue to the forecast detail and sample invoice on page 8', 8)}.`) },
  { eyebrow: 'CHAPTER 3 / FINANCE', title: 'Keep the numbers traceable', body:
    p('This illustrative forecast uses four pilot months. Total income is $10,600, total operating cost is $9,400, and the resulting surplus is $1,200. These are fictional planning figures, not historical results or a promise of future performance.') +
    table(['Month', 'Income', 'Cost', 'Surplus'], [['Month 1', '$2,100', '$2,000', '$100'], ['Month 2', '$2,400', '$2,200', '$200'], ['Month 3', '$2,800', '$2,500', '$300'], ['Month 4', '$3,300', '$2,700', '$600'], ['TOTAL', '$10,600', '$9,400', '$1,200']]) +
    h('3.2 Sample purchase record') +
    `<div class="invoice-heading"><strong>Invoice Number: NS-2026-008</strong><span>Sample date: 05 Nov 2026</span></div>` +
    p('Supplier: Northstar Demonstration Supplies. Customer: Northstar Pilot Team. This sample is included to provide realistic table and text content; it is not a request for payment.') +
    h('3.2.1 Invoice line items') +
    table(['Description', 'Qty', 'Unit', 'Amount'], [['Repair supplies', '2', '$75.00', '$150.00'], ['Workshop kits', '10', '$18.00', '$180.00'], ['Printed participant packs', '20', '$4.00', '$80.00'], ['TOTAL (no sample tax)', '', '', '$410.00']]) +
    p('Before a purchase is approved, the owner checks the quantity, the agreed price, and the activity that will use the items. Corrections should be recorded beside the original entry rather than replacing its history without explanation.') +
    p(`Within-chapter reference: ${named('return to the launch budget on page 7', 'finance-start')}. Reference website: ${external('example.com/finance', 'https://example.com/finance')}.`) },
  { marker: true, eyebrow: 'CHAPTER 4 / DELIVERY', title: 'Deliver in manageable stages', body:
    h('4.1 The 90-day roadmap') +
    p('The roadmap creates time to learn before the public launch. A stage is complete when its expected result is visible, not simply when its calendar dates have passed. If an important dependency is late, the coordinator adjusts the next stage instead of asking the team to hide the delay.') +
    table(['Stage', 'Days', 'Visible result'], [['Discovery', '1-14', 'Residents and hosts agree on the first activities.'], ['Setup', '15-35', 'Room, equipment register, and booking process are ready.'], ['Pilot sessions', '36-60', 'The team completes small sessions and records observations.'], ['Public launch', '61-90', 'The schedule expands only after the pilot is reviewed.']]) +
    h('Ownership and dependencies') +
    p('Every milestone has an owner, a short acceptance statement, and a dependency list. For example, the first public workshop depends on a prepared host, working equipment, a usable room, and a booking message that people can understand. Missing any one of these items changes the experience.') +
    ul(['Review the next two weeks in detail rather than pretending every later date is fixed.', 'Keep changes visible to the people affected by them.', 'Close small issues promptly so that they do not become launch-day surprises.', 'Choose a fallback activity if a planned tool or material is unavailable.']) +
    p(`${internal('Continue to the weekly review on page 10', 10)}. The ${internal('acceptance checklist on page 12', 12)} provides a final cross-chapter reference.`) },
  { eyebrow: 'CHAPTER 4 / DELIVERY', title: 'Turn observations into decisions', body:
    h('4.2 Weekly review') +
    p('A useful review asks what happened, what it means, and what should change next. The team begins with observations from sessions rather than opinions about effort. Attendance, completed activities, equipment issues, and visitor comments help explain whether the current offer is working.') +
    p('The coordinator shares a one-page summary before the meeting. Hosts add context when a number is easy to misread. For example, a lower attendance figure may reflect a cancelled session rather than weak interest. The meeting should lead to a small number of clear decisions, each with an owner.') +
    h('4.2.1 Action log') +
    table(['Observation', 'Next action', 'Owner'], [['Visitors ask where to return tools.', 'Add a labeled return point beside the exit.', 'Session lead'], ['One workshop fills immediately.', 'Try a second small session before changing the full schedule.', 'Coordinator'], ['Feedback forms are often unfinished.', 'Reduce the form to three clear questions.', 'Volunteer lead'], ['A materials delivery is uncertain.', 'Prepare a fallback activity using current stock.', 'Workshop host']]) +
    note('Keep the learning', 'At the end of the pilot, retain the decisions and the evidence behind them. The next team should be able to understand why the project chose its schedule, equipment, and workshop topics without reconstructing every conversation.') +
    p(`Within-chapter navigation: ${internal('return to the roadmap on page 9', 9)}. External reference: ${external('example.com/review', 'https://example.com/review')}.`) },
  { marker: true, eyebrow: 'APPENDIX / REFERENCE', title: 'A shared vocabulary', body:
    h('A. Glossary') +
    table(['Term', 'Meaning in this handbook'], [['Acceptance condition', 'A visible result that lets another person confirm a requirement.'], ['Assumption', 'Something the team believes but still needs to check.'], ['Baseline', 'The agreed starting plan against which changes are compared.'], ['Contingency', 'A reserved allowance for unexpected but agreed needs.'], ['Dependency', 'A condition that must be satisfied before another activity can proceed.'], ['Front matter', 'Introductory pages before the first main chapter.'], ['Milestone', 'A specific result used to judge progress.'], ['Pilot', 'A limited first version used to observe the real experience.']]) +
    h('Reference notes') +
    p('The same words should mean the same thing across a plan, a budget, and a review. If people use a term differently, add a short definition before the difference creates an avoidable misunderstanding. A glossary is useful only when its examples match the work being done.') +
    p('This handbook uses a small fictional project so that every section can be read independently. The figures agree across the budget, forecast, and invoice tables. The page numbers and chapter titles are also used by the clickable contents and bookmark outline.') +
    p(`${internal('Continue to the acceptance checklist and form on page 12', 12)}. ${internal('Return to the contents on page 2', 2)}.`) },
  { eyebrow: 'APPENDIX / REFERENCE', title: 'Complete the final review', body:
    h('B. Acceptance checklist') +
    p('Use this checklist when the pilot team is ready to share the handbook or one of its sections. Work from the actual PDF that another person will receive. A correct source document does not automatically prove that every exported file is complete.') +
    ul(['Confirm that the first and last expected pages are present.', 'Read a paragraph and select a sentence to confirm the text remains selectable.', 'Inspect the budget and invoice tables for missing or clipped cells.', 'Check that illustrations and small transparent logos are visible.', 'Open the bookmark panel and follow a retained internal bookmark.', 'Try an internal link within the appendix and an external website link.', 'Fill in the review fields below, save the PDF, and reopen it in your viewer.']) +
    h('B.1 Reviewer sign-off') +
    p('These are real PDF form fields, not a screenshot of a form. They provide an additional check that standard form controls remain available when the appendix is exported as its own section.') +
    `<div class="review-form"><label>Reviewer name</label><div data-form="reviewer.name" class="form-box"></div><label>Reviewer email</label><div data-form="reviewer.email" class="form-box"></div><div class="review-checkbox"><div data-form="review.complete" class="check-box"></div><span>I completed the review checklist.</span></div></div>` +
    p(`${internal('Within-appendix link: return to the glossary on page 11', 11)}. External reference: ${external('example.com/checklist', 'https://example.com/checklist')}.`) },
]

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;color:#263b36;font:10.4pt/1.57 'Segoe UI',Arial,sans-serif;background:white}.page{position:relative;width:210mm;height:297mm;padding:17mm 18mm 18mm;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.running{display:flex;align-items:center;gap:8px;padding-bottom:9px;margin-bottom:20px;border-bottom:1px solid #d5e2dc;color:#58736a;font-size:8pt;letter-spacing:.5px}.running img{width:20px;height:20px}.running span:last-child{margin-left:auto;font-size:7pt}.eyebrow{font-size:8pt;font-weight:700;letter-spacing:1.8px;color:#0d7865;margin:0 0 7px}.marker{color:#798f85;font:7pt Arial,sans-serif;letter-spacing:1.5px;margin:0 0 7px}h1{font:700 29pt/1.16 Georgia,serif;letter-spacing:-.7px;margin:0 0 19px;color:#173d32;white-space:pre-line}h3{font-size:12pt;line-height:1.4;margin:18px 0 9px;color:#0d6553}p{margin:0 0 11px}ul{margin:7px 0 15px;padding-left:19px}li{margin-bottom:6px}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:9pt;line-height:1.45;margin:13px 0 18px}th,td{text-align:left;vertical-align:top;padding:9px 10px;border-bottom:1px solid #d4e0da;overflow-wrap:break-word}th{color:#0b6250;background:#e6f0eb;font-weight:700}tr:nth-child(even) td{background:#f5f8f5}th:first-child,td:first-child{width:28%}aside{padding:13px 15px;background:#edf4ef;border-left:3px solid #0d7865;margin:17px 0;font-size:9.5pt}aside strong{display:block;color:#0d6553;margin-bottom:5px}aside p{margin:0}.pdf-link{color:#156b98;text-decoration:underline}figure{margin:18px 0}figure img{display:block;width:100%;height:auto;border-radius:9px}figcaption{font-size:8pt;color:#637c71;margin-top:6px}.footer{position:absolute;bottom:9mm;left:18mm;right:18mm;padding-top:9px;border-top:1px solid #d5e2dc;display:flex;justify-content:space-between;font-size:7pt;color:#6c8278}.cover h1{font-size:43pt;margin-top:17px;margin-bottom:14px}.subtitle{font-size:14pt;line-height:1.5;color:#547266;max-width:85%;margin-bottom:23px}.cover figure{margin-bottom:21px}.cover-meta{display:flex;gap:20px;padding:13px 0;font-size:8pt;letter-spacing:.8px;font-weight:600}.workflow{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:17px 13px;background:#edf4ef;border-radius:8px;margin:18px 0}.workflow span{font-weight:600;color:#0d6553}.workflow b{color:#8faa9c}.invoice-heading{display:flex;justify-content:space-between;gap:10px;font-size:10pt;background:#e9f1ed;padding:10px 12px;margin-bottom:12px}.invoice-heading span{font-size:8pt}.review-form{margin:16px 0 18px;max-width:88%}.review-form>label{display:block;font-size:9pt;margin-bottom:4px}.form-box{height:28px;border:1px solid #a7bdb0;border-radius:3px;margin-bottom:11px;background:#f5f9f6}.review-checkbox{display:flex;gap:10px;align-items:center;margin-top:12px;font-size:9pt}.check-box{width:15px;height:15px;border:1px solid #a7bdb0;background:white;flex-shrink:0}
</style></head><body>${pages.map((page, index) => `<section class="page ${page.kind || ''}"><header class="running"><img data-visual="logo" alt="Northstar logo"><span>Northstar Project Handbook</span><span>COMPLETE PDF SAMPLE</span></header><main>${page.marker ? '<div class="marker">SECTION START</div>' : ''}<div class="eyebrow">${page.eyebrow}</div><h1>${escape(page.title)}</h1>${page.subtitle ? `<p class="subtitle">${page.subtitle}</p>` : ''}${page.body}</main><footer class="footer"><span>Fictional sample · original content · no password</span><span>Page ${index + 1} / ${pages.length}</span></footer></section>`).join('')}</body></html>`

await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
let raw, anchors, forms
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1300 } })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => {
    const make = (width, height, draw) => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; draw(canvas.getContext('2d'), width, height); return canvas.toDataURL('image/png') }
    const visuals = {}
    visuals.logo = make(160, 160, (ctx, w, h) => {
      ctx.fillStyle = '#0d7865'; ctx.beginPath(); ctx.arc(w / 2, h / 2, 72, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 11; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(47, 112); ctx.lineTo(47, 48); ctx.lineTo(112, 112); ctx.lineTo(112, 48); ctx.stroke()
    })
    visuals.landscape = make(1400, 480, (ctx, w, h) => {
      const sky = ctx.createLinearGradient(0, 0, w, h); sky.addColorStop(0, '#dcece7'); sky.addColorStop(1, '#a9cbbf'); ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h)
      ctx.fillStyle = '#f6d892'; ctx.beginPath(); ctx.arc(1120, 110, 63, 0, Math.PI * 2); ctx.fill()
      for (const [color, y, shift] of [['#8db5a6', 290, .1], ['#4a8e78', 350, 1.4], ['#175f4e', 415, 2.5]]) { ctx.beginPath(); ctx.moveTo(0, h); for (let x = 0; x <= w; x += 4) ctx.lineTo(x, y + Math.sin(x / 230 + shift) * 42 + Math.cos(x / 370) * 26); ctx.lineTo(w, h); ctx.fillStyle = color; ctx.fill() }
      ctx.fillStyle = '#f8f1df'; ctx.fillRect(550, 202, 300, 169); ctx.fillStyle = '#175f4e'; ctx.beginPath(); ctx.moveTo(515, 202); ctx.lineTo(700, 93); ctx.lineTo(884, 202); ctx.fill()
      ctx.fillStyle = '#c3dbd1'; ctx.fillRect(582, 230, 66, 65); ctx.fillRect(752, 230, 66, 65); ctx.fillStyle = '#326d5b'; ctx.fillRect(673, 257, 54, 114)
      ctx.fillStyle = '#c9ad7c'; ctx.beginPath(); ctx.moveTo(673, 371); ctx.lineTo(727, 371); ctx.lineTo(806, 480); ctx.lineTo(595, 480); ctx.fill()
      const tree = (x, y, scale) => { ctx.fillStyle = '#845c40'; ctx.fillRect(x - 10 * scale, y, 20 * scale, 100 * scale); ctx.fillStyle = '#2c7661'; for (const [dx, dy, r] of [[0, -30, 58], [-30, 3, 48], [30, 8, 48]]) { ctx.beginPath(); ctx.arc(x + dx * scale, y + dy * scale, r * scale, 0, Math.PI * 2); ctx.fill() } }
      tree(290, 257, 1.3); tree(1010, 285, 1); tree(1220, 300, .8)
    })
    visuals.budget = make(1300, 320, (ctx, w, h) => {
      ctx.fillStyle = '#f3f7f4'; ctx.fillRect(0, 0, w, h)
      const income = [2100, 2400, 2800, 3300], costs = [2000, 2200, 2500, 2700]
      ctx.strokeStyle = '#d7e3dc'; ctx.lineWidth = 2
      for (let value = 0; value <= 3500; value += 1000) { const y = 263 - value / 3500 * 200; ctx.beginPath(); ctx.moveTo(95, y); ctx.lineTo(1250, y); ctx.stroke(); ctx.fillStyle = '#5c776a'; ctx.font = '20px Arial'; ctx.fillText('$' + value, 12, y + 7) }
      for (let index = 0; index < 4; index++) { const x = 180 + index * 275; for (const [offset, value, color] of [[0, income[index], '#0d7865'], [69, costs[index], '#d2a957']]) { ctx.fillStyle = color; const height = value / 3500 * 200; ctx.fillRect(x + offset, 263 - height, 58, height) } ctx.fillStyle = '#345c4b'; ctx.font = '22px Arial'; ctx.fillText('Month ' + (index + 1), x + 12, 299) }
      ctx.font = '21px Arial'; ctx.fillStyle = '#0d7865'; ctx.fillRect(928, 14, 18, 18); ctx.fillStyle = '#345c4b'; ctx.fillText('Income', 955, 31); ctx.fillStyle = '#d2a957'; ctx.fillRect(1088, 14, 18, 18); ctx.fillStyle = '#345c4b'; ctx.fillText('Cost', 1115, 31)
    })
    for (const img of document.querySelectorAll('[data-visual]')) img.src = visuals[img.dataset.visual]
  })
  await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())))
  await page.emulateMedia({ media: 'print' })
  const geometry = await page.evaluate(() => {
    const anchors = [], forms = [], overflow = []
    const rectangle = (element, section) => { const box = element.getBoundingClientRect(), paper = section.getBoundingClientRect(); return [box.left - paper.left, box.top - paper.top, box.width, box.height] }
    document.querySelectorAll('.page').forEach((section, index) => {
      const main = section.querySelector('main').getBoundingClientRect(), footer = section.querySelector('footer').getBoundingClientRect()
      if (main.bottom > footer.top - 8) overflow.push(index + 1)
      section.querySelectorAll('[data-link-type]').forEach(element => { const paper = section.getBoundingClientRect(); for (const box of element.getClientRects()) anchors.push({ page: index + 1, type: element.dataset.linkType, target: element.dataset.linkTarget, rect: [box.left - paper.left, box.top - paper.top, box.width, box.height] }) })
      section.querySelectorAll('[data-form]').forEach(element => forms.push({ page: index + 1, key: element.dataset.form, rect: rectangle(element, section) }))
    })
    return { anchors, forms, overflow }
  })
  if (geometry.overflow.length) throw new Error(`Content needs more room on pages: ${geometry.overflow.join(', ')}`)
  anchors = geometry.anchors; forms = geometry.forms
  raw = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, displayHeaderFooter: false })
} finally { await browser.close() }

const document = await PDFDocument.load(raw, { updateMetadata: false })
if (document.getPageCount() !== 12) throw new Error(`Expected 12 pages, generated ${document.getPageCount()}`)
document.setTitle('Northstar Project Handbook - Complete Bookmark Test')
document.setAuthor('CreatePDF Sample Library')
document.setSubject('Fictional twelve-page report with three bookmark levels, tables, images, links, and interactive form fields')
document.setKeywords(['sample PDF', 'bookmark splitting', 'nested outline', 'text markers', 'forms', 'tables', 'clickable links'])
document.setLanguage('en-US')
const destinations = { 'planning-start': 3, 'operations-start': 5, 'finance-start': 7, 'launch-start': 9, 'appendix-start': 11 }
const names = []
for (const [key, page] of Object.entries(destinations).sort(([a], [b]) => a.localeCompare(b))) names.push(PDFString.of(key), document.context.obj([document.getPage(page - 1).ref, 'Fit']))
document.catalog.set(PDFName.of('Names'), document.context.obj({ Dests: { Names: names } }))
const pdfRect = rect => [rect[0] * .75, document.getPage(0).getHeight() - (rect[1] + rect[3]) * .75, (rect[0] + rect[2]) * .75, document.getPage(0).getHeight() - rect[1] * .75]
for (const anchor of anchors) {
  const entry = { Type: 'Annot', Subtype: 'Link', Rect: pdfRect(anchor.rect), Border: [0, 0, 0] }
  if (anchor.type === 'page') entry.Dest = [document.getPage(Number(anchor.target) - 1).ref, 'Fit']
  else if (anchor.type === 'named') entry.Dest = PDFString.of(anchor.target)
  else entry.A = { S: 'URI', URI: PDFString.of(anchor.target) }
  const page = document.getPage(anchor.page - 1)
  entry.P = page.ref
  page.node.addAnnot(document.context.register(document.context.obj(entry)))
}

const form = document.getForm(), font = await document.embedFont(StandardFonts.Helvetica)
for (const field of forms) {
  const [x, y, right, top] = pdfRect(field.rect), page = document.getPage(field.page - 1)
  const options = { x, y, width: right - x, height: top - y, borderWidth: .6, borderColor: rgb(.64, .74, .68), backgroundColor: rgb(.97, .99, .97) }
  if (field.key === 'review.complete') form.createCheckBox(field.key).addToPage(page, options)
  else { const input = form.createTextField(field.key); input.setMaxLength(100); input.addToPage(page, { ...options, font }); input.setFontSize(10) }
}
form.updateFieldAppearances(font)

function writeOutline(pdf, entries) {
  const rootRef = pdf.context.nextRef()
  let total = 0
  const writeSiblings = (items, parentRef, depth = 1) => {
    const records = items.map(item => ({ item, ref: pdf.context.nextRef() }))
    let count = 0
    for (const [index, { item, ref }] of records.entries()) {
      const dict = pdf.context.obj({ Title: PDFHexString.fromText(item.title), Parent: parentRef, F: depth === 1 ? 2 : 0 })
      if (index) dict.set(PDFName.of('Prev'), records[index - 1].ref)
      if (index + 1 < records.length) dict.set(PDFName.of('Next'), records[index + 1].ref)
      if (item.page) dict.set(PDFName.of('Dest'), pdf.context.obj([pdf.getPage(item.page - 1).ref, 'Fit']))
      else if (item.name) dict.set(PDFName.of('Dest'), PDFString.of(item.name))
      else if (item.url) dict.set(PDFName.of('A'), pdf.context.obj({ S: 'URI', URI: PDFString.of(item.url) }))
      if (item.children?.length) {
        const children = writeSiblings(item.children, ref, depth + 1)
        dict.set(PDFName.of('First'), children.first); dict.set(PDFName.of('Last'), children.last); dict.set(PDFName.of('Count'), pdf.context.obj(children.count)); count += children.count
      }
      pdf.context.assign(ref, dict); count++; total++
    }
    return { first: records[0].ref, last: records.at(-1).ref, count }
  }
  const result = writeSiblings(entries, rootRef)
  pdf.context.assign(rootRef, pdf.context.obj({ Type: 'Outlines', First: result.first, Last: result.last, Count: result.count }))
  pdf.catalog.set(PDFName.of('Outlines'), rootRef); pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  return total
}

const mainOutline = [
  { title: 'Chapter 1: Planning', page: 3, children: [{ title: '1.1 Project brief', page: 3 }, { title: '1.2 Requirements', page: 4, children: [{ title: '1.2.1 Constraints and change control', page: 4 }] }] },
  { title: 'Chapter 2: Operations', name: 'operations-start', children: [{ title: '2.1 Session workflow', page: 5 }, { title: '2.2 Quality checks', page: 6, children: [{ title: '2.2.1 Document and link checks', page: 6 }] }] },
  { title: 'Chapter 3: Finance', page: 7, children: [{ title: '3.1 Funding and forecasts', page: 7 }, { title: '3.2 Sample purchase record', page: 8, children: [{ title: '3.2.1 Invoice line items', page: 8 }] }] },
  { title: 'Chapter 4: Delivery', page: 9, children: [{ title: '4.1 The 90-day roadmap', page: 9 }, { title: '4.2 Weekly review', page: 10, children: [{ title: '4.2.1 Action log', page: 10 }] }] },
  { title: 'Appendix: Reference', page: 11, children: [{ title: 'A. Glossary', page: 11 }, { title: 'B. Acceptance checklist', page: 12, children: [{ title: 'B.1 Reviewer sign-off', page: 12 }] }] },
]
const bookmarkCount = writeOutline(document, mainOutline)
const bytes = await document.save({ useObjectStreams: true, updateFieldAppearances: false })
await writeFile(mainFile, bytes)

const edgeDocument = await PDFDocument.load(bytes, { updateMetadata: false })
edgeDocument.setTitle('Northstar Project Handbook - Bookmark Edge Cases')
const edgeCount = writeOutline(edgeDocument, [
  { title: 'Finance - listed first, target page 7', page: 7, children: [{ title: 'Forecast detail', page: 7 }, { title: 'Sample invoice', page: 8 }] },
  { title: 'Planning - listed second, target page 3', page: 3, children: [{ title: 'Project brief', page: 3 }, { title: 'Requirements', page: 4 }] },
  { title: 'Planning quick link - same page 3', name: 'planning-start' },
  { title: 'External website - not an internal split point', url: 'https://example.com' },
  { title: 'Operations group - heading has no target', children: [{ title: 'Operations workflow', name: 'operations-start' }, { title: 'Operations quality checks', page: 6 }] },
  { title: 'Unresolved destination - manually assign page 9', name: 'missing-destination-for-review' },
  { title: 'Appendix - target page 11', page: 11, children: [{ title: 'Glossary', page: 11 }, { title: 'Review form', page: 12 }] },
])
await writeFile(edgeFile, await edgeDocument.save({ useObjectStreams: true, updateFieldAppearances: false }))

const guide = `# Bookmark splitter test PDFs

Both PDFs contain the same complete, fictional 12-page Northstar handbook. No passwords or account details are needed. The edge-case file deliberately changes the bookmark outline; it does not change the report content.

## Main PDF: Bookmark_Split_Complete_Test.pdf

- 12 A4 pages with a cover, clickable contents, four chapters, and an appendix.
- ${bookmarkCount} usable bookmarks: 5 at level 1, 10 at level 2, and 5 at level 3.
- Three unique embedded raster illustrations: a transparent logo, a landscape illustration, and a budget chart. The logo is reused throughout the document.
- Selectable text, multiple substantive tables, direct and named internal links, external web/email links, and three editable PDF form fields on page 12.

### Expected default result

Choose **Level 1** and **Keep as a separate front-matter PDF**. You should get exactly **6 files**:

| File | Title | Original pages |
| --- | --- | --- |
| 1 | Front matter | 1-2 |
| 2 | Chapter 1: Planning | 3-4 |
| 3 | Chapter 2: Operations | 5-6 |
| 4 | Chapter 3: Finance | 7-8 |
| 5 | Chapter 4: Delivery | 9-10 |
| 6 | Appendix: Reference | 11-12 |

With **Include in the first section**, expect **5 files**: Planning contains pages 1-4; the remaining ranges stay 5-6, 7-8, 9-10, and 11-12.

With **Level 2** and separate front matter, expect **11 files**: pages 1-2, then one file for each page from 3 through 12. **All bookmark levels** produces the same page ranges because bookmarks targeting the same page must be merged.

With **Level 3** and separate front matter, expect **6 files**: 1-3, 4-5, 6-7, 8-9, 10-11, and 12.

### Content checks

1. Preview Planning: its two pages should be pages 3 and 4 from the original.
2. The page-3 link to requirements on page 4 should work inside the Planning output. The return link should also work.
3. The page-4 link to Finance leaves the section, so it may be removed with an internal-link warning. It must not secretly include the Finance pages.
4. Each two-page chapter has similar within-chapter links. The Operations and Finance chapters also exercise named destinations.
5. External website links should still work. Email links open a mail application only; no message is sent by the PDF.
6. With **Keep relevant bookmarks** enabled, the Planning PDF should retain its chapter, two subsection entries, and one third-level entry (4 bookmarks). The other main two-page sections also retain 4 each. Front matter has 0.
7. Appendix should contain the glossary, checklist, and editable reviewer-name, reviewer-email, and review-complete fields. Test form filling in a normal PDF viewer; the in-app preview is a page rendering.
8. Every source page should occur exactly once across the output files. Filenames should have the right section titles, unique numbering, and no forbidden filesystem characters.

## Edge-case PDF: Bookmark_Split_Edge_Cases_Test.pdf

This version has ${edgeCount} outline entries across two levels: 12 have valid internal targets and 3 have no usable internal target initially.

- Finance is listed before Planning even though its target is later in the PDF. Output sections must follow source page order.
- Two top-level Planning bookmarks point to page 3; one uses a named destination. They must create one section boundary, not an empty duplicate file.
- An external website bookmark must not become a split point automatically.
- An untargeted Operations group has valid nested entries at pages 5 and 6.
- An unresolved named destination can be repaired by entering source page **9** in the review UI.

With the initial **Level 1** selection and separate front matter, expect **4 files** with ranges **1-2, 3-6, 7-10, 11-12**. Planning must be named Planning, not Finance.

If you manually assign page **9** to the unresolved entry, it becomes selected and creates another boundary. Expect **5 files**: **1-2, 3-6, 7-8, 9-10, 11-12**.

## Reuse with the other tools

- **Split by Text:** search for the exact literal marker \`SECTION START\`. It occurs only on pages 3, 5, 7, 9, and 11. Splitting before these pages yields the same 6 ranges as the main Level 1 bookmark split.
- **Repeated text:** \`Northstar Project Handbook\` appears in every running header. It can exercise repeated-match review and consecutive-match grouping.
- **Invoice text:** \`Invoice Number: NS-2026-008\` appears on page 8.
- **Extract Images:** inspect the illustrations and the repeated transparent logo.
- **PDF to HTML / EPUB:** inspect selectable text, headings, tables, pictures, links, and chapter order.
- **Compress PDF:** compare image quality, selectable text, and links. Savings depend on the settings and existing image compression; the file is not padded with meaningless data.

The app has not been tested as part of generating these files. These are sample inputs and expected outcomes for your own checks.
`
await writeFile(guideFile, guide)
console.log(JSON.stringify({ main: resolve(mainFile), edgeCases: resolve(edgeFile), guide: resolve(guideFile), pages: 12, mainBookmarks: bookmarkCount, edgeBookmarks: edgeCount, formFields: forms.length, linkAnnotations: anchors.length, mainBytes: bytes.length }, null, 2))
