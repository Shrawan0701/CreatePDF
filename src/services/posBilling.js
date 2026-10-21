import { currencyFactor, countryTax, INVOICE_CURRENCIES } from './invoiceLocale'
import { formatCsv, parseCsv } from './csv'

export const newPosStore = () => ({ schemaVersion: 2, name: '', country: '', currency: 'USD', address: '', phone: '', taxId: '', taxName: 'Tax', taxInclusive: false })
export function normalizePosStore(value) {
  if (!value) return newPosStore()
  const legacy = !value.schemaVersion
  const country = value.country || (legacy ? 'IN' : '')
  return { ...newPosStore(), ...value, schemaVersion: 2, country, currency: INVOICE_CURRENCIES.includes(value.currency) ? value.currency : legacy ? 'INR' : 'USD', taxId: String(value.taxId ?? value.gstin ?? ''), taxName: value.taxName || countryTax(country).name, taxInclusive: value.taxInclusive === true }
}
export const newPosProduct = (id) => ({ id, name: '', price: '', gstRate: 0, sku: '', category: '', description: '', image: '' })
export function normalizePosProduct(product) {
  return { ...newPosProduct(product.id), name: String(product.name ?? '').trim(), currency: INVOICE_CURRENCIES.includes(product.currency) ? product.currency : 'INR', price: Number(product.price), gstRate: Number(product.gstRate ?? product.taxRate ?? 0), sku: String(product.sku ?? '').trim(), category: String(product.category ?? '').trim(), description: String(product.description ?? ''), image: typeof product.image === 'string' && /^data:image\/(png|jpeg|webp|gif|avif|bmp);base64,/i.test(product.image) ? product.image : '' }
}
export function posProductError(product) {
  if (!String(product.name || '').trim()) return 'Enter an item name.'
  if (String(product.name).length > 300) return 'Keep item names within 300 characters.'
  if (product.price == null || String(product.price).trim() === '' || !Number.isFinite(Number(product.price)) || Number(product.price) < 0 || Number(product.price) > 1e9) return 'Enter a price from 0 to 1,000,000,000.'
  if (!Number.isFinite(Number(product.gstRate)) || Number(product.gstRate) < 0 || Number(product.gstRate) > 100) return 'Enter a tax rate from 0 to 100%.'
  if (String(product.description || '').length > 2000) return 'Keep item descriptions within 2,000 characters.'
  if (String(product.sku || '').length > 100 || String(product.category || '').length > 100) return 'Keep SKUs and category names within 100 characters.'
  return ''
}
export function posBillError(items, discount, store, payment) {
  if (!items.length) return 'Add an item to the bill.'
  if (items.length > 500) return 'Use up to 500 items in one bill.'
  if (discount === '' || !Number.isFinite(Number(discount)) || Number(discount) < 0 || Number(discount) > 100) return 'Enter a discount from 0 to 100%.'
  for (const item of items) {
    const error = posProductError(item)
    if (error) return error
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) < .001 || Number(item.quantity) > 1e6) return `Enter a quantity from 0.001 to 1,000,000 for ${item.name}.`
    if (String(item.note || '').length > 2000) return 'Keep item notes within 2,000 characters.'
  }
  if (items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0) > 1e10) return 'The bill subtotal must be at most 10,000,000,000.'
  if (!INVOICE_CURRENCIES.includes(store.currency)) return 'Choose a valid currency in Store settings.'
  if (payment.method === 'Cash' && payment.received !== '' && (!Number.isFinite(Number(payment.received)) || Number(payment.received) < 0 || Number(payment.received) > 1e10)) return 'Enter a valid cash amount received.'
  return ''
}

// Decimal fractions avoid binary rounding errors such as 10.075 becoming 10.07.
const decimalRatio = value => {
  const finite = Number(value)
  if (!Number.isFinite(finite) || finite <= 0) return [0n, 1n]
  const [mantissa, exponent = '0'] = finite.toString().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const power = Number(exponent) - fraction.length, numerator = BigInt(whole + fraction)
  return power >= 0 ? [numerator * 10n ** BigInt(power), 1n] : [numerator, 10n ** BigInt(-power)]
}
const roundedRatio = (numerator, denominator) => numerator / denominator + (numerator % denominator * 2n >= denominator ? 1n : 0n)
export function posMinor(value, currency) {
  const [numerator, denominator] = decimalRatio(value)
  return Number(roundedRatio(numerator * BigInt(currencyFactor(currency)), denominator))
}

