import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Plus, Printer, Save, Upload, X, Eye } from 'lucide-react';
import { ToolPage } from '../../components/ToolPage';
import { Tabs, FormGroup, downloadBlob, generateId } from '../../components/ui';
import { useApp } from '../../context/AppContext';
import { deleteInvoice, getInvoices, getProfiles, saveInvoice, saveProfile } from '../../services/storage';
import { getPdfLib } from '../../services/pdfEngine';
import { drawUnicodeText, embedUnicodeFonts } from '../../services/unicodePdf';

const GST_RATES = [0, 5, 12, 18, 28];
const INDIAN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Chandigarh','Puducherry'];

function emptyInvoice() {
  return {
    id: generateId(),
    createdAt: Date.now(),
    invoiceType: 'tax',
    invoiceNumber: `INV-${Date.now().toString().slice(-6)}`,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    placeOfSupply: 'Maharashtra',
    reverseCharge: false,
    currency: 'INR',
    paymentTerms: 'Net 30',
    seller: {
      tradeName: '', legalName: '', gstin: '', pan: '', address: '',
      city: '', state: 'Maharashtra', pin: '', phone: '', email: '',
      website: '', bankName: '', accountNumber: '', ifsc: '', upiId: '', logo: null
    },
    buyer: {
      name: '', businessName: '', gstin: '', billingAddress: '', shippingAddress: '',
      state: '', pin: '', phone: '', email: ''
    },
    items: [
      { id: generateId(), name: '', description: '', hsn: '', qty: 1, unit: 'pcs', rate: 0, discount: 0, gstRate: 18 }
    ],
    notes: '', terms: 'Payment due within 30 days.'
  };
}

function calcItem(item, sellerState, placeOfSupply, invoiceType = 'tax') {
  const taxable = (item.qty * item.rate) * (1 - item.discount / 100);
  const gstAmt = invoiceType === 'bill-of-supply' ? 0 : taxable * (item.gstRate / 100);
  const intraState = sellerState === placeOfSupply;
  const cgst = intraState ? gstAmt / 2 : 0;
  const sgst = intraState ? gstAmt / 2 : 0;
  const igst = !intraState ? gstAmt : 0;
  return { taxable, cgst, sgst, igst, total: taxable + gstAmt };
}

