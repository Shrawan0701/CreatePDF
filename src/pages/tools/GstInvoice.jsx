import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Eye, FilePlus2, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { FormGroup, downloadBlob } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { deleteInvoice, getInvoices, getProfiles, saveInvoice, saveProfile } from '../../services/storage';
import { GST_STATES, additionalTaxTotals, gstInvoiceErrors, gstLine, gstTotals, invoiceTaxName, isDomesticIndia, isIndianInvoice, money, newGstInvoice, newInvoiceItem, nextInvoiceNumber, normalizeGstInvoice, stateForGstin, supplyState, taxLabel } from '../../services/gstInvoice';
import { INVOICE_COUNTRIES, INVOICE_CURRENCIES, countryCurrency, countryTax } from '../../services/invoiceLocale';
import { importSignatureImage } from '../../services/pdfSigning';
import { createGstInvoicePdf } from '../../services/gstInvoicePdf';
import { exportEditableInvoicePdf, importEditableInvoicePdf } from '../../services/invoicePdfData';
import { WatermarkPdfPreview } from '../../components/WatermarkPdfPreview';
import '../../components/WatermarkWorkspace.css';
import './GstInvoice.css';

function Field({ label, value, onChange, multiline, ...props }) {
  return <FormGroup label={label}>{multiline ? <textarea className="form-textarea" rows={2} value={value ?? ''} onChange={event => onChange(event.target.value)} {...props} /> : <input className="form-input" value={value ?? ''} onChange={event => onChange(event.target.value)} {...props} />}</FormGroup>;
}
function StateField({ label, value, onChange }) {
  return <FormGroup label={label}><select className="form-select" value={value} onChange={event => onChange(event.target.value)}><option value="">Choose state / UT</option>{GST_STATES.map(state => <option key={state.code} value={state.name}>{state.name} ({state.code})</option>)}</select></FormGroup>;
}
function CountryField({ label, value, onChange }) {
  return <FormGroup label={label}><select className="form-select" value={value} onChange={event => onChange(event.target.value)}><option value="">Choose country</option>{INVOICE_COUNTRIES.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></FormGroup>;
}
function ItemInput({ label, ...props }) {
  return <label className="gst-item-field"><span>{label}</span><input className="form-input" {...props} /></label>;
}
const filename = invoice => `invoice-${invoice.invoiceNumber.replace(/[^a-z0-9-]/gi, '-')}.pdf`;

function PdfReview({ blob, onClose, onDownload }) {
  const [page, setPage] = useState(1), [count, setCount] = useState(1), [url, setUrl] = useState('');
  const dialog = useRef(null);
  useEffect(() => {
    const location = URL.createObjectURL(blob); setUrl(location);
    const previous = document.activeElement; dialog.current?.showModal();
    return () => { URL.revokeObjectURL(location); previous?.focus(); };
  }, [blob]);
  useEffect(() => {
    let cancelled = false;
    import('pdf-lib').then(async ({ PDFDocument }) => {
      const document = await PDFDocument.load(await blob.arrayBuffer());
      if (!cancelled) setCount(document.getPageCount());
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [blob]);
  return <dialog ref={dialog} className="gst-pdf-dialog" aria-label="Invoice PDF preview" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="gst-preview-heading"><strong>Invoice PDF</strong><div><button className="btn btn-primary btn-sm" onClick={onDownload}><Download size={14} /> Download</button>{url && <a className="btn btn-secondary btn-sm" href={url} target="_blank" rel="noreferrer">Open PDF to print</a>}<button className="icon-btn" onClick={onClose} aria-label="Close invoice preview"><X size={18} /></button></div></div>
    <WatermarkPdfPreview blob={blob} page={page} pageCount={count} onPage={setPage} label="Invoice PDF" />
  </dialog>;
}

export default function GstInvoice() {
  const [invoice, setInvoice] = useState(() => newGstInvoice());
  const initial = useRef(invoice), editor = useRef(null), errorsRef = useRef(null), operation = useRef(false), mounted = useRef(true);
  const [drafts, setDrafts] = useState([]), [profiles, setProfiles] = useState([]);
  const [busy, setBusy] = useState(''), [submitted, setSubmitted] = useState(false), [failure, setFailure] = useState('');
  const [preview, setPreview] = useState(null), [cache, setCache] = useState(null);
  const { showToast } = useApp();
  const totals = gstTotals(invoice), errors = submitted ? gstInvoiceErrors(invoice, drafts) : [];
  const india = isIndianInvoice(invoice), intra = isDomesticIndia(invoice) && invoice.seller.state === supplyState(invoice), billOfSupply = invoice.invoiceType !== 'tax';
  const taxName = invoiceTaxName(invoice);
  const fmt = amount => money(amount, invoice.currency, invoice.seller.country);
  useEffect(() => {
    mounted.current = true;
    Promise.all([getInvoices(), getProfiles()]).then(([saved, businesses]) => {
      if (!mounted.current) return;
      setDrafts(saved); setProfiles(businesses);
      setInvoice(current => current === initial.current ? { ...current, invoiceNumber: nextInvoiceNumber(saved) } : current);
    }).catch(() => { if (mounted.current) showToast('Saved profiles and drafts could not be loaded. You can still create an invoice.', 'error'); });
    return () => { mounted.current = false; };
  }, []);
  const update = (key, value) => {
    setFailure('');
    setInvoice(current => {
      const [group, field] = key.split('.');
      if (!field) return { ...current, [key]: value };
      const party = { ...current[group], [field]: value };
      if (field === 'gstin') { party.gstin = value.toUpperCase().replace(/\s/g, ''); const state = stateForGstin(party.gstin); if (state && party.country === 'IN') party.state = state; }
      if (field === 'taxId' && !party.country && /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z0-9]$/i.test(value.replace(/\s/g, ''))) {
        party.country = 'IN'; party.gstin = value.replace(/\s/g, '').toUpperCase(); party.taxId = ''; party.state = stateForGstin(party.gstin) || '';
        if (group === 'seller') {
          const pristine = !current.items.some(item => item.rate !== '' && Number(item.rate));
          return { ...current, seller: party, buyer: { ...current.buyer, country: current.buyer.country || 'IN' },
            ...(pristine ? { currency: 'INR', items: current.items.map(item => ({ ...item, gstRate: 18 })) } : {}) };
        }
      }
      return { ...current, [group]: party };
    });
  };
  const chooseCountry = (group, country) => {
    setFailure('');
    const hasAmounts = invoice.items.some(item => item.rate !== '' && Number(item.rate) !== 0);
    setInvoice(current => {
      const next = { ...current, [group]: { ...current[group], country, state: '' } };
      if (group === 'seller') {
        next.taxName = '';
        if (country !== 'IN' && current.invoiceType === 'bill-of-supply') next.invoiceType = 'standard';
        if (!hasAmounts) {
          next.currency = countryCurrency(country);
          next.items = current.items.map(item => ({ ...item, gstRate: country === 'IN' ? 18 : 0 }));
        }
        if (!current.buyer.country) next.buyer = { ...current.buyer, country };
        if (current.invoiceNumber === nextInvoiceNumber(drafts, current.invoiceDate, current.seller.country)) next.invoiceNumber = nextInvoiceNumber(drafts, current.invoiceDate, country);
      }
      next.placeOfSupply = '';
      const detected = country === 'IN' && stateForGstin(next[group].gstin);
      if (detected) next[group].state = detected;
      return next;
    });
    if (group === 'seller' && hasAmounts) showToast('Country updated. Currency and entered tax rates were kept; review them for this invoice.', 'info');
  };
  const itemUpdate = (id, field, value) => { setFailure(''); setInvoice(current => ({ ...current, items: current.items.map(item => item.id === id ? { ...item, [field]: value } : item) })); };
  const moveItem = (index, direction) => setInvoice(current => {
    const items = [...current.items], target = index + direction;
    if (target < 0 || target >= items.length) return current;
    [items[index], items[target]] = [items[target], items[index]];
    return { ...current, items };
  });
  const refreshDrafts = async () => { const saved = await getInvoices(); if (mounted.current) setDrafts(saved); return saved; };
  const action = async (label, work) => {
    if (operation.current) return;
    operation.current = true; setBusy(label); setFailure('');
    try { await work(); } catch (error) { if (mounted.current) { setFailure(error.message || 'The invoice action could not finish.'); showToast(error.message || 'The invoice action could not finish.', 'error'); } }
    finally { operation.current = false; if (mounted.current) setBusy(''); }
  };
  const saveDraft = () => action('Saving draft', async () => {
    await saveInvoice({ ...invoice, savedAt: Date.now() }); await refreshDrafts();
    if (mounted.current) showToast('Draft saved on this device.', 'success');
  });
  const saveBusiness = () => action('Saving business', async () => {
    if (!(invoice.seller.legalName || invoice.seller.tradeName).trim()) throw new Error('Enter a business name before saving its profile.');
    await saveProfile({ ...invoice.seller, schemaVersion: 2, id: `${invoice.seller.country}:${(india ? invoice.seller.gstin : invoice.seller.taxId) || (invoice.seller.legalName || invoice.seller.tradeName).trim()}`, name: invoice.seller.legalName || invoice.seller.tradeName });
    const saved = await getProfiles();
    if (mounted.current) { setProfiles(saved); showToast('Business details saved for reuse.', 'success'); }
  });
  const generate = kind => action('Creating PDF', async () => {
    setSubmitted(true);
    let saved = drafts;
    try { saved = await getInvoices(); if (mounted.current) setDrafts(saved); } catch { /* PDF creation remains available without local storage. */ }
    const issues = gstInvoiceErrors(invoice, saved);
    if (issues.length) { setPreview(null); requestAnimationFrame(() => { errorsRef.current?.focus(); errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); return; }
    const blob = cache?.invoice === invoice ? cache.blob : await createGstInvoicePdf(invoice);
    if (!mounted.current) return;
    setCache({ invoice, blob });
    if (kind === 'preview') { setPreview(blob); return; }
    const output = kind === 'export' ? await exportEditableInvoicePdf(blob, invoice) : blob;
    if (!mounted.current) return;
    downloadBlob(output, kind === 'export' ? `editable-${filename(invoice)}` : filename(invoice));
    try { await saveInvoice({ ...invoice, savedAt: Date.now() }); await refreshDrafts(); }
    catch { if (mounted.current) showToast('PDF downloaded. The draft could not be saved on this device.', 'error'); }
  });
  const load = data => { setInvoice(normalizeGstInvoice(data)); setSubmitted(false); setFailure(''); setCache(null); };
  const importData = file => action('Importing invoice', async () => {
    const restored = await importEditableInvoicePdf(file);
    if (!mounted.current) return;
    const existing = drafts.find(draft => draft.id === restored.id && draft.invoiceNumber === restored.invoiceNumber);
    load({ ...restored, id: existing?.id || crypto.randomUUID(), createdAt: existing?.createdAt || Date.now() });
    if (mounted.current) showToast('Invoice imported.', 'success');
  });
  const useProfile = id => {
    const profile = profiles.find(item => item.id === id);
    if (!profile) return;
    try {
      const country = profile.country || (!profile.schemaVersion ? 'IN' : '');
      const next = normalizeGstInvoice({ ...invoice, seller: { ...invoice.seller, ...profile, country }, taxName: '', placeOfSupply: '' });
      if (!invoice.items.some(item => item.rate !== '' && Number(item.rate))) next.currency = countryCurrency(country);
      if (country !== 'IN' && next.invoiceType === 'bill-of-supply') next.invoiceType = 'standard';
      if (!next.buyer.country) next.buyer.country = country;
      setInvoice(next); setFailure('');
    }
    catch (error) { showToast(error.message, 'error'); }
  };
  const seller = (field, label, props = {}) => <Field label={label} value={invoice.seller[field]} onChange={value => update(`seller.${field}`, value)} {...props} />;
  const buyer = (field, label, props = {}) => <Field label={label} value={invoice.buyer[field]} onChange={value => update(`buyer.${field}`, value)} {...props} />;
  const uploadSignature = file => action('Loading signature', async () => {
    if (file.size > 3 * 1024 * 1024) throw new Error('Choose a signature image up to 3 MB.');
    const image = await importSignatureImage(file, false);
    // Normalize to a compact PNG before persisting it in JSON or local drafts.
    const decoded = new Image(); decoded.src = image.dataUrl; await decoded.decode();
    const canvas = document.createElement('canvas'), scale = Math.min(1, 1200 / decoded.naturalWidth, 500 / decoded.naturalHeight);
    try {
      canvas.width = Math.max(1, Math.round(decoded.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(decoded.naturalHeight * scale));
      canvas.getContext('2d').drawImage(decoded, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      if (dataUrl.length > 3_000_000) throw new Error('The signature image is too large. Upload a smaller image.');
      if (mounted.current) update('signature.image', dataUrl);
    } finally { canvas.width = canvas.height = 0; }
  });
  const closePreview = useRef(() => setPreview(null)).current;
  return <ToolPage toolId="gst-invoice"><div className="gst-workspace">
    <form noValidate ref={editor} onSubmit={event => { event.preventDefault(); generate('download'); }}>
      <fieldset disabled={Boolean(busy)} className="gst-editor-fieldset">
        <div className="gst-topline"><div className="gst-meta-fields">
          <Field label="Invoice number" value={invoice.invoiceNumber} maxLength={india && invoice.invoiceType !== 'standard' ? 16 : 40} onChange={value => update('invoiceNumber', value)} />
          <Field label="Date" type="date" value={invoice.invoiceDate} onChange={value => update('invoiceDate', value)} />
          <FormGroup label="Document"><select className="form-select" value={invoice.invoiceType} onChange={event => update('invoiceType', event.target.value)}><option value="standard">Invoice · no tax</option><option value="tax">{india ? 'Tax invoice · GST' : `Invoice with ${taxName}`}</option>{india && <option value="bill-of-supply">Bill of supply</option>}</select></FormGroup>
          <FormGroup label="Currency"><select className="form-select" value={invoice.currency} onChange={event => update('currency', event.target.value)}>{INVOICE_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></FormGroup>
        </div><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setInvoice(newGstInvoice(drafts, invoice.seller)); setSubmitted(false); setFailure(''); setCache(null); }}><FilePlus2 size={15} /> New invoice</button></div>
        <div className="gst-layout"><div className="gst-main">
          <div className="gst-parties">
            <section className="gst-card"><div className="gst-card-heading"><h2>Your business</h2>{profiles.length > 0 && <select className="form-select gst-profile-select" aria-label="Use saved business profile" value="" onChange={event => useProfile(event.target.value)}><option value="">Use saved business</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>}</div>
              {seller('legalName', 'Business name', { autoComplete: 'organization' })}
              <CountryField label="Business country" value={invoice.seller.country} onChange={value => chooseCountry('seller', value)} />
              {seller('address', 'Business address', { multiline: true, placeholder: 'Street, city / region and postal code', autoComplete: 'street-address' })}
              {seller(india ? 'gstin' : 'taxId', countryTax(invoice.seller.country).idLabel, { maxLength: india ? 15 : 64, autoComplete: 'off', spellCheck: false, placeholder: india && invoice.invoiceType !== 'standard' ? '15-character GSTIN' : 'If registered' })}
              {india && invoice.seller.state && <div className="gst-detected-region">State from GSTIN: {invoice.seller.state}</div>}
              <details className="gst-details"><summary>Contact & payment details</summary><div className="gst-fields">{seller('phone', 'Phone', { type: 'tel' })}{seller('email', 'Email', { type: 'email' })}{seller('tradeName', 'Trade name')}{seller('website', 'Website')}{seller('city', 'City')}{!india && seller('state', 'State / province / region')}{seller('pin', india ? 'PIN code' : 'Postal / ZIP code', { maxLength: 20 })}{seller('bankName', 'Bank')}{seller('accountNumber', india ? 'Account number' : 'Account number / IBAN')}{india ? <>{seller('ifsc', 'IFSC')}{seller('upiId', 'UPI ID')}</> : seller('bankCode', 'Routing / SWIFT / bank code')}</div></details>
              <button type="button" className="btn btn-secondary btn-sm gst-save-business" onClick={saveBusiness}><Save size={13} /> Save business</button>
            </section>
            <section className="gst-card"><div className="gst-card-heading"><h2>Bill to</h2><span>Tax ID only if registered</span></div>
              {buyer('name', 'Customer name', { autoComplete: 'name', placeholder: 'Customer or business name' })}
              <CountryField label="Customer country" value={invoice.buyer.country} onChange={value => chooseCountry('buyer', value)} />
              {buyer('billingAddress', 'Billing address', { multiline: true, placeholder: 'Street, city / region and postal code' })}
              {buyer(invoice.buyer.country === 'IN' ? 'gstin' : 'taxId', `Customer ${countryTax(invoice.buyer.country).idLabel}`, { maxLength: invoice.buyer.country === 'IN' ? 15 : 64, autoComplete: 'off', spellCheck: false, placeholder: 'Optional' })}
              {isDomesticIndia(invoice) && !billOfSupply && <StateField label="Place of supply (GST state)" value={supplyState(invoice)} onChange={value => update('placeOfSupply', value)} />}
              <details className="gst-details"><summary>Contact & delivery details</summary><div className="gst-fields">{buyer('phone', 'Phone', { type: 'tel' })}{buyer('email', 'Email', { type: 'email' })}{invoice.buyer.country === 'IN' ? <StateField label="Billing state" value={invoice.buyer.state} onChange={value => update('buyer.state', value)} /> : buyer('state', 'State / province / region')}{buyer('pin', invoice.buyer.country === 'IN' ? 'PIN code' : 'Postal / ZIP code', { maxLength: 20 })}{invoice.buyer.businessName && invoice.buyer.businessName !== invoice.buyer.name && buyer('businessName', 'Company name')}</div>{buyer('shippingAddress', 'Delivery address (if different)', { multiline: true })}</details>
            </section>
          </div>
          <section className="gst-card gst-items"><div className="gst-card-heading"><h2>Items & services</h2><span>Prices before tax</span></div>
            <datalist id="invoice-gst-rates">{[0, .1, .25, 1.5, 3, 5, 6, 12, 18, 28, 40].map(rate => <option key={rate} value={rate} />)}</datalist>
            <div className={`gst-item-labels${billOfSupply ? ' gst-no-tax' : ''}`}><span>Item / service</span><span>{india ? 'HSN/SAC' : 'Item code'}</span><span>Qty</span><span>Rate ({invoice.currency})</span>{!billOfSupply && <span>{taxName} %</span>}<span>Amount</span><span /></div>
            {invoice.items.map((item, index) => <div className={`gst-item${billOfSupply ? ' gst-no-tax' : ''}`} key={item.id}>
              <div className="gst-item-line">
                <ItemInput label="Item / service" aria-label={`Item ${index + 1} name`} value={item.name} placeholder="Item or service" onChange={event => itemUpdate(item.id, 'name', event.target.value)} />
                <ItemInput label={india ? 'HSN/SAC' : 'Item code'} aria-label={`Item ${index + 1} ${india ? 'HSN or SAC' : 'code'}`} inputMode={india ? 'numeric' : 'text'} maxLength={india ? 8 : 30} value={item.hsn} placeholder="Code" onChange={event => itemUpdate(item.id, 'hsn', event.target.value)} />
                <ItemInput label="Qty" aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="any" value={item.qty} onChange={event => itemUpdate(item.id, 'qty', event.target.value)} />
                <ItemInput label={`Rate (${invoice.currency})`} aria-label={`Item ${index + 1} unit price in ${invoice.currency}`} type="number" min="0" step="any" value={item.rate} placeholder="0" onChange={event => itemUpdate(item.id, 'rate', event.target.value)} />
                {!billOfSupply && <ItemInput label={`${taxName} %`} aria-label={`Item ${index + 1} ${taxName} percentage`} type="number" list={india ? 'invoice-gst-rates' : undefined} min="0" max="100" step="any" value={item.gstRate} onChange={event => itemUpdate(item.id, 'gstRate', event.target.value)} />}
                <output className="gst-item-amount" aria-label={`Item ${index + 1} amount`}>{fmt(gstLine(item, invoice).total)}</output>
                <button type="button" className="icon-btn" disabled={invoice.items.length === 1} aria-label={`Remove item ${index + 1}`} onClick={() => setInvoice(current => ({ ...current, items: current.items.filter(row => row.id !== item.id) }))}><Trash2 size={15} /></button>
              </div>
              <details className="gst-item-options"><summary>Item details{Number(item.discount) ? ` · ${item.discount}% discount` : ''}{india && Number(item.cessRate) && !billOfSupply ? ` · ${item.cessRate}% cess` : ''}</summary><div className="gst-fields gst-item-extra"><Field label="Description" multiline value={item.description} onChange={value => itemUpdate(item.id, 'description', value)} /><div className="gst-fields"><Field label="Unit" value={item.unit} onChange={value => itemUpdate(item.id, 'unit', value)} /><Field label="Discount %" type="number" min="0" max="100" step="any" value={item.discount} onChange={value => itemUpdate(item.id, 'discount', value)} />{india && !billOfSupply && <Field label="Cess %" type="number" min="0" max="100" step="any" value={item.cessRate} onChange={value => itemUpdate(item.id, 'cessRate', value)} />}</div></div><div className="gst-item-move"><button type="button" className="btn btn-secondary btn-sm" disabled={!index} onClick={() => moveItem(index, -1)} aria-label={`Move item ${index + 1} up`}><ArrowUp size={13} /> Move up</button><button type="button" className="btn btn-secondary btn-sm" disabled={index === invoice.items.length - 1} onClick={() => moveItem(index, 1)} aria-label={`Move item ${index + 1} down`}><ArrowDown size={13} /> Move down</button></div></details>
            </div>)}
            <button type="button" className="btn btn-secondary btn-sm gst-add-item" disabled={invoice.items.length >= 500} onClick={() => setInvoice(current => ({ ...current, items: [...current.items, newInvoiceItem(current.seller.country)] }))}><Plus size={15} /> Add item</button>
          </section>
          <details className="gst-card gst-details gst-signature"><summary>Signature <span>{invoice.signature.mode === 'type' && invoice.signature.text.trim() ? 'Typed signature added' : invoice.signature.mode === 'image' && invoice.signature.image ? 'Image signature added' : 'Optional · type or upload'}</span></summary>
            <div className="gst-signature-modes" role="group" aria-label="Invoice signature type">{[['none', 'None'], ['type', 'Type name'], ['image', 'Upload image']].map(([mode, label]) => <button type="button" key={mode} className="btn btn-secondary btn-sm" aria-pressed={invoice.signature.mode === mode} onClick={() => update('signature.mode', mode)}>{label}</button>)}</div>
            {invoice.signature.mode === 'type' && <><Field label="Signature name" value={invoice.signature.text} maxLength={100} onChange={value => update('signature.text', value)} placeholder="Type your name" /><div className="gst-signature-size"><label>Signature size<input type="range" min="20" max="200" step="5" value={Number(invoice.signature.size) || 100} onChange={event => update('signature.size', Number(event.target.value))} /></label><Field label="Size (%)" type="number" min="20" max="200" step="1" value={invoice.signature.size ?? 100} onChange={value => update('signature.size', value)} /></div><div className="gst-typed-signature" style={{ fontSize: `${32 * Math.max(20, Math.min(200, Number(invoice.signature.size) || 100)) / 100}px` }} aria-label="Typed signature preview">{invoice.signature.text}</div></>}
            {invoice.signature.mode === 'image' && <><label className="btn btn-secondary btn-sm"><Upload size={14} /> Choose signature<input type="file" hidden accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) uploadSignature(file); }} /></label>{invoice.signature.image && <div className="gst-signature-image"><img src={invoice.signature.image} alt="Signature to include on invoice" /><button type="button" className="icon-btn" aria-label="Remove invoice signature" onClick={() => { update('signature.image', ''); update('signature.mode', 'none'); }}><X size={16} /></button></div>}</>}
          </details>
          <details className="gst-card gst-details gst-more"><summary>More options <span>Due date, notes & tax settings</span></summary><div className="gst-fields">
            <Field label="Due date" type="date" min={invoice.invoiceDate} value={invoice.dueDate} onChange={value => update('dueDate', value)} />
            <Field label="Supply / service date" type="date" value={invoice.supplyDate} onChange={value => update('supplyDate', value)} />
            <Field label="Payment terms" value={invoice.paymentTerms} placeholder="Optional" onChange={value => update('paymentTerms', value)} />
            {!india && !billOfSupply && <Field label="Tax name" value={invoice.taxName} maxLength={24} placeholder={countryTax(invoice.seller.country).name} onChange={value => update('taxName', value)} />}
            {!billOfSupply && <label className="gst-check"><input type="checkbox" checked={invoice.reverseCharge} onChange={event => update('reverseCharge', event.target.checked)} /> Reverse charge: recipient pays tax</label>}
          </div>{!india && !billOfSupply && <div className="gst-additional-taxes"><strong>Additional taxes</strong>{invoice.additionalTaxes.map(tax => <div className="gst-additional-tax" key={tax.id}><Field label="Tax name" value={tax.name} maxLength={30} placeholder="e.g. PST" onChange={value => update('additionalTaxes', invoice.additionalTaxes.map(row => row.id === tax.id ? { ...row, name: value } : row))} /><Field label="Rate %" type="number" min="0" max="100" step="any" value={tax.rate} onChange={value => update('additionalTaxes', invoice.additionalTaxes.map(row => row.id === tax.id ? { ...row, rate: value } : row))} /><button type="button" className="icon-btn" aria-label={`Remove ${tax.name || 'additional tax'}`} onClick={() => update('additionalTaxes', invoice.additionalTaxes.filter(row => row.id !== tax.id))}><X size={14} /></button></div>)}<button type="button" className="btn btn-secondary btn-sm" disabled={invoice.additionalTaxes.length >= 5} onClick={() => update('additionalTaxes', [...invoice.additionalTaxes, { id: crypto.randomUUID(), name: '', rate: '' }])}><Plus size={13} /> Add tax</button><p>Each additional rate applies to the discounted item value. Enter the rates applicable to this sale.</p></div>}<Field label="Notes" multiline value={invoice.notes} onChange={value => update('notes', value)} /><Field label="Terms & conditions" multiline value={invoice.terms} onChange={value => update('terms', value)} /></details>
        </div><aside className="gst-summary gst-card"><h2>Invoice total</h2><div className="gst-summary-row"><span>Subtotal</span><span>{fmt(totals.gross)}</span></div>
          {totals.discount > 0 && <div className="gst-summary-row"><span>Discount</span><span>−{fmt(totals.discount)}</span></div>}
          {totals.discount > 0 && <div className="gst-summary-row"><span>{billOfSupply ? 'Net amount' : 'Taxable value'}</span><span>{fmt(totals.taxable)}</span></div>}
          {!billOfSupply && <>{!india ? <><div className="gst-summary-row"><span>{taxName}</span><span>{fmt(totals.localTax)}</span></div>{additionalTaxTotals(invoice).map(tax => <div key={tax.id} className="gst-summary-row"><span>{tax.name || 'Additional tax'}</span><span>{fmt(tax.amount)}</span></div>)}</> : intra ? <><div className="gst-summary-row"><span>CGST</span><span>{fmt(totals.cgst)}</span></div><div className="gst-summary-row"><span>{taxLabel(invoice)}</span><span>{fmt(totals.sgst)}</span></div></> : <div className="gst-summary-row"><span>IGST</span><span>{fmt(totals.igst)}</span></div>}{totals.cess > 0 && <div className="gst-summary-row"><span>Cess</span><span>{fmt(totals.cess)}</span></div>}</>}
          <div className="gst-grand-total"><span>Amount due</span><strong>{fmt(totals.total)}</strong></div>
          <p className="gst-tax-treatment">{billOfSupply ? 'Tax not charged' : invoice.reverseCharge ? `Reverse charge · ${fmt(totals.tax)} tax payable by recipient` : !india ? `${taxName} · rates entered per item` : !invoice.seller.state ? 'Enter GSTIN to determine the business state' : intra ? `Same-state supply · CGST + ${taxLabel(invoice)}` : 'Inter-state / overseas supply · IGST'}</p>
          <button type="submit" className="btn btn-primary"><Download size={16} /> {busy === 'Creating PDF' ? 'Creating PDF…' : 'Download invoice'}</button>
          <div className="gst-summary-actions"><button type="button" className="btn btn-secondary" onClick={() => generate('preview')}><Eye size={15} /> Preview</button><button type="button" className="btn btn-secondary" onClick={saveDraft}><Save size={15} /> Save draft</button></div>
        </aside></div>
      </fieldset>
      {(errors.length > 0 || failure) && <div ref={errorsRef} tabIndex={-1} className="gst-errors" role="alert">{failure && <p>{failure}</p>}{errors.length > 0 && <><strong>Check these details</strong><ul>{errors.slice(0, 8).map((error, index) => <li key={index}>{error}</li>)}</ul>{errors.length > 8 && <span>And {errors.length - 8} more item details.</span>}</>}</div>}
    </form>
    <details className="gst-card gst-details gst-history"><summary>Saved drafts & invoice data <span>{drafts.length} saved</span></summary>
      <div className="gst-data-actions"><button className="btn btn-secondary btn-sm" disabled={Boolean(busy)} onClick={() => generate('export')}><Download size={14} /> Export editable PDF</button><label className={`btn btn-secondary btn-sm${busy ? ' disabled' : ''}`}><Upload size={14} /> Import PDF<input type="file" hidden disabled={Boolean(busy)} accept=".pdf,application/pdf" onChange={event => { const file = event.target.files[0]; event.target.value = ''; if (file) importData(file); }} /></label></div><p className="gst-pdf-import-hint">Reopen PDFs saved with Export editable PDF to restore all invoice fields.</p>
      <div className="gst-draft-list">{drafts.map(draft => <div key={draft.id}><button className="gst-draft-open" disabled={Boolean(busy)} onClick={() => { try { load(draft); editor.current?.scrollIntoView({ behavior: 'smooth' }); } catch (error) { showToast(error.message, 'error'); } }}><strong>{draft.invoiceNumber}</strong><span>{draft.buyer?.name || draft.buyer?.businessName || 'Draft'} · {draft.invoiceDate}</span></button><button className="icon-btn" disabled={Boolean(busy)} aria-label={`Delete saved invoice ${draft.invoiceNumber}`} onClick={() => action('Deleting draft', async () => { await deleteInvoice(draft.id); await refreshDrafts(); })}><Trash2 size={15} /></button></div>)}</div>
    </details>
    {preview && <PdfReview blob={preview} onClose={closePreview} onDownload={() => generate('download')} />}
  </div></ToolPage>;
}
