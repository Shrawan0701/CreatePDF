import { PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFOptionList, PDFRadioGroup, PDFSignature, PDFString, PDFTextField, StandardFonts } from 'pdf-lib'
import { loadPdfBytes } from './pdfEngine'

const check = signal => { if (signal?.aborted) throw new DOMException('Form operation cancelled.', 'AbortError') }
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const formValueEmpty = value => Array.isArray(value) ? !value.length : typeof value === 'boolean' ? !value : !String(value ?? '').trim()
export const initialFormValues = source => Object.fromEntries(source.fields.map(field => [field.name, field.value]))

function fieldKind(field) {
  if (field instanceof PDFTextField) return 'text'
  if (field instanceof PDFCheckBox) return 'checkbox'
  if (field instanceof PDFRadioGroup) return 'radio'
  if (field instanceof PDFDropdown) return 'dropdown'
  if (field instanceof PDFOptionList) return 'list'
  if (field instanceof PDFSignature) return 'signature'
  return 'unsupported'
}

function fieldLabel(field) {
  let current = field.acroField
  for (let depth = 0; current && depth < 30; depth++, current = current.getParent()) {
    const tooltip = current.dict.lookupMaybe(PDFName.of('TU'), PDFString, PDFHexString)?.decodeText()
    if (tooltip?.trim()) return tooltip.trim()
  }
  return field.getName().split('.').at(-1).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2') || field.getName()
}

export async function readPdfForm(file, { signal } = {}) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.')
  const bytes = await loadPdfBytes(file); check(signal)
  let pdf
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }) }
  catch (error) { if (/encrypt|password/i.test(error.message)) throw new Error('Unlock this password-protected PDF before filling it.'); throw new Error('Could not open this PDF. Choose a valid PDF document.') }
  check(signal)
  if (pdf.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict)?.has(PDFName.of('XFA'))) throw new Error('This PDF uses XFA forms. Save a standard AcroForm version before filling it here.')
  const form = pdf.getForm()
  const pages = pdf.getPages(), pageRefs = new Map(pages.map((page, index) => [page.ref.toString(), index + 1])), annotationPages = new Map()
  pages.forEach((page, index) => { const annotations = page.node.Annots(); for (let item = 0; item < (annotations?.size() || 0); item++) annotationPages.set(annotations.get(item).toString(), index + 1) })
  const fields = form.getFields().map((field, index) => {
    const name = field.getName(), kind = fieldKind(field)
    const entry = { id: `pdf-form-field-${index}`, name, label: fieldLabel(field), kind, readOnly: field.isReadOnly() || ['signature', 'unsupported'].includes(kind), required: field.isRequired(), value: '', options: [], widgets: [], pages: [] }
    try {
      if (kind === 'text') { entry.value = field.getText() || ''; entry.multiline = field.isMultiline(); entry.password = field.isPassword(); entry.maxLength = field.getMaxLength() }
      if (kind === 'checkbox') entry.value = field.isChecked()
      if (kind === 'radio') { entry.options = field.getOptions().map(value => ({ value, label: value })); entry.value = field.getSelected() || '' }
      if (kind === 'dropdown' || kind === 'list') {
        entry.options = field.acroField.getOptions().map(option => ({ value: option.value.decodeText(), label: (option.display || option.value).decodeText() }))
        entry.multiple = field.isMultiselect(); entry.editable = kind === 'dropdown' && field.isEditable()
        const selected = field.getSelected().map(value => entry.options.find(option => option.value === value)?.value ?? entry.options.find(option => option.label === value)?.value ?? value)
        entry.value = entry.multiple ? selected : selected[0] || ''
      }
      for (const widget of field.acroField.getWidgets()) {
        const ref = pdf.context.getObjectRef(widget.dict)
        const page = pageRefs.get(widget.P()?.toString()) || (ref && annotationPages.get(ref.toString()))
        if (!page) continue
        entry.pages.push(page)
        // Hidden/no-view widgets retain their values but need no clickable target.
        if ((widget.getFlags() || 0) & (2 | 32)) continue
        const rect = widget.getRectangle()
        if (rect.width > 0 && rect.height > 0) entry.widgets.push({ page, rect })
      }
      entry.pages = [...new Set(entry.pages)].sort((a, b) => a - b)
    } catch { entry.kind = 'unsupported'; entry.readOnly = true }
    return entry
  })
  check(signal)
  return { file, bytes, fields, pageCount: pages.length, editableCount: fields.filter(field => !field.readOnly).length, canFlatten: fields.every(field => !['signature', 'unsupported'].includes(field.kind)) }
}

