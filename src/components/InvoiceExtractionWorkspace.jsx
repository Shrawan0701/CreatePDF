import { useEffect, useRef, useState } from 'react'
import { Download, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { FormGroup, downloadBlob } from './ui'
import { callAi } from '../services/aiClient'
import { INVOICE_CURRENCIES } from '../services/invoiceLocale'
import { analyzeInvoice, extractInvoiceLocally, invoiceAmount, invoiceNumber, mergeInvoiceExtraction, normalizeInvoice } from '../services/invoiceExtraction'
import { createInvoiceExtractionPdf } from '../services/invoiceExtractionPdf'
import './InvoiceExtractionWorkspace.css'

const known = value => value != null && value !== ''
function Field({ label, value, onChange, number, hint, ...props }) {
  return <FormGroup label={label} hint={hint}><input className="form-input" type={number ? 'number' : 'text'} step={number ? 'any' : undefined} value={value ?? ''} onChange={event => onChange(number ? invoiceNumber(event.target.value) : event.target.value)} {...props} /></FormGroup>
}

export default function InvoiceExtractionWorkspace({ doc, SourceInput }) {
  const [invoice, setInvoice] = useState(null), [raw, setRaw] = useState(''), [ai, setAi] = useState(false)
  const [exporting, setExporting] = useState(false), [exportError, setExportError] = useState(''), [sourceUrl, setSourceUrl] = useState('')
  const exportLock = useRef(false)
  useEffect(() => {
    if (!doc.file) { setSourceUrl(''); return }
    const url = URL.createObjectURL(doc.file); setSourceUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [doc.file])
  const busy = doc.busy || exporting
  const clear = () => { setInvoice(null); setRaw(''); setExportError('') }
  const extract = () => doc.run(async (pages, signal) => {
    clear()
    const text = pages.map(page => page.text).join('\n\n'), local = extractInvoiceLocally(text)
    setRaw(text); setInvoice(local)
    if (ai) {
      if (text.length > 24000) throw new Error('Local extraction is ready. For AI extraction, use a bill with up to 24,000 text characters.')
      doc.setStatus('Reading item prices, discounts and tax with AI…')
      const response = await callAi('invoice', { text }, signal)
      signal.throwIfAborted()
      setInvoice(mergeInvoiceExtraction(local, response.invoice, text))
    }
  }, {}, 'Analyzing bill details')
  const update = (key, value) => setInvoice(current => ({ ...current, [key]: value, evidence: { ...current.evidence, [key]: 'edited' } }))
  const updateItem = (index, patch) => setInvoice(current => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) }))
  const field = (key, label, props = {}) => <Field label={label} value={invoice[key]} disabled={busy} onChange={value => update(key, value)} {...props} />
  const analysis = invoice ? analyzeInvoice(invoice) : null
  const taxParts = ['cgst', 'sgst', 'igst'], hasTaxParts = invoice && taxParts.some(key => known(invoice[key]))
  const taxTotal = invoice?.tax ?? (hasTaxParts ? taxParts.reduce((sum, key) => sum + (Number(invoice[key]) || 0), 0) : null)
  const exportPdf = async () => {
    if (exportLock.current || busy || !invoice) return
    exportLock.current = true; setExporting(true); setExportError('')
    try {
      const snapshot = normalizeInvoice(invoice)
      const blob = await createInvoiceExtractionPdf(snapshot, { sourceName: doc.file?.name, pageCount: doc.pages.length })
      const name = (doc.file?.name.replace(/\.[^.]+$/, '') || 'bill').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 120)
      downloadBlob(blob, `${name}-extracted.pdf`)
    } catch (error) { setExportError(error.message || 'The PDF report could not be created.') }
    finally { exportLock.current = false; setExporting(false) }
  }

  return <div className="invoice-extraction">
    <div className="tool-panel document-workspace">
      <SourceInput doc={{ ...doc, busy }} images onSelect={clear} />
      <div className="iex-extract-actions"><button className="btn btn-primary document-cta" disabled={!doc.file || busy} onClick={extract}>{doc.busy ? 'Analyzing…' : 'Extract bill details'}</button><label className="document-check"><input type="checkbox" checked={ai} disabled={busy} onChange={event => setAi(event.target.checked)} /> Use AI for complex layouts</label></div>
      {ai && <p className="document-notice">Extracted text is sent to AI when you run extraction.</p>}
    </div>
    {invoice && <div className="tool-panel iex-review">
      <div className="iex-review-heading"><div><h2>Review extracted details</h2><p>Correct any field, then export the reviewed PDF report.</p></div><div className="iex-actions">{sourceUrl && <a className="btn btn-secondary" href={sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15} /> Open original</a>}<button className="btn btn-primary" disabled={busy} onClick={exportPdf}><Download size={16} />{exporting ? 'Creating PDF…' : 'Export PDF'}</button></div></div>
      {exportError && <p className="document-error" role="alert">{exportError}</p>}
      <div className={`iex-analysis ${analysis.issues.length ? 'needs-review' : ''}`} role="status"><strong>{analysis.status}</strong>{analysis.issues.length ? <ul>{analysis.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>{analysis.checks.at(-1) || 'Add missing values to check the amounts.'}</p>}
        {(analysis.notes.length > 0 || analysis.checks.length > 1) && <details><summary>Amount checks & reading notes</summary>{analysis.checks.length > 0 && <ul>{analysis.checks.map(check => <li key={check}>{check}</li>)}</ul>}{analysis.notes.length > 0 && <ul>{analysis.notes.map(note => <li key={note}>{note}</li>)}</ul>}</details>}
      </div>
      <fieldset className="document-fieldset" disabled={busy}>
        <div className="iex-main-fields">
          {field('supplierName', 'Supplier name', { maxLength: 500 })}
          {field('invoiceNumber', 'Invoice / receipt number', { maxLength: 200 })}
          {field('invoiceDate', 'Invoice date', { maxLength: 100 })}
          <FormGroup label="Currency"><select className="form-select" value={invoice.currency} onChange={event => update('currency', event.target.value)}><option value="">Not identified</option>{invoice.currency && !INVOICE_CURRENCIES.includes(invoice.currency) && <option value={invoice.currency}>{invoice.currency} (review)</option>}{INVOICE_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></FormGroup>
        </div>
        <details className="iex-details"><summary>Supplier address & tax ID <span>Optional</span></summary><div className="iex-two-fields">{field('supplierAddress', 'Supplier address', { maxLength: 4000 })}{field('gstin', 'Supplier tax ID', { maxLength: 150, placeholder: 'GSTIN, VAT ID, ABN or other tax ID' })}</div></details>
        <div className="iex-items-heading"><h3>Items</h3><span>Unit prices and printed line amounts</span></div>
        <div className="iex-table-scroll"><table className="iex-table"><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th>Line amount</th><th><span className="iex-sr-only">Remove item</span></th></tr></thead><tbody>{invoice.items.map((item, index) => <tr key={index}>
          <td><input className="form-input" aria-label={`Item ${index + 1} description`} value={item.description} maxLength={2000} onChange={event => updateItem(index, { description: event.target.value })} /><details className="iex-item-options"><summary>Line discount, tax & amount basis</summary>
            <div className="iex-two-fields"><Field label="Line discount" number value={item.discount} onChange={discount => updateItem(index, { discount })} placeholder="Not specified" /><FormGroup label="Discount type"><select className="form-select" value={item.discountType} onChange={event => updateItem(index, { discountType: event.target.value })}><option value="amount">Amount</option><option value="percent">Percent</option></select></FormGroup><Field label="Line tax rate %" number value={item.taxRate} onChange={taxRate => updateItem(index, { taxRate })} placeholder="Not specified" /><Field label="Line tax amount" number value={item.taxAmount} onChange={taxAmount => updateItem(index, { taxAmount })} placeholder="Not specified" /></div>
            <FormGroup label="Printed line amount"><select className="form-select" value={item.amountBasis} onChange={event => updateItem(index, { amountBasis: event.target.value })}><option value="unknown">Auto / not specified</option><option value="gross">Before line discount</option><option value="net">After line discount, before tax</option><option value="total">Including line tax</option></select></FormGroup>
          </details></td>
          {['quantity', 'price', 'amount'].map(key => <td key={key}><input className="form-input" aria-label={`Item ${index + 1} ${key === 'price' ? 'unit price' : key === 'amount' ? 'line amount' : key}`} type="number" step="any" value={item[key] ?? ''} placeholder="Not found" onChange={event => updateItem(index, { [key]: invoiceNumber(event.target.value) })} /></td>)}
          <td><button type="button" className="icon-btn" title={`Remove item ${index + 1}`} aria-label={`Remove item ${index + 1}`} onClick={() => setInvoice(current => ({ ...current, items: current.items.filter((_, i) => i !== index) }))}><Trash2 size={16} /></button></td>
        </tr>)}</tbody></table></div>
        {!invoice.items.length && <p className="iex-empty">No items identified. Add them here or try AI extraction.</p>}
        <button className="btn btn-secondary btn-sm" disabled={invoice.items.length >= 500} onClick={() => setInvoice(current => ({ ...current, items: [...current.items, normalizeInvoice({ items: [{}] }).items[0]] }))}><Plus size={15} /> Add line item</button>
        <div className="iex-totals"><h3>Bill totals <span>{invoice.currency}</span></h3><div className="iex-totals-fields">
          {field('subtotal', 'Subtotal', { number: true, placeholder: 'Not found' })}
          {field('discount', 'Invoice discount', { number: true, placeholder: 'Not specified', hint: invoice.evidence.discount === 'calculated' ? `Calculated from the printed ${invoice.discountPercent}% rate` : undefined })}
          <Field label="Total tax" number value={taxTotal} onChange={value => update('tax', value)} placeholder="Not specified" hint={hasTaxParts && invoice.tax == null ? 'From the tax breakdown below' : undefined} />
          {field('grandTotal', 'Grand total', { number: true, placeholder: 'Not found' })}
        </div><p className="iex-total-display">Grand total <strong>{invoiceAmount(invoice.grandTotal, invoice)}</strong></p></div>
        <details className="iex-details"><summary>Tax, discount & other adjustments</summary><div className="iex-main-fields">
          {field('taxLabel', 'Tax label', { maxLength: 40, placeholder: 'GST, VAT, sales tax…' })}
          <FormGroup label="Tax treatment"><select className="form-select" value={invoice.taxTreatment} onChange={event => update('taxTreatment', event.target.value)}><option value="unknown">Auto / not specified</option><option value="exclusive">Tax added to subtotal</option><option value="inclusive">Tax already included</option></select></FormGroup>
          {field('charges', 'Other charges', { number: true, placeholder: 'Not specified' })}{field('rounding', 'Rounding adjustment', { number: true, placeholder: 'Not specified' })}
          <FormGroup label="Discount in subtotal"><select className="form-select" value={invoice.discountIncludedInSubtotal == null ? 'unknown' : invoice.discountIncludedInSubtotal ? 'included' : 'not-included'} onChange={event => update('discountIncludedInSubtotal', event.target.value === 'unknown' ? null : event.target.value === 'included')}><option value="unknown">Auto / not specified</option><option value="not-included">Subtract invoice discount</option><option value="included">Discount already subtracted</option></select></FormGroup>
          <FormGroup label="Summary discount covers"><select className="form-select" value={invoice.discountScope} onChange={event => update('discountScope', event.target.value)}><option value="unknown">Auto / not specified</option><option value="invoice">Invoice discount only</option><option value="all">Line and invoice discounts</option></select></FormGroup>
        </div><details className="iex-details"><summary>CGST / SGST / IGST breakdown <span>{hasTaxParts ? 'Detected' : 'Optional'}</span></summary><div className="iex-main-fields">{taxParts.map(key => <div key={key}>{field(key, key.toUpperCase(), { number: true, placeholder: 'Not specified' })}</div>)}</div></details></details>
      </fieldset>
      <details className="document-raw iex-details"><summary>Extracted source text</summary><pre>{raw}</pre></details>
    </div>}
  </div>
}