// Allocate the rounded bill discount across lines. The allocated amounts add up
// exactly, including mixed tax rates and zero/three-decimal currencies.
export function posTotals(items, discount, store) {
  const factor = BigInt(currencyFactor(store.currency))
  const gross = items.map(item => {
    const [price, priceDenominator] = decimalRatio(Math.min(1e9, Number(item.price))), [quantity, quantityDenominator] = decimalRatio(Math.min(1e6, Number(item.quantity)))
    return roundedRatio(price * quantity * factor, priceDenominator * quantityDenominator)
  })
  const subtotal = gross.reduce((sum, value) => sum + value, 0n)
  const [percent, percentDenominator] = decimalRatio(Math.min(100, Number(discount)))
  const discountAmount = roundedRatio(subtotal * percent, 100n * percentDenominator)
  const shares = gross.map((value, index) => ({ index, floor: subtotal ? value * discountAmount / subtotal : 0n, remainder: subtotal ? value * discountAmount % subtotal : 0n }))
  const allocated = shares.map(share => share.floor)
  const remainder = Number(discountAmount - allocated.reduce((sum, value) => sum + value, 0n))
  shares.sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1).slice(0, remainder).forEach(share => allocated[share.index]++)
  const lines = items.map((item, index) => {
    const rate = Math.max(0, Math.min(100, Number(item.gstRate) || 0)), net = gross[index] - allocated[index]
    const [rateNumerator, rateDenominator] = decimalRatio(rate)
    const tax = roundedRatio(net * rateNumerator, 100n * rateDenominator + (store.taxInclusive ? rateNumerator : 0n))
    return { gross: Number(gross[index]), discount: Number(allocated[index]), taxable: Number(store.taxInclusive ? net - tax : net), tax: Number(tax), rate, total: Number(store.taxInclusive ? net : net + tax) }
  })
  const tax = lines.reduce((sum, line) => sum + line.tax, 0)
  return { subtotal: Number(subtotal), discountAmount: Number(discountAmount), taxable: lines.reduce((sum, line) => sum + line.taxable, 0), tax, total: Number(subtotal - discountAmount) + (store.taxInclusive ? 0 : tax), lines }
}
export function posPayment(bill) {
  const total = bill.totals.total, method = bill.payment?.method || 'Not paid'
  const received = method === 'Not paid' ? 0 : method === 'Cash' && bill.payment.received !== '' ? posMinor(bill.payment.received, bill.store.currency) : total
  return { method, received, due: Math.max(0, total - received), change: Math.max(0, received - total), status: total === 0 ? 'No payment due' : received >= total && method !== 'Not paid' ? 'Paid' : received > 0 ? 'Part paid' : 'Unpaid' }
}
export function normalizePosBill(bill) {
  const store = normalizePosStore(bill.store)
  if (bill.schemaVersion === 2) return { ...bill, store }
  const factor = currencyFactor(store.currency)
  return { ...bill, schemaVersion: 2, store, customer: { name: '', phone: '', reference: '', ...bill.customer }, payment: { method: bill.customer?.payment || 'Not paid', received: '' }, totals: { ...posTotals(bill.items, bill.discount, store), ...Object.fromEntries(Object.entries(bill.totals).map(([key, value]) => [key, Math.round(Number(value) * factor)])) } }
}

const csvHeaders = ['Name', 'Price', 'Currency', 'Tax %', 'SKU', 'Category', 'Description']
export const posCatalogueCsv = products => formatCsv([csvHeaders, ...products.map(item => [item.name, item.price, item.currency, item.gstRate, item.sku, item.category, item.description])])
export function parsePosCatalogue(text, json = false, currency = 'USD') {
  let incoming
  if (json) incoming = JSON.parse(text)
  else {
    const [header, ...rows] = parseCsv(text)
    if (!header) throw new Error('The catalogue is empty.')
    const keys = header.map(value => value.trim().toLowerCase())
    if (!keys.includes('name') || !keys.includes('price')) throw new Error('CSV needs Name and Price columns. Optional: Tax %, SKU, Category, Description.')
    const at = (row, key) => row[keys.indexOf(key)] ?? ''
    incoming = rows.map(row => ({ name: at(row, 'name'), price: at(row, 'price'), currency: at(row, 'currency') || currency, gstRate: at(row, 'tax %') || 0, sku: at(row, 'sku'), category: at(row, 'category'), description: at(row, 'description') }))
  }
  if (!Array.isArray(incoming) || !incoming.length || incoming.length > 2000) throw new Error('Import a catalogue with 1 to 2,000 products.')
  return incoming.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Invalid product on row ${index + 2}.`)
    if (item.price == null || String(item.price).trim() === '') throw new Error(`Enter a price on row ${index + 2}.`)
    if (item.currency && !INVOICE_CURRENCIES.includes(item.currency)) throw new Error(`Choose a valid currency on row ${index + 2}.`)
    const normalized = normalizePosProduct(item), error = posProductError(normalized)
    if (error) throw new Error(`Row ${index + 2}: ${error}`)
    return normalized
  })
}
