import { formatCsv } from './csv';

export const INVOICE_FIELDS = { supplierName: 'Supplier name', supplierAddress: 'Supplier address', invoiceNumber: 'Invoice number', invoiceDate: 'Invoice date', gstin: 'Supplier GSTIN', currency: 'Currency', subtotal: 'Subtotal', discount: 'Invoice discount', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', grandTotal: 'Grand total' };
export const ITEM_FIELDS = ['description', 'quantity', 'price', 'discount', 'amount'];
const monetary = ['subtotal', 'discount', 'cgst', 'sgst', 'igst', 'grandTotal'];
const numeric = (value) => value === null || value === '' || value === undefined || !Number.isFinite(Number(String(value).replaceAll(',', ''))) ? null : Number(String(value).replaceAll(',', ''));

export function normalizeInvoice(value) {
  const invoice = Object.fromEntries(Object.keys(INVOICE_FIELDS).map((key) => [key, monetary.includes(key) ? numeric(value?.[key]) : value?.[key] == null ? '' : String(value[key])]));
  invoice.items = (Array.isArray(value?.items) ? value.items : []).map((item) => Object.fromEntries(ITEM_FIELDS.map((key) => [key, key === 'description' ? String(item.description || '') : numeric(item[key])])));
  return invoice;
}

export function extractInvoiceLocally(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const field = (pattern) => text.match(pattern)?.[1]?.trim() || '';
  const amount = (label) => {
    // Prefer the final amount on a labelled line, not a tax rate or invoice ID.
    const line = lines.find((entry) => label.test(entry));
    if (!line || /%\s*$/.test(line)) return null;
    const matches = line.match(/-?\d[\d,]*(?:\.\d{1,2})?/g);
    return matches?.length ? numeric(matches.at(-1)) : null;
  };
  const supplierName = field(/(?:supplier|vendor|seller)(?:\s+name)?\s*[:-]\s*([^\n]+)/i);
  const items = [];
  let inTable = false;
  let header = [];
  for (const line of lines) {
    if (/\b(qty|quantity)\b/i.test(line) && /\b(rate|price|amount)\b/i.test(line)) { inTable = true; header = line.split(/\s{2,}|\s*\|\s*|\t/).map((cell) => cell.toLowerCase()); continue; }
    if (!inTable) continue;
    if (/\b(sub\s*total|grand\s*total|cgst|sgst|igst|amount\s+in\s+words|bank\s+details|total\s+amount)\b/i.test(line)) { inTable = false; continue; }
    const columns = line.split(/\s{2,}|\s*\|\s*|\t/).filter(Boolean);
    const indexOf = (pattern) => header.findIndex((cell) => pattern.test(cell));
    if (columns.length === header.length && columns.length >= 3 && indexOf(/description|particular|product|item/) >= 0) {
      const description = columns[indexOf(/description|particular|product|item/)];
      const get = (pattern) => { const index = indexOf(pattern); return index < 0 ? null : numeric(columns[index].replace(/[^\d.,-]/g, '')); };
      if (get(/amount|total/) !== null) items.push({ description, quantity: get(/qty|quantity/), price: get(/rate|price/), discount: indexOf(/discount/) < 0 || header[indexOf(/discount/)].includes('%') ? null : get(/discount/), amount: get(/amount|total/) });
    } else {
      const match = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)$/);
      if (match) items.push({ description: match[1], quantity: numeric(match[2]), price: numeric(match[3]), discount: null, amount: numeric(match[4]) });
    }
  }
  return normalizeInvoice({ supplierName,
    supplierAddress: field(/(?:supplier\s+address|seller\s+address|address)\s*[:-]\s*([^\n]+)/i),
    invoiceNumber: field(/(?:invoice|bill)\s*(?:no\.?|number|#)\s*[:#-]?\s*([\w/.-]+)/i),
    invoiceDate: field(/(?:invoice\s+date|bill\s+date|date)\s*[:-]\s*([^\n]+)/i),
    gstin: field(/(?:supplier\s+)?GSTIN\s*[:-]?\s*([0-9A-Z]{15})/i).toUpperCase(),
    currency: /₹|\bINR\b|\bRs\.?/.test(text) ? 'INR' : /\bUSD\b|\$/.test(text) ? 'USD' : '', items,
    subtotal: amount(/\bsub\s*total\b|taxable\s+(?:amount|value)/i), discount: amount(/^\s*(?:invoice\s+)?discount\b(?![^\n]*%)/i),
    cgst: amount(/\bCGST\b/i), sgst: amount(/\bSGST\b/i), igst: amount(/\bIGST\b/i),
    grandTotal: amount(/grand\s*total|net\s*(?:amount|payable)|total\s*(?:amount|payable)/i),
  });
}

export function invoiceIssues(invoice) {
  const issues = [];
  for (const key of ['supplierName', 'invoiceNumber', 'invoiceDate', 'gstin', 'subtotal', 'grandTotal']) if (invoice[key] === '' || invoice[key] == null) issues.push(`Missing ${INVOICE_FIELDS[key].toLowerCase()}.`);
  if (invoice.gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(invoice.gstin)) issues.push('GSTIN format looks invalid.');
  if (!invoice.items.length) issues.push('No line items detected. Add them or try AI extraction.');
  const tolerance = .05;
  invoice.items.forEach((item, index) => {
    if (!item.description || ['quantity', 'price', 'amount'].some((key) => item[key] == null || item[key] === '')) issues.push(`Item ${index + 1}: missing description, quantity, price or amount.`);
    if (item.quantity != null && item.price != null && item.amount != null && Math.abs(item.quantity * item.price - (Number(item.discount) || 0) - item.amount) > tolerance) issues.push(`Item ${index + 1}: quantity × price − discount does not match its amount.`);
  });
  if (invoice.subtotal != null && invoice.items.length && invoice.items.every((item) => item.amount != null) && Math.abs(invoice.items.reduce((sum, item) => sum + Number(item.amount), 0) - invoice.subtotal) > tolerance) issues.push('Line item amounts do not add up to the subtotal.');
  if (invoice.subtotal != null && invoice.grandTotal != null) {
    const expected = Number(invoice.subtotal) - (Number(invoice.discount) || 0) + (Number(invoice.cgst) || 0) + (Number(invoice.sgst) || 0) + (Number(invoice.igst) || 0);
    if (Math.abs(expected - invoice.grandTotal) > tolerance) issues.push(`Subtotal − invoice discount + taxes = ${expected.toFixed(2)}, but grand total is ${Number(invoice.grandTotal).toFixed(2)}. Check rounding, charges and missing taxes.`);
  }
  if (Number(invoice.igst) && (Number(invoice.cgst) || Number(invoice.sgst))) issues.push('Both IGST and CGST/SGST are present. Verify the tax treatment.');
  if (['cgst', 'sgst', 'igst', 'discount'].some((key) => invoice[key] == null)) issues.push('Blank tax/discount values are unknown; calculation checks treat them as zero. Verify against the original.');
  return issues;
}

export function invoiceCsv(invoice) {
  // Prevent spreadsheet formula injection from OCR or edited supplier/item text.
  const safe = (value) => typeof value === 'string' && /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  const fields = Object.keys(INVOICE_FIELDS);
  const rows = [[...fields, ...ITEM_FIELDS.map((key) => `item_${key}`)], ...(invoice.items.length ? invoice.items : [{}]).map((item) => [...fields.map((key) => invoice[key]), ...ITEM_FIELDS.map((key) => item[key])].map(safe))];
  return formatCsv(rows);
}