export async function createFilledFormPdf(source, values, { flatten = false, signal } = {}) {
  check(signal)
  if (flatten && !source.canFlatten) throw new Error('Keep this form editable to preserve its signature or unsupported fields.')
  const pdf = await PDFDocument.load(source.bytes, { updateMetadata: false }), form = pdf.getForm()
  const baseFont = await pdf.embedFont(StandardFonts.Helvetica)
  let unicodeFonts
  const appearanceFont = async (value, label) => {
    const text = String(value).replace(/[\r\n\t]/g, ' ')
    try { baseFont.encodeText(text); return baseFont } catch { /* Try the locally bundled Unicode fonts below. */ }
    if (!unicodeFonts) { const { embedUnicodeFonts } = await import('./unicodePdf'); unicodeFonts = await embedUnicodeFonts(pdf) }
    const candidates = Object.values(unicodeFonts.scripts || {}).map(family => family.regular)
    for (const font of candidates) {
      const characters = new Set(font.getCharacterSet())
      if (!Array.from(text).every(character => characters.has(character.codePointAt(0)) || /[\u200c\u200d]/.test(character))) continue
      try { font.encodeText(text); return font } catch { /* Try the next script font without replacing the entered text. */ }
    }
    throw new Error(`${label}: this text contains characters the available form fonts cannot display.`)
  }
  for (let index = 0; index < source.fields.length; index++) {
    check(signal)
    const entry = source.fields[index], field = form.getField(entry.name)
    if (['signature', 'unsupported'].includes(entry.kind)) continue
    const value = Object.hasOwn(values, entry.name) ? values[entry.name] : entry.value
    let choiceValues
    try {
      if (!entry.readOnly && !equal(value, entry.value)) {
        if (entry.kind === 'text') {
          const text = String(value ?? '')
          if (entry.maxLength != null && text.length > entry.maxLength) throw new Error(`Use up to ${entry.maxLength} characters.`)
          field.setText(text)
        } else if (entry.kind === 'checkbox') value ? field.check() : field.uncheck()
        else if (entry.kind === 'radio') { if (value) field.select(String(value)); else field.clear() }
        else {
          const selected = (Array.isArray(value) ? value : value === '' || value == null ? [] : [value]).map(String)
          if (!entry.editable && selected.some(value => !entry.options.some(option => option.value === value))) throw new Error('Choose one of the available options.')
          choiceValues = selected
          const labels = selected.map(value => entry.options.find(option => option.value === value)?.label ?? value)
          labels.length ? field.select(labels) : field.clear()
        }
      }
      if (field.needsAppearancesUpdate()) {
        const actualValue = entry.readOnly ? entry.value : value
        if (['dropdown', 'list'].includes(entry.kind) && !choiceValues) {
          choiceValues = (Array.isArray(actualValue) ? actualValue : actualValue ? [actualValue] : []).map(String)
          const labels = choiceValues.map(value => entry.options.find(option => option.value === value)?.label ?? value)
          labels.length ? field.select(labels) : field.clear()
        }
        const text = entry.kind === 'list' ? entry.options.map(option => option.label).join(' ') : choiceValues ? choiceValues.map(value => entry.options.find(option => option.value === value)?.label ?? value).join(' ') : Array.isArray(actualValue) ? actualValue.join(' ') : String(actualValue ?? '')
        const font = ['text', 'dropdown', 'list'].includes(entry.kind) ? await appearanceFont(text, entry.label) : baseFont
        field.defaultUpdateAppearances(font)
      }
      if (choiceValues) {
        // pdf-lib's choice appearance helpers expect display labels. Restore
        // the PDF export values after drawing those labels, without dirtying AP.
        const dict = field.acroField.dict, encoded = choiceValues.map(value => PDFHexString.fromText(value))
        if (!encoded.length) dict.delete(PDFName.of('V'))
        else dict.set(PDFName.of('V'), encoded.length === 1 ? encoded[0] : pdf.context.obj(encoded))
        if (encoded.length > 1) dict.set(PDFName.of('I'), pdf.context.obj(choiceValues.map(value => entry.options.findIndex(option => option.value === value)).filter(index => index >= 0).sort((a, b) => a - b)))
        else dict.delete(PDFName.of('I'))
      }
    } catch (error) { throw new Error(error.message.startsWith(`${entry.label}:`) ? error.message : `${entry.label}: ${error.message || 'Could not save this value.'}`) }
    if (index % 12 === 0) { await tick(); check(signal) }
  }
  if (flatten) form.flatten({ updateFieldAppearances: false })
  check(signal)
  const bytes = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false })
  check(signal)
  return new Blob([bytes], { type: 'application/pdf' })
}