export default function GstInvoice() {
  const [invoice, setInvoice] = useState(emptyInvoice());
  const [tab, setTab] = useState('seller');
  const [processing, setProcessing] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const { showToast } = useApp();

  const refreshSaved = async () => { setDrafts(await getInvoices()); setProfiles(await getProfiles()); };
  useEffect(() => { refreshSaved(); }, []);

  const update = (path, value) => {
    setInvoice((prev) => {
      const parts = path.split('.');
      const clone = { ...prev };
      let ref = clone;
      for (let i = 0; i < parts.length - 1; i++) {
        ref[parts[i]] = { ...ref[parts[i]] };
        ref = ref[parts[i]];
      }
      ref[parts[parts.length - 1]] = value;
      return clone;
    });
  };

  const addItem = () => setInvoice((prev) => ({
    ...prev,
    items: [...prev.items, { id: generateId(), name: '', description: '', hsn: '', qty: 1, unit: 'pcs', rate: 0, discount: 0, gstRate: 18 }]
  }));

  const removeItem = (id) => setInvoice((prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }));

  const updateItem = (id, field, value) => setInvoice((prev) => ({
    ...prev,
    items: prev.items.map((it) => it.id === id ? { ...it, [field]: value } : it)
  }));

  const totals = invoice.items.reduce((acc, item) => {
    const c = calcItem(item, invoice.seller.state, invoice.placeOfSupply, invoice.invoiceType);
    return {
      taxable: acc.taxable + c.taxable,
      cgst: acc.cgst + c.cgst,
      sgst: acc.sgst + c.sgst,
      igst: acc.igst + c.igst,
      total: acc.total + c.total,
    };
  }, { taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 });

  const handleSave = async () => {
    await saveInvoice({ ...invoice, savedAt: Date.now() });
    await refreshSaved();
    showToast('Invoice saved!', 'success');
  };
  const moveItem = (index, direction) => setInvoice((current) => { const target = index + direction; if (target < 0 || target >= current.items.length) return current; const items = [...current.items]; [items[index], items[target]] = [items[target], items[index]]; return { ...current, items }; });
  const saveBusinessProfile = async () => { const profile = { ...invoice.seller, id: invoice.seller.gstin || generateId(), name: invoice.seller.tradeName || invoice.seller.legalName || 'Business profile' }; await saveProfile(profile); await refreshSaved(); showToast('Business profile saved locally.', 'success'); };
  const exportData = () => downloadBlob(new Blob([JSON.stringify(invoice, null, 2)], { type: 'application/json' }), `invoice-${invoice.invoiceNumber}.json`);
  const importData = async (file) => { try { const data = JSON.parse(await file.text()); if (!data.items || !data.seller) throw new Error('Invalid invoice file.'); setInvoice({ ...emptyInvoice(), ...data, id: generateId() }); showToast('Invoice data imported.', 'success') } catch (error) { showToast(error.message, 'error') } };

  const handleDownload = async () => {
    setProcessing(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
      const pdfDoc = await PDFDocument.create();
      let page = pdfDoc.addPage([595, 842]);
      const { width, height } = page.getSize();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const unicodeFonts = { ...await embedUnicodeFonts(pdfDoc), baseBold: boldFont };
      const curr = invoice.currency || 'INR';
      const documentTitle = invoice.invoiceType === 'bill-of-supply' ? 'BILL OF SUPPLY' : 'TAX INVOICE';
      const fmt = (n) => `${curr} ${Number(n).toFixed(2)}`;
      let y = height - 40;

      const text = (t, x, fy, sz = 10, bold = false, col = rgb(0, 0, 0)) => {
        drawUnicodeText(page, t, { x, y: fy, size: sz, font: bold ? boldFont : font, color: col }, unicodeFonts);
      };
      const cols = [42, 287, 340, 402, 475];
      const headers = ['Item / Description', 'HSN', 'Qty', 'Taxable', 'Total'];
      const drawTableHeader = () => {
        page.drawRectangle({ x: 40, y: y - 17, width: width - 80, height: 22, color: rgb(0.95, 0.95, 1) });
        y -= 13;
        headers.forEach((header, index) => text(header, cols[index], y, 8, true));
        y -= 7;
        page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
        y -= 15;
      };
      const addContinuationPage = () => {
        page = pdfDoc.addPage([595, 842]);
        y = height - 40;
        text(`${documentTitle} ${invoice.invoiceNumber} (continued)`, 40, y, 11, true, rgb(0.27, 0.25, 1));
        y -= 24;
        drawTableHeader();
      };

      // Header
      text(documentTitle, width / 2 - 50, y, 16, true, rgb(0.27, 0.25, 1));
      y -= 24;
      text(invoice.seller.tradeName || invoice.seller.legalName || 'Company Name', 40, y, 12, true);
      y -= 16;
      text(invoice.seller.address + ', ' + invoice.seller.city + ', ' + invoice.seller.state + ' - ' + invoice.seller.pin, 40, y, 9);
      if (invoice.seller.gstin) { y -= 13; text('GSTIN: ' + invoice.seller.gstin, 40, y, 9, true); }

      y -= 20;
      page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= 16;

      // Invoice details
      text('Invoice No: ' + invoice.invoiceNumber, 40, y, 9, true);
      text('Date: ' + invoice.invoiceDate, width - 160, y, 9);
      y -= 13;
      text('Place of Supply: ' + invoice.placeOfSupply, 40, y, 9);
      if (invoice.dueDate) text('Due Date: ' + invoice.dueDate, width - 160, y, 9);

      y -= 20;
      // Bill to
      text('BILL TO', 40, y, 9, true, rgb(0.27, 0.25, 1));
      y -= 13;
      text(invoice.buyer.name || invoice.buyer.businessName || 'Customer', 40, y, 10, true);
      y -= 13;
      text(invoice.buyer.billingAddress || '', 40, y, 9);
      if (invoice.buyer.gstin) { y -= 12; text('GSTIN: ' + invoice.buyer.gstin, 40, y, 9); }

      y -= 20;
      page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= 3;
      drawTableHeader();

      for (const item of invoice.items) {
        if (y < 195) addContinuationPage();
        const c = calcItem(item, invoice.seller.state, invoice.placeOfSupply, invoice.invoiceType);
        text(item.name.slice(0, 42), cols[0], y, 8, true);
        text(String(item.hsn || '').slice(0, 8), cols[1], y, 8);
        text(`${item.qty} ${item.unit}`, cols[2], y, 8);
        text(fmt(c.taxable), cols[3], y, 8);
        text(fmt(c.total), cols[4], y, 8);
        y -= 12;
        const detail = [item.description, `Rate ${fmt(item.rate)}`, item.discount ? `Disc ${item.discount}%` : '', invoice.invoiceType === 'tax' ? `GST ${item.gstRate}%` : ''].filter(Boolean).join('  ·  ');
        text(detail.slice(0, 78), cols[0], y, 7, false, rgb(0.35, 0.37, 0.43));
        y -= 18;
      }

      if (y < 180) {
        page = pdfDoc.addPage([595, 842]);
        y = height - 50;
        text(`${documentTitle} ${invoice.invoiceNumber} - Summary`, 40, y, 11, true, rgb(0.27, 0.25, 1));
        y -= 28;
      }

      y -= 4;
      page.drawLine({ start: { x: 40, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= 18;

      // Totals
      const labelX = width - 230;
      const valueX = width - 120;
      const tRow = (label, value, bold = false) => {
        text(label, labelX, y, 9, bold);
        text(value, valueX, y, 9, bold);
        y -= 14;
      };
      tRow('Taxable Amount:', fmt(totals.taxable));
      if (totals.cgst > 0) { tRow('CGST:', fmt(totals.cgst)); tRow('SGST:', fmt(totals.sgst)); }
      if (totals.igst > 0) tRow('IGST:', fmt(totals.igst));
      y -= 2;
      page.drawLine({ start: { x: labelX - 10, y }, end: { x: width - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
      y -= 14;
      tRow('Grand Total:', fmt(totals.total), true);

      // Bank details
      if (invoice.seller.bankName) {
        y -= 10;
        text('Bank Details:', 40, y, 9, true);
        y -= 12;
        text(`${invoice.seller.bankName} | A/c: ${invoice.seller.accountNumber} | IFSC: ${invoice.seller.ifsc}`, 40, y, 8);
        if (invoice.seller.upiId) { y -= 12; text('UPI: ' + invoice.seller.upiId, 40, y, 8); }
      }

      // Footer
      if (invoice.terms) {
        y -= 20;
        text('Terms & Conditions:', 40, y, 8, true);
        y -= 12;
        text(invoice.terms.slice(0, 120), 40, y, 8);
      }

      pdfDoc.getPages().forEach((outputPage, index) => outputPage.drawText(`Page ${index + 1} of ${pdfDoc.getPageCount()}`, { x: width / 2 - 22, y: 25, size: 7, font, color: rgb(0.6, 0.6, 0.6) }));

      const out = await pdfDoc.save();
      downloadBlob(new Blob([out], { type: 'application/pdf' }), `invoice-${invoice.invoiceNumber}.pdf`);
      showToast('Invoice downloaded!', 'success');
      await saveInvoice({ ...invoice, savedAt: Date.now() });
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
    setProcessing(false);
  };

  return (
    <ToolPage toolId="gst-invoice">
      <Tabs
        tabs={[
          { key: 'seller', label: 'Seller' },
          { key: 'buyer', label: 'Buyer' },
          { key: 'invoice', label: 'Invoice' },
          { key: 'items', label: 'Items' },
          { key: 'other', label: 'Other' },
          { key: 'summary', label: 'Summary' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'seller' && (
        <div className="tool-panel">
          <div className="tool-panel-title">Seller / Your Business</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            <FormGroup label="Trade / Brand Name"><input className="form-input" value={invoice.seller.tradeName} onChange={(e) => update('seller.tradeName', e.target.value)} /></FormGroup>
            <FormGroup label="Legal Business Name"><input className="form-input" value={invoice.seller.legalName} onChange={(e) => update('seller.legalName', e.target.value)} /></FormGroup>
            <FormGroup label="GSTIN"><input className="form-input" value={invoice.seller.gstin} onChange={(e) => update('seller.gstin', e.target.value)} placeholder="22AAAAA0000A1Z5" /></FormGroup>
            <FormGroup label="PAN"><input className="form-input" value={invoice.seller.pan} onChange={(e) => update('seller.pan', e.target.value)} /></FormGroup>
            <FormGroup label="Address" ><input className="form-input" value={invoice.seller.address} onChange={(e) => update('seller.address', e.target.value)} /></FormGroup>
            <FormGroup label="City"><input className="form-input" value={invoice.seller.city} onChange={(e) => update('seller.city', e.target.value)} /></FormGroup>
            <FormGroup label="State">
              <select className="form-select" value={invoice.seller.state} onChange={(e) => update('seller.state', e.target.value)}>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="PIN Code"><input className="form-input" value={invoice.seller.pin} onChange={(e) => update('seller.pin', e.target.value)} /></FormGroup>
            <FormGroup label="Phone"><input className="form-input" value={invoice.seller.phone} onChange={(e) => update('seller.phone', e.target.value)} /></FormGroup>
            <FormGroup label="Email"><input className="form-input" value={invoice.seller.email} onChange={(e) => update('seller.email', e.target.value)} /></FormGroup>
            <FormGroup label="Website"><input className="form-input" value={invoice.seller.website} onChange={(e) => update('seller.website', e.target.value)} /></FormGroup>
          </div>
          <div className="action-row"><button className="btn btn-secondary" onClick={saveBusinessProfile}><Save size={15} /> Save business profile</button>{profiles.map((profile) => <button className="btn btn-secondary" key={profile.id} onClick={() => setInvoice((current) => ({ ...current, seller: { ...current.seller, ...profile } }))}>{profile.name}</button>)}</div>
          <hr className="divider" />
          <div className="tool-panel-title">Bank Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            <FormGroup label="Bank Name"><input className="form-input" value={invoice.seller.bankName} onChange={(e) => update('seller.bankName', e.target.value)} /></FormGroup>
            <FormGroup label="Account Number"><input className="form-input" value={invoice.seller.accountNumber} onChange={(e) => update('seller.accountNumber', e.target.value)} /></FormGroup>
            <FormGroup label="IFSC Code"><input className="form-input" value={invoice.seller.ifsc} onChange={(e) => update('seller.ifsc', e.target.value)} /></FormGroup>
            <FormGroup label="UPI ID"><input className="form-input" value={invoice.seller.upiId} onChange={(e) => update('seller.upiId', e.target.value)} /></FormGroup>
          </div>
        </div>
      )}

      {tab === 'buyer' && (
        <div className="tool-panel">
          <div className="tool-panel-title">Buyer / Customer Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14 }}>
            <FormGroup label="Customer Name"><input className="form-input" value={invoice.buyer.name} onChange={(e) => update('buyer.name', e.target.value)} /></FormGroup>
            <FormGroup label="Business Name"><input className="form-input" value={invoice.buyer.businessName} onChange={(e) => update('buyer.businessName', e.target.value)} /></FormGroup>
            <FormGroup label="GSTIN (if applicable)"><input className="form-input" value={invoice.buyer.gstin} onChange={(e) => update('buyer.gstin', e.target.value)} /></FormGroup>
            <FormGroup label="Billing Address"><input className="form-input" value={invoice.buyer.billingAddress} onChange={(e) => update('buyer.billingAddress', e.target.value)} /></FormGroup>
            <FormGroup label="Shipping Address"><input className="form-input" value={invoice.buyer.shippingAddress} onChange={(e) => update('buyer.shippingAddress', e.target.value)} /></FormGroup>
            <FormGroup label="State">
              <select className="form-select" value={invoice.buyer.state} onChange={(e) => update('buyer.state', e.target.value)}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Phone"><input className="form-input" value={invoice.buyer.phone} onChange={(e) => update('buyer.phone', e.target.value)} /></FormGroup>
            <FormGroup label="Email"><input className="form-input" value={invoice.buyer.email} onChange={(e) => update('buyer.email', e.target.value)} /></FormGroup>
          </div>
        </div>
      )}

      {tab === 'invoice' && (
        <div className="tool-panel">
          <div className="tool-panel-title">Invoice Details</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
            <FormGroup label="Invoice Type">
              <select className="form-select" value={invoice.invoiceType} onChange={(e) => update('invoiceType', e.target.value)}>
                <option value="tax">Tax Invoice</option>
                <option value="bill-of-supply">Bill of Supply</option>
              </select>
            </FormGroup>
            <FormGroup label="Invoice Number"><input className="form-input" value={invoice.invoiceNumber} onChange={(e) => update('invoiceNumber', e.target.value)} /></FormGroup>
            <FormGroup label="Invoice Date"><input className="form-input" type="date" value={invoice.invoiceDate} onChange={(e) => update('invoiceDate', e.target.value)} /></FormGroup>
            <FormGroup label="Due Date"><input className="form-input" type="date" value={invoice.dueDate} onChange={(e) => update('dueDate', e.target.value)} /></FormGroup>
            <FormGroup label="Place of Supply">
              <select className="form-select" value={invoice.placeOfSupply} onChange={(e) => update('placeOfSupply', e.target.value)}>
                {INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </FormGroup>
            <FormGroup label="Currency">
              <select className="form-select" value={invoice.currency} onChange={(e) => update('currency', e.target.value)}>
                <option value="INR">INR (₹)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
              </select>
            </FormGroup>
            <FormGroup label="Payment terms"><input className="form-input" value={invoice.paymentTerms} onChange={(event) => update('paymentTerms', event.target.value)} /></FormGroup>
            <label className="check-row"><input type="checkbox" checked={invoice.reverseCharge} onChange={(event) => update('reverseCharge', event.target.checked)} /> Reverse charge applicable</label>
          </div>
          <FormGroup label="Notes"><textarea className="form-textarea" value={invoice.notes} onChange={(e) => update('notes', e.target.value)} style={{ minHeight: 80 }} /></FormGroup>
          <FormGroup label="Terms & Conditions"><textarea className="form-textarea" value={invoice.terms} onChange={(e) => update('terms', e.target.value)} style={{ minHeight: 60 }} /></FormGroup>
        </div>
      )}

      {tab === 'items' && (
        <div className="tool-panel">
          <div className="tool-panel-title" style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Invoice Items</span>
            <button className="btn btn-sm btn-primary" onClick={addItem}><Plus size={13} /> Add Item</button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
              <thead>
                <tr style={{ background: 'var(--bg-surface-2)' }}>
                  {['Item Name', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'Disc%', 'GST%', 'Taxable', 'Total', ''].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item, itemIndex) => {
                  const c = calcItem(item, invoice.seller.state, invoice.placeOfSupply, invoice.invoiceType);
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" value={item.name} onChange={(e) => updateItem(item.id, 'name', e.target.value)} style={{ minWidth: 120 }} /><input className="form-input" value={item.description} onChange={(e) => updateItem(item.id, 'description', e.target.value)} placeholder="Description" style={{ minWidth: 120, marginTop: 4 }} /></td>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" value={item.hsn} onChange={(e) => updateItem(item.id, 'hsn', e.target.value)} style={{ width: 80 }} /></td>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" type="number" value={item.qty} onChange={(e) => updateItem(item.id, 'qty', +e.target.value)} style={{ width: 60 }} /></td>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" value={item.unit} onChange={(e) => updateItem(item.id, 'unit', e.target.value)} style={{ width: 60 }} /></td>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" type="number" value={item.rate} onChange={(e) => updateItem(item.id, 'rate', +e.target.value)} style={{ width: 80 }} /></td>
                      <td style={{ padding: '6px 8px' }}><input className="form-input" type="number" value={item.discount} onChange={(e) => updateItem(item.id, 'discount', +e.target.value)} style={{ width: 60 }} /></td>
                      <td style={{ padding: '6px 8px' }}>
                        <select className="form-select" value={item.gstRate} onChange={(e) => updateItem(item.id, 'gstRate', +e.target.value)} style={{ width: 70 }}>
                          {GST_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '6px 8px', color: 'var(--text-muted)', fontSize: 12 }}>₹{c.taxable.toFixed(2)}</td>
                      <td style={{ padding: '6px 8px', fontWeight: 600 }}>₹{c.total.toFixed(2)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <button className="icon-btn" disabled={itemIndex === 0} onClick={() => moveItem(itemIndex, -1)}><ArrowUp size={12} /></button><button className="icon-btn" disabled={itemIndex === invoice.items.length - 1} onClick={() => moveItem(itemIndex, 1)}><ArrowDown size={12} /></button>
                        <button className="btn btn-sm btn-danger btn-icon" onClick={() => removeItem(item.id)}><X size={12} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'other' && <div className="tool-panel"><div className="tool-panel-title">Other details & portability</div><FormGroup label="Notes"><textarea className="form-textarea" value={invoice.notes} onChange={(event) => update('notes', event.target.value)} /></FormGroup><FormGroup label="Terms & conditions"><textarea className="form-textarea" value={invoice.terms} onChange={(event) => update('terms', event.target.value)} /></FormGroup><div className="action-row"><button className="btn btn-secondary" onClick={exportData}><Download size={15} /> Export JSON</button><label className="btn btn-secondary"><Upload size={15} /> Import JSON<input hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files[0] && importData(event.target.files[0])} /></label></div></div>}

      {tab === 'summary' && (
        <div className="tool-panel">
          <div className="tool-panel-title">Invoice Summary</div>
          <div style={{ maxWidth: 400, marginLeft: 'auto' }}>
            {[
              ['Taxable Amount', totals.taxable],
              ...(totals.cgst > 0 ? [['CGST', totals.cgst], ['SGST', totals.sgst]] : []),
              ...(totals.igst > 0 ? [['IGST', totals.igst]] : []),
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 'var(--font-size-sm)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                <span>{invoice.currency} {val.toFixed(2)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 0', fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
              <span>Grand Total</span>
              <span style={{ color: 'var(--primary)' }}>{invoice.currency} {totals.total.toFixed(2)}</span>
            </div>
          </div>
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--bg-surface-2)', borderRadius: 8, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
            <strong>Tax treatment:</strong> {invoice.invoiceType === 'bill-of-supply' ? 'Bill of supply — no GST charged' : invoice.seller.state === invoice.placeOfSupply ? 'Intra-state supply — CGST + SGST applicable' : 'Inter-state supply — IGST applicable'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
        <button className="btn btn-primary btn-lg" onClick={handleDownload} disabled={processing}>
          <Download size={18} /> {processing ? 'Generating…' : 'Download PDF Invoice'}
        </button>
        <button className="btn btn-secondary" onClick={handleSave}><Eye size={16} /> Save Draft</button>
        <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={16} /> Print</button>
        <button className="btn btn-secondary" onClick={() => setInvoice(emptyInvoice())}><X size={16} /> New Invoice</button>
      </div>
      {drafts.length > 0 && <div className="tool-panel"><div className="tool-panel-title">Saved invoice history</div>{drafts.map((draft) => <div className="saved-workflow" key={draft.id}><button className="btn btn-secondary" onClick={() => setInvoice(draft)}>{draft.invoiceNumber} · {draft.buyer?.name || 'Customer'}</button><span>{draft.currency} {draft.items?.reduce((sum, item) => sum + calcItem(item, draft.seller.state, draft.placeOfSupply, draft.invoiceType).total, 0).toFixed(2)}</span><button className="icon-btn" onClick={async () => { await deleteInvoice(draft.id); refreshSaved() }}><X size={14} /></button></div>)}</div>}
      <div style={{ marginTop: 12, fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
        This tool generates invoice documents. Always verify tax calculations with a qualified CA for compliance purposes.
      </div>
    </ToolPage>
  );
}
