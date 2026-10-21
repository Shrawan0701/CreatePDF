import { currencyDigits, INVOICE_CURRENCIES } from './invoiceLocale'

export const INVOICE_FIELDS = { supplierName: 'Supplier name', supplierAddress: 'Supplier address', invoiceNumber: 'Invoice / receipt number', invoiceDate: 'Invoice date', gstin: 'Supplier tax ID', currency: 'Currency', subtotal: 'Subtotal', discount: 'Invoice discount', tax: 'Tax', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', charges: 'Other charges', rounding: 'Rounding adjustment', grandTotal: 'Grand total' }
export const ITEM_FIELDS = ['description', 'quantity', 'price', 'discount', 'amount']
const monetary = ['subtotal', 'discount', 'tax', 'cgst', 'sgst', 'igst', 'charges', 'rounding', 'grandTotal']
const present = value => value !== null && value !== undefined && value !== ''
export function invoiceNumber(value) {
  if (!present(value)) return null
  let string = String(value).trim().replace(/[−–]/g, '-').replace(/[\s\u00a0\u202f]/g, '')
  if (!string) return null
  if (string.includes(',') && string.includes('.')) string = string.lastIndexOf(',') > string.lastIndexOf('.') ? string.replaceAll('.', '').replace(',', '.') : string.replaceAll(',', '')
  else if (/^-?\d+,\d{1,2}$/.test(string)) string = string.replace(',', '.')
  else string = string.replaceAll(',', '')
  return Number.isFinite(Number(string)) ? Number(string) : null
}
const choice = (value, choices, fallback = 'unknown') => choices.includes(value) ? value : fallback
export function normalizeInvoice(value) {
  const invoice = Object.fromEntries(Object.keys(INVOICE_FIELDS).map(key => [key, monetary.includes(key) ? invoiceNumber(value?.[key]) : String(value?.[key] ?? '')]))
  invoice.currency = invoice.currency.trim().toUpperCase()
  invoice.taxLabel = String(value?.taxLabel || 'Tax')
  invoice.taxTreatment = choice(value?.taxTreatment, ['exclusive', 'inclusive'])
  invoice.subtotalBasis = choice(value?.subtotalBasis, ['gross', 'net'])
  invoice.discountIncludedInSubtotal = typeof value?.discountIncludedInSubtotal === 'boolean' ? value.discountIncludedInSubtotal : null
  invoice.discountScope = choice(value?.discountScope, ['invoice', 'all'])
  invoice.discountPercent = invoiceNumber(value?.discountPercent)
  invoice.evidence = value?.evidence && typeof value.evidence === 'object' ? { ...value.evidence } : {}
  invoice.items = (Array.isArray(value?.items) ? value.items : []).slice(0, 500).map(item => ({
    description: String(item?.description ?? ''), quantity: invoiceNumber(item?.quantity), price: invoiceNumber(item?.price), discount: invoiceNumber(item?.discount), amount: invoiceNumber(item?.amount),
    discountType: choice(item?.discountType, ['amount', 'percent'], 'amount'), taxRate: invoiceNumber(item?.taxRate), taxAmount: invoiceNumber(item?.taxAmount), amountBasis: choice(item?.amountBasis, ['gross', 'net', 'total']),
  }))
  return invoice
}
const precision = invoice => INVOICE_CURRENCIES.includes(invoice.currency) ? currencyDigits(invoice.currency) : 2
const round = (value, digits) => Math.round((value + Math.sign(value) * Number.EPSILON * Math.max(1, Math.abs(value))) * 10 ** digits) / 10 ** digits
export const invoiceAmount = (value, invoice) => !present(value) ? 'Not found' : `${invoice.currency ? invoice.currency + ' ' : ''}${Number(value).toLocaleString('en-US', { minimumFractionDigits: precision(invoice), maximumFractionDigits: precision(invoice) })}`

// Read a monetary value at the end of a labelled line, never its percentage.
const currencyCodes = INVOICE_CURRENCIES.join('|')
const amountTail = new RegExp(`(?:([-+−])\\s*)?(?:(?:${currencyCodes})\\b\\s*|Rs\\.?\\s*|[$€£₹¥₩₫₱฿]\\s*)?([-+−]?\\s*\\d[\\d.,]*)(?:\\s*(?:${currencyCodes})\\b)?\\s*\\)?\\s*$`, 'u')
function trailingAmount(line) {
  const match = line.match(amountTail)
  if (!match || /%\s*\)?\s*$/.test(line)) return null
  const value = invoiceNumber(match[2])
  return { value: value == null ? null : /[-−]/.test(match[1] || '') ? -Math.abs(value) : value, start: match.index, text: match[0] }
}
const summaryLine = /^(?:sub\s*total|taxable\s+(?:amount|value)|net\s+subtotal|grand\s*total|total(?:\s+(?:amount|payable|due))?|invoice\s+discount|discount|(?:C|S|I)GST|GST|VAT|sales\s+tax|tax(?:es)?|balance\s+due|cash\s+received|change|shipping|delivery|freight|round(?:ing)?\s*(?:off|adjustment)?)\b/i

