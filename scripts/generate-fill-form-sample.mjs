import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, rgb } from 'pdf-lib'

// Generate content-rich documents for manual use of the Fill PDF Form tool.
// This script creates assets only; it does not run application checks.
const pdf = await PDFDocument.create(), regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold)
const form = pdf.getForm(), width = 595.28, height = 841.89, margin = 46
const ink = rgb(.12, .17, .19), accent = rgb(.15, .43, .36), muted = rgb(.40, .46, .47), border = rgb(.68, .75, .73), pale = rgb(.96, .98, .97)
pdf.setTitle('Community Workshop Registration - Fillable Sample'); pdf.setAuthor('CreatePDF.si'); pdf.setSubject('Three-page sample with text, checkbox, radio, dropdown and list fields'); pdf.setCreator('CreatePDF.si')

function text(page, value, x, top, size = 10, font = regular, color = ink) { page.drawText(value, { x, y: height - top - size, size, font, color }) }
function paragraph(page, value, top, { x = margin, maxWidth = width - margin * 2, size = 10, lineHeight = 15 } = {}) {
  let line = '', y = top
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word
    if (line && regular.widthOfTextAtSize(candidate, size) > maxWidth) { text(page, line, x, y, size, regular, muted); y += lineHeight; line = word }
    else line = candidate
  }
  if (line) text(page, line, x, y, size, regular, muted)
}
function label(field, value) { field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(value)); return field }
function section(page, value, top) {
  page.drawRectangle({ x: margin, y: height - top - 28, width: width - margin * 2, height: 28, color: pale })
  text(page, value, margin + 10, top + 7, 11, bold, accent)
}
function addTextWidget(page, field, title, x, top, w, h = 30, readOnly = false) {
  text(page, title, x, top - 17, 9, bold, muted)
  field.addToPage(page, { x, y: height - top - h, width: w, height: h, font: regular, textColor: ink, borderColor: border, backgroundColor: readOnly ? pale : rgb(1, 1, 1), borderWidth: .8 })
}
function textField(page, name, title, x, top, w, { h = 30, required = false, readOnly = false, multiline = false, maxLength = 100, value = '' } = {}) {
  const field = label(form.createTextField(name), title.replace(/ \*$/, ''))
  if (multiline) field.enableMultiline()
  field.setMaxLength(maxLength)
  if (required) field.enableRequired()
  if (value) field.setText(value)
  if (readOnly) field.enableReadOnly()
  addTextWidget(page, field, title, x, top, w, h, readOnly)
  field.setFontSize(11)
  return field
}
function dropdown(page, name, title, x, top, w, choices, { required = false, editable = false } = {}) {
  const field = label(form.createDropdown(name), title.replace(/ \*$/, ''))
  field.acroField.setOptions(choices.map(choice => typeof choice === 'string' ? { value: PDFHexString.fromText(choice) } : { value: PDFHexString.fromText(choice.value), display: PDFHexString.fromText(choice.label) }))
  if (required) field.enableRequired()
  if (editable) field.enableEditing()
  text(page, title, x, top - 17, 9, bold, muted)
  field.addToPage(page, { x, y: height - top - 30, width: w, height: 30, font: regular, textColor: ink, borderColor: border, backgroundColor: rgb(1, 1, 1), borderWidth: .8 })
  field.setFontSize(11)
  return field
}
function checkbox(page, name, title, x, top, required = false) {
  const field = label(form.createCheckBox(name), title)
  if (required) field.enableRequired()
  field.addToPage(page, { x, y: height - top - 14, width: 14, height: 14, borderColor: border, backgroundColor: rgb(1, 1, 1), borderWidth: .8 })
  text(page, title + (required ? ' *' : ''), x + 23, top + 1, 9)
  return field
}
function radio(page, name, title, choices, x, top, horizontal = false, required = false) {
  const field = label(form.createRadioGroup(name), title.replace(/ \*$/, ''))
  if (required) field.enableRequired()
  text(page, title, x, top - 22, 9, bold, muted)
  choices.forEach((value, index) => {
    const left = x + (horizontal ? index * 113 : 0), y = top + (horizontal ? 0 : index * 31)
    field.addOptionToPage(value, page, { x: left, y: height - y - 14, width: 14, height: 14, borderColor: border, backgroundColor: rgb(1, 1, 1), borderWidth: .8 })
    text(page, value, left + 22, y, 10)
  })
  return field
}
function page(title, number, subtitle) {
  const item = pdf.addPage([width, height])
  item.drawRectangle({ x: 0, y: height - 12, width, height: 12, color: accent })
  text(item, 'COMMUNITY LEARNING / SAMPLE FORM', margin, 38, 9, bold, accent)
  text(item, title, margin, 62, 24, bold)
  text(item, subtitle, margin, 97, 10, regular, muted)
  item.drawLine({ start: { x: margin, y: 57 }, end: { x: width - margin, y: 57 }, thickness: .7, color: border })
  text(item, 'CreatePDF.si  |  Fictional details for manual form testing', margin, height - 43, 8, regular, muted)
  text(item, `${number} / 3`, width - margin - 25, height - 43, 8, regular, muted)
  const linkText = 'Workshop information', linkTop = height - 73
  text(item, linkText, margin, linkTop, 9, regular, accent)
  const annotation = pdf.context.register(pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [margin, 66, margin + regular.widthOfTextAtSize(linkText, 9), 79], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.org/workshops') } }))
  item.node.addAnnot(annotation)
  return item
}

const p1 = page('Workshop registration', 1, 'Participant details / 12-13 December 2026 / Pune learning centre')
section(p1, '1. Participant details', 132)
const fullName = textField(p1, 'participant.fullName', 'Full name *', margin, 192, 312, { required: true, maxLength: 70 })
textField(p1, 'participant.birthDate', 'Date of birth (YYYY-MM-DD)', 380, 192, 169, { maxLength: 10 })
textField(p1, 'participant.email', 'Email address *', margin, 265, 312, { required: true, maxLength: 90 })
textField(p1, 'participant.phone', 'Phone number', 380, 265, 169, { maxLength: 25 })
textField(p1, 'participant.address', 'Postal address', margin, 338, 503, { h: 77, multiline: true, maxLength: 240 })
dropdown(p1, 'participant.country', 'Country *', margin, 463, 239, [{ value: 'IN', label: 'India' }, { value: 'GB', label: 'United Kingdom' }, { value: 'US', label: 'United States' }, { value: 'DE', label: 'Germany' }, { value: 'AU', label: 'Australia' }], { required: true })
textField(p1, 'participant.postalCode', 'Postal code', 310, 463, 239, { maxLength: 12 })
radio(p1, 'participant.contactMethod', 'Preferred contact method', ['Email', 'Phone', 'SMS'], margin, 555, true).select('Email')
section(p1, 'About this programme', 603)
paragraph(p1, 'This two-day community workshop explores practical ways to organise documents, design readable pages and share information. Bring a laptop if available; printed materials and a shared device station will also be provided.', 647)
paragraph(p1, 'Complete the fields marked with an asterisk. Other fields are optional. The information on these pages is a sample for trying form filling, saving and reopening a PDF.', 707, { size: 9, lineHeight: 13 })

const p2 = page('Sessions and preferences', 2, 'Choose sessions, attendance and any support you would like us to arrange.')
section(p2, '2. Your workshop plan', 132)
text(p2, 'Sessions (choose one or more) *', margin, 177, 9, bold, muted)
const sessions = label(form.createOptionList('workshop.sessions'), 'Workshop sessions')
sessions.addOptions(['Document design', 'Creative coding', 'Digital filing', 'Accessible documents']); sessions.enableMultiselect(); sessions.enableRequired()
sessions.addToPage(p2, { x: margin, y: height - 203 - 123, width: 239, height: 123, font: regular, textColor: ink, borderColor: border, backgroundColor: rgb(1, 1, 1), borderWidth: .8 }); sessions.setFontSize(11); sessions.select(['Document design'])
radio(p2, 'workshop.attendance', 'Attendance *', ['In person', 'Online', 'Hybrid'], 331, 205, false, true)
dropdown(p2, 'workshop.meal', 'Meal preference', 331, 324, 218, ['No meal required', 'Vegetarian', 'Vegan', 'Other'])
dropdown(p2, 'workshop.experience', 'Experience (or type your own)', margin, 402, 239, ['Beginner', 'Some experience', 'Regular practitioner'], { editable: true })
textField(p2, 'workshop.participants', 'Number of attendees', 331, 402, 218, { maxLength: 2, value: '1' })
textField(p2, 'workshop.accessibility', 'Accessibility or equipment needs', margin, 479, 503, { h: 82, multiline: true, maxLength: 300 })
checkbox(p2, 'updates.newsletter', 'Send me the monthly learning newsletter', margin, 597)
checkbox(p2, 'updates.reminders', 'Send a reminder before the workshop', margin, 630).check()
section(p2, 'Programme at a glance', 675)
paragraph(p2, 'Saturday: welcome at 09:30, practical sessions until 16:30. Sunday: collaborative exercises from 10:00 to 15:30, followed by an optional showcase. A detailed timetable will be emailed after registration.', 718, { size: 9, lineHeight: 13 })

const p3 = page('Review and confirmation', 3, 'Check the details, add a typed confirmation and save a copy for your records.')
section(p3, '3. Registration summary', 132)
addTextWidget(p3, fullName, 'Participant name (linked to page 1)', margin, 191, 503)
const reference = textField(p3, 'office.reference', 'Registration reference (read-only)', margin, 268, 239, { value: 'WS-2026-DEMO-1042', readOnly: true, maxLength: 30 })
textField(p3, 'office.venue', 'Venue (read-only)', 310, 268, 239, { value: 'Pune learning centre', readOnly: true, maxLength: 60 })
paragraph(p3, 'Registration is complete when the required participant details, session choices and attendance mode are entered. The name above shares the same underlying field as page 1, so changing either copy updates both.', 326)
section(p3, '4. Confirmation', 402)
textField(p3, 'confirmation.typedName', 'Typed confirmation name *', margin, 465, 312, { required: true, maxLength: 70 })
textField(p3, 'confirmation.date', 'Date (YYYY-MM-DD)', 380, 465, 169, { maxLength: 10 })
checkbox(p3, 'confirmation.accurate', 'I confirm the sample registration details are complete.', margin, 535, true)
textField(p3, 'confirmation.notes', 'Additional comments', margin, 604, 503, { h: 64, multiline: true, maxLength: 250 })
paragraph(p3, 'Keep fields editable to continue making changes in another PDF reader. Choose a flattened copy when you want the entered values fixed on the page. The workshop-information link is included on every page.', 708, { size: 9, lineHeight: 13 })

form.updateFieldAppearances(regular)
const template = await pdf.save({ useObjectStreams: true })
// Build a completed reference from the same document, retaining editable fields.
const entries = {
  'participant.fullName': 'Alex Morgan', 'participant.birthDate': '1998-07-16', 'participant.email': 'alex.morgan@example.com', 'participant.phone': '+91 90000 12345',
  'participant.address': '42 Garden Lane\nPune, Maharashtra 411001', 'participant.postalCode': '411001',
  'workshop.participants': '2', 'workshop.accessibility': 'Please reserve a desk near a power socket.\nOne participant will use a shared laptop.',
  'confirmation.typedName': 'Alex Morgan', 'confirmation.date': '2026-10-20', 'confirmation.notes': 'Looking forward to the document design and creative coding sessions.',
}
for (const [name, value] of Object.entries(entries)) form.getTextField(name).setText(value)
form.getDropdown('participant.country').select('India'); form.getDropdown('workshop.meal').select('Vegetarian'); form.getDropdown('workshop.experience').select('Some experience')
form.getRadioGroup('workshop.attendance').select('In person'); sessions.select(['Document design', 'Creative coding']); form.getCheckBox('updates.newsletter').check(); form.getCheckBox('confirmation.accurate').check()
form.updateFieldAppearances(regular)
// Preserve the country field's actual export code while its appearance says India.
form.getDropdown('participant.country').acroField.dict.set(PDFName.of('V'), PDFHexString.fromText('IN'))
reference.enableReadOnly()
const completed = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false })
const samples = new URL('../public/samples/', import.meta.url), artifacts = new URL('../artifacts/', import.meta.url)
await mkdir(samples, { recursive: true }); await mkdir(artifacts, { recursive: true })
await writeFile(new URL('fillable-workshop-registration.pdf', samples), template)
await writeFile(new URL('fillable-workshop-registration.pdf', artifacts), template)
await writeFile(new URL('filled-workshop-example.pdf', artifacts), completed)
for (const url of [new URL('fillable-workshop-registration.pdf', artifacts), new URL('filled-workshop-example.pdf', artifacts)]) console.log(fileURLToPath(url))