export function extractInvoiceLocally(text) {
  const lines = String(text).replaceAll('\u00a0', ' ').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const result = {}, evidence = {}, field = (key, regex) => {
    const match = String(text).match(regex)
    if (match?.[1]?.trim()) { result[key] = match[1].trim(); evidence[key] = 'observed' }
  }
  const labelled = (key, pattern) => {
    const index = lines.findIndex(line => pattern.test(line))
    if (index < 0) return
    let amount = trailingAmount(lines[index])
    if (!amount && lines[index + 1] && /^(?:[-+−]\s*)?(?:[A-Z]{3}\s*|[$€£₹¥₩₫₱฿]\s*)?[-+−]?\s*\d[\d.,]*(?:\s*[A-Z]{3})?$/.test(lines[index + 1])) amount = trailingAmount(lines[index + 1])
    if (amount?.value != null) { result[key] = key === 'discount' ? Math.abs(amount.value) : amount.value; evidence[key] = 'observed' }
  }
  field('supplierName', /(?:^|\n)\s*(?:supplier|vendor|seller)(?:\s+name)?\s*[:-]\s*([^\n]+)/i)
  field('supplierAddress', /(?:^|\n)\s*(?:supplier|seller|vendor)\s+address\s*[:-]\s*([^\n]+)/i)
  field('invoiceNumber', /(?:invoice|bill|receipt)\s*(?:no\.?|number|#)\s*[:#-]?\s*([\w/.-]+)/i)
  if (!result.invoiceNumber) field('invoiceNumber', /\b(POS-\d{8}-[A-Z0-9]+)\b/i)
  field('invoiceDate', /(?:^|\n)\s*(?:invoice\s+date|bill\s+date|date)\s*[:-]\s*([^\n]+)/i)
  if (result.invoiceDate) result.invoiceDate = result.invoiceDate.split(/\s+(?:due(?:\s+date)?|payment\s+due)\s*:/i)[0].trim()
  if (!result.invoiceDate) field('invoiceDate', /(?:^|\n)\s*(\d{1,4}[/.\-]\d{1,2}[/.\-]\d{1,4})(?:[,\s]|$)/)
  field('gstin', /(?:supplier\s+)?(?:GSTIN|VAT\s*(?:ID|number|no\.?)|tax\s*(?:ID|number|no\.?)|ABN)\s*[:-]?\s*([^\n]+)/i)
  const labelledCurrency = String(text).match(/\bcurrency\s*[:-]\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase()
  const nearbyCodes = [...String(text).matchAll(/\b([A-Z]{3})\s*[-+−]?\s*\d/g)].map(match => match[1])
  const code = INVOICE_CURRENCIES.includes(labelledCurrency) ? labelledCurrency : nearbyCodes.find(value => INVOICE_CURRENCIES.includes(value))
  if (code) result.currency = code
  else if (/₹|\bRs\.?\b/.test(text)) result.currency = 'INR'
  else if (/€/.test(text)) result.currency = 'EUR'
  else if (/£/.test(text)) result.currency = 'GBP'
  else if (/US\$/.test(text)) result.currency = 'USD'
  else if (/CA\$|C\$/.test(text)) result.currency = 'CAD'
  else if (/AU\$|A\$/.test(text)) result.currency = 'AUD'
  else if (/NZ\$/.test(text)) result.currency = 'NZD'
  if (result.currency) evidence.currency = 'observed'
  labelled('subtotal', /^(?:sub\s*total|taxable\s+(?:amount|value)|net\s+subtotal)\b/i)
  labelled('discount', /^(?:invoice\s+)?discount\b/i)
  labelled('cgst', /^CGST\b/i); labelled('sgst', /^SGST\b/i); labelled('igst', /^IGST\b/i)
  const taxPattern = /^(?:total\s+)?(?:GST|VAT|sales\s+tax|tax(?:es)?)\b(?!\s+invoice\b)/i
  labelled('tax', taxPattern)
  const taxLine = lines.find(line => taxPattern.test(line))
  if (taxLine) result.taxLabel = taxLine.match(taxPattern)[0].replace(/^total\s+/i, '').trim()
  labelled('grandTotal', /^(?:grand\s*total|total\s+(?:amount|payable|due)|net\s*(?:amount|payable))\b/i)
  if (result.grandTotal == null) labelled('grandTotal', /^total\b(?!\s+(?:tax|GST|VAT|discount|items|quantity|paid|before|excluding|after)\b)/i)
  labelled('rounding', /^round(?:ing)?\s*(?:off|adjustment)?\s*[:\s]/i)
  // Sum separately named charges instead of confusing shipping with item cost.
  const charges = lines.filter(line => /^(?:shipping|delivery|freight|service\s+charge|other\s+charges)\b/i.test(line)).map(trailingAmount).filter(entry => entry?.value != null)
  if (charges.length) { result.charges = charges.reduce((sum, entry) => sum + entry.value, 0); evidence.charges = 'observed' }
  if (/(?:tax|GST|VAT)\s*(?:\([^)]*)?(?:included|inclusive)|incl(?:uding|\.)?\s*(?:tax|GST|VAT)/i.test(text)) { result.taxTreatment = 'inclusive'; evidence.taxTreatment = 'observed' }
  else if (/(?:tax|GST|VAT)\s*(?:excluded|exclusive)|excl(?:uding|\.)?\s*(?:tax|GST|VAT)/i.test(text)) { result.taxTreatment = 'exclusive'; evidence.taxTreatment = 'observed' }
  if (lines.some(line => /^(?:taxable\s+(?:amount|value)|net\s+subtotal)/i.test(line))) { result.discountIncludedInSubtotal = true; evidence.discountIncludedInSubtotal = 'observed' }
  const discountLine = lines.find(line => /^(?:invoice\s+)?discount\b/i.test(line)), discountPercent = discountLine?.match(/(\d+(?:[.,]\d+)?)\s*%/)
  if (discountPercent) {
    result.discountPercent = invoiceNumber(discountPercent[1]); evidence.discountPercent = 'observed'
    if (result.discount == null && result.subtotal != null && result.discountIncludedInSubtotal !== true) { result.discount = round(result.subtotal * result.discountPercent / 100, precision(result)); evidence.discount = 'calculated' }
  }
  // Two-line thermal receipt items: name + gross amount, then quantity × rate.
  const receiptItems = []
  for (let index = 1; index < lines.length; index++) {
    const meta = lines[index].match(/^(\d+(?:[.,]\d+)?)\s*[×x*]\s*(?:[A-Z]{3}\s*|[$€£₹¥₩₫₱฿]\s*)?([\d.,]+)(?:\s*\|\s*(?:GST|VAT|tax|sales\s+tax)\s*(\d+(?:[.,]\d+)?)\s*%)?/i)
    if (!meta) continue
    const continuation = []
    for (let prior = index - 1; prior >= Math.max(0, index - 8); prior--) {
      if (summaryLine.test(lines[prior])) break
      const amount = trailingAmount(lines[prior]), description = amount ? lines[prior].slice(0, amount.start).trim() : ''
      if (amount && /\p{L}/u.test(description)) {
        receiptItems.push({ description: [description, ...continuation].join(' '), quantity: invoiceNumber(meta[1]), price: invoiceNumber(meta[2]), amount: amount.value, discount: null, taxRate: invoiceNumber(meta[3]), amountBasis: 'gross' }); break
      }
      continuation.unshift(lines[prior])
    }
  }
  const items = receiptItems.length ? receiptItems : []
  if (receiptItems.length) { evidence.items = 'receipt'; result.discountScope = 'invoice' }
  else {
    let header = []
    for (const line of lines) {
      if (/\b(qty|quantity)\b/i.test(line) && /\b(rate|price|amount)\b/i.test(line)) { header = line.split(/\s{2,}|\s*\|\s*|\t/).map(cell => cell.trim().toLowerCase()); continue }
      if (summaryLine.test(line)) { header = []; continue }
      if (!header.length) continue
      const columns = line.split(/\s{2,}|\s*\|\s*|\t/).filter(Boolean), at = pattern => header.findIndex(cell => pattern.test(cell))
      const get = pattern => { const index = at(pattern); return index < 0 ? null : invoiceNumber(columns[index]?.replace(/[^\d.,−-]/g, '')) }
      if (columns.length === header.length && at(/description|particular|product|item/) >= 0 && get(/amount|total/) != null) {
        const discountIndex = at(/discount/), amountIndex = at(/amount|total/)
        items.push({ description: columns[at(/description|particular|product|item/)], quantity: get(/qty|quantity/), price: get(/rate|price/), discount: get(/discount/), discountType: discountIndex >= 0 && /%/.test(header[discountIndex]) ? 'percent' : 'amount', amount: get(/amount|total/), taxRate: get(/(?:tax|gst|vat).*%/), amountBasis: /gross/.test(header[amountIndex]) ? 'gross' : /net|taxable/.test(header[amountIndex]) ? 'net' : 'unknown' })
      } else {
        const match = line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+([\d.,]+)\s+([\d.,]+)$/)
        if (match) items.push({ description: match[1], quantity: invoiceNumber(match[2]), price: invoiceNumber(match[3]), amount: invoiceNumber(match[4]) })
      }
    }
  }
  // Unlabelled receipt headings are separated from customer details by the ID.
  if (receiptItems.length && result.invoiceNumber) {
    const stop = lines.findIndex(line => line.includes(result.invoiceNumber))
    const heading = lines.slice(0, Math.max(0, stop)).filter(line => !/^(?:tax\s+invoice|invoice|receipt|bill|GSTIN|VAT|tax\s*ID|ABN)\b/i.test(line) && !/^\+?[\d\s()-]{7,}$/.test(line) && !line.includes('@'))
    if (!result.supplierName && heading[0]) { result.supplierName = heading[0]; evidence.supplierName = 'observed' }
    if (!result.supplierAddress && heading.length > 1) { result.supplierAddress = heading.slice(1).join(', '); evidence.supplierAddress = 'observed' }
  }
  return normalizeInvoice({ ...result, items, evidence })
}

export function mergeInvoiceExtraction(local, proposed, source = '') {
  const merged = normalizeInvoice(proposed)
  // Positional, explicitly labelled values take precedence over AI guesses.
  for (const key of Object.keys(local.evidence)) if (key !== 'items') merged[key] = local[key]
  merged.evidence = { ...local.evidence }
  if (local.evidence.items === 'receipt') {
    merged.items = local.items; merged.discountScope = 'invoice'
  } else if (!merged.items.length && local.items.length) merged.items = local.items
  if (local.evidence.tax) {
    merged.taxLabel = local.taxLabel
    // Plain GST/VAT is not evidence of an Indian CGST/SGST/IGST split.
    for (const key of ['cgst', 'sgst', 'igst']) if (!local.evidence[key]) merged[key] = null
  }
  if (merged.gstin && source && !source.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase().includes(merged.gstin.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase())) merged.gstin = ''
  return normalizeInvoice(merged)
}

export function analyzeInvoice(invoice) {
  const issues = [], checks = [], notes = [], digits = precision(invoice), unit = 10 ** -digits, tolerance = unit * 1.01
  const close = (a, b) => Math.abs(a - b) <= tolerance
  const amount = value => invoiceAmount(value, invoice)
  for (const key of ['supplierName', 'invoiceNumber', 'invoiceDate', 'grandTotal']) if (!present(invoice[key])) issues.push(`${INVOICE_FIELDS[key]} was not found. Add it if shown on the document.`)
  if (!invoice.currency) notes.push('Currency is not identified. Amount checks currently allow two decimal places.')
  else if (!INVOICE_CURRENCIES.includes(invoice.currency)) issues.push('Choose a supported currency for the amount checks.')
  if (invoice.gstin && /^\d{2}[A-Z]{5}\d{4}[A-Z]/i.test(invoice.gstin) && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(invoice.gstin.trim())) issues.push('The supplied GSTIN format needs review.')
  if (!invoice.items.length) issues.push('No line items were identified. Add them or try AI extraction.')
  const grossValues = [], netValues = [], lineDiscounts = []
  invoice.items.forEach((item, index) => {
    if (!item.description.trim()) issues.push(`Item ${index + 1}: add the description.`)
    if (![item.quantity, item.price, item.amount].every(present)) { notes.push(`Item ${index + 1}: not enough values to check quantity, unit price and amount.`); return }
    const gross = round(item.quantity * item.price, digits), discount = item.discountType === 'percent' ? round(gross * (item.discount || 0) / 100, digits) : Number(item.discount) || 0, net = round(gross - discount, digits)
    grossValues.push(gross); netValues.push(net); lineDiscounts.push(discount)
    if (item.discountType === 'percent' && (item.discount < 0 || item.discount > 100)) issues.push(`Item ${index + 1}: line discount must be between 0 and 100%.`)
    const inclusive = invoice.taxTreatment === 'inclusive'
    const tax = present(item.taxAmount) ? item.taxAmount : present(item.taxRate) ? round(inclusive ? net * item.taxRate / (100 + item.taxRate) : net * item.taxRate / 100, digits) : null
    const candidates = { gross, net: inclusive && tax != null ? round(net - tax, digits) : net, ...(inclusive ? { total: net } : tax != null ? { total: round(net + tax, digits) } : {}) }
    const matched = item.amountBasis === 'unknown' ? Object.keys(candidates).find(key => close(candidates[key], item.amount)) : close(candidates[item.amountBasis] ?? NaN, item.amount) ? item.amountBasis : null
    if (matched) checks.push(`Item ${index + 1}: ${matched === 'gross' ? 'quantity × unit price' : matched === 'net' ? 'quantity × unit price − line discount' : 'line value + line tax'} matches ${amount(item.amount)}.`)
    else if ((item.amountBasis !== 'gross' && !present(item.discount)) || (['unknown', 'total'].includes(item.amountBasis) && tax == null && !inclusive)) notes.push(`Item ${index + 1}: amount basis or line adjustments are not specified. Confirm whether ${amount(item.amount)} includes tax or discounts.`)
    else issues.push(`Item ${index + 1}: the amount ${amount(item.amount)} does not reconcile with its quantity, unit price and line adjustments. Check the amount basis.`)
  })
  const sum = values => round(values.reduce((total, value) => total + Number(value), 0), digits)
  if (present(invoice.subtotal) && invoice.items.length) {
    const candidates = []
    if (invoice.subtotalBasis === 'unknown' && invoice.items.every(item => present(item.amount))) candidates.push(sum(invoice.items.map(item => item.amount)))
    if (grossValues.length === invoice.items.length) {
      if (invoice.subtotalBasis !== 'net') candidates.push(sum(grossValues))
      if (invoice.subtotalBasis !== 'gross') candidates.push(sum(netValues))
    }
    if (invoice.discountIncludedInSubtotal === true && present(invoice.discount)) candidates.push(...candidates.map(value => round(value - invoice.discount, digits)))
    if (candidates.some(value => close(value, invoice.subtotal))) checks.push(`Subtotal matches the item values: ${amount(invoice.subtotal)}.`)
    else if (candidates.length) issues.push('Subtotal differs from the item totals. Check discounts, included tax or missing items.')
  }
  if (present(invoice.subtotal) && present(invoice.grandTotal)) {
    const breakdown = sum([invoice.cgst, invoice.sgst, invoice.igst].filter(present))
    const tax = present(invoice.tax) ? invoice.tax : breakdown, discount = Number(invoice.discount) || 0, charges = Number(invoice.charges) || 0, rounding = Number(invoice.rounding) || 0
    if (present(invoice.tax) && [invoice.cgst, invoice.sgst, invoice.igst].some(present) && !close(invoice.tax, breakdown)) issues.push('The tax total differs from its extracted CGST/SGST/IGST breakdown. Review those values.')
    const deductions = invoice.discountIncludedInSubtotal === true ? [0] : [discount]
    if (invoice.discountScope !== 'invoice' && lineDiscounts.length === invoice.items.length && lineDiscounts.some(Boolean) && discount >= sum(lineDiscounts)) deductions.push(discount - sum(lineDiscounts))
    const taxChoices = invoice.taxTreatment === 'inclusive' ? [0] : invoice.taxTreatment === 'exclusive' ? [tax] : [...new Set([tax, 0])]
    const candidates = deductions.flatMap(deduction => taxChoices.map(addTax => ({ expected: round(invoice.subtotal - deduction + addTax + charges + rounding, digits), deduction, addTax })))
    const match = candidates.find(candidate => close(candidate.expected, invoice.grandTotal))
    if (match) {
      checks.push(`${amount(invoice.subtotal)}${match.deduction ? ` − ${amount(match.deduction)}` : ''}${match.addTax ? ` + ${amount(match.addTax)} tax` : ''}${charges ? ` + ${amount(charges)} charges` : ''}${rounding ? ` + (${amount(rounding)}) rounding` : ''} = ${amount(invoice.grandTotal)}.`)
      if (tax && match.addTax === 0 && invoice.taxTreatment === 'unknown') notes.push('The total reconciles only when tax is already included. Confirm the tax treatment against the document.')
      if (match.deduction !== discount && invoice.discountIncludedInSubtotal !== true) notes.push('The summary discount reconciles as a total that already includes the line discounts. Confirm this interpretation against the document.')
    }
    else issues.push(`The extracted subtotal, discount, tax and adjustments give ${amount(candidates[0].expected)}, but grand total is ${amount(invoice.grandTotal)}. Review the source values and tax treatment.`)
  } else notes.push('Subtotal and grand total are needed to check the bill total.')
  if (invoice.evidence.discount === 'calculated') notes.push(`Invoice discount was calculated from the printed ${invoice.discountPercent}% rate and subtotal; its amount was not readable as text.`)
  if (invoice.items.some(item => !present(item.discount)) && invoice.discount) notes.push('The invoice discount is applied once at bill level, separately from item prices.')
  return { issues, checks, notes, status: issues.length ? 'Review needed' : checks.length ? 'Available amounts reconcile' : 'Limited amount checks' }
}
export const invoiceIssues = invoice => analyzeInvoice(invoice).issues
