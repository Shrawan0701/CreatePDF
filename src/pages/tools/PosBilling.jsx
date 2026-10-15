import { useEffect, useMemo, useState } from 'react'
import { Download, History, Minus, Plus, Printer, Save, Search, Settings, ShoppingCart, Trash2, Upload, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { FormGroup, Modal, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { getPdfLib } from '../../services/pdfEngine'
import { drawUnicodeText, embedUnicodeFonts } from '../../services/unicodePdf'
import { deletePosProduct, getPosBills, getPosProducts, getPosSetting, savePosBill, savePosProduct, setPosSetting } from '../../services/storage'

const emptyProduct = () => ({ id: generateId(), name: '', sku: '', category: 'General', description: '', image: '', price: 0, gstRate: 18 })
const money = (value) => `₹${Number(value || 0).toFixed(2)}`
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character])

function receiptHtml(bill) {
  const rows = bill.items.map((item) => `<tr><td>${escapeHtml(item.name)}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</td><td>${item.quantity}</td><td>${money(item.price * item.quantity)}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(bill.number)}</title><style>body{font:13px system-ui,sans-serif;max-width:320px;margin:24px auto;color:#111}h1{font-size:19px;margin:0}p{margin:4px 0}hr{border:0;border-top:1px dashed #777;margin:14px 0}table{width:100%;border-collapse:collapse}td,th{padding:5px 0;text-align:left;vertical-align:top}td:last-child,th:last-child{text-align:right}small{display:block;color:#555}.totals p{display:flex;justify-content:space-between}.total{font-size:16px;font-weight:700}@media print{body{margin:0 auto}@page{size:80mm auto;margin:4mm}}</style></head><body><h1>${escapeHtml(bill.store.name)}</h1><p>${escapeHtml(bill.store.address)}</p><p>${bill.store.gstin ? `GSTIN: ${escapeHtml(bill.store.gstin)}` : ''}</p><hr><p><b>${escapeHtml(bill.number)}</b></p><p>${escapeHtml(new Date(bill.createdAt).toLocaleString())}</p><p>${escapeHtml(bill.customer.name || 'Walk-in')}${bill.customer.phone ? ` · ${escapeHtml(bill.customer.phone)}` : ''}</p>${bill.customer.reference ? `<p>Reference: ${escapeHtml(bill.customer.reference)}</p>` : ''}<hr><table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><hr><div class="totals"><p><span>Subtotal</span><span>${money(bill.totals.subtotal)}</span></p><p><span>Discount</span><span>-${money(bill.totals.discountAmount)}</span></p><p><span>GST</span><span>${money(bill.totals.tax)}</span></p><p class="total"><span>Total</span><span>${money(bill.totals.total)}</span></p></div><hr><p>Paid via ${escapeHtml(bill.customer.payment)}</p><p>Thank you for your business.</p></body></html>`
}

export default function PosBilling() {
  const { showToast } = useApp()
  const [products, setProducts] = useState([])
  const [bills, setBills] = useState([])
  const [cart, setCart] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [productModal, setProductModal] = useState(false)
  const [editingProduct, setEditingProduct] = useState(emptyProduct())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [store, setStore] = useState({ name: 'My Store', address: '', gstin: '', phone: '' })
  const [customer, setCustomer] = useState({ name: '', phone: '', reference: '', payment: 'Cash' })
  const [discount, setDiscount] = useState(0)

  const refresh = async () => {
    setProducts(await getPosProducts())
    setBills(await getPosBills())
    setStore(await getPosSetting('store', { name: 'My Store', address: '', gstin: '', phone: '' }))
  }

  useEffect(() => { refresh() }, [])

  const categories = useMemo(() => ['All', ...new Set(products.map((item) => item.category).filter(Boolean))], [products])
  const filtered = products.filter((item) => {
    const matchesQuery = `${item.name} ${item.sku} ${item.description}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (category === 'All' || item.category === category)
  })
  const totals = useMemo(() => {
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
    const discountAmount = subtotal * Math.max(0, Math.min(100, discount)) / 100
    const taxable = subtotal - discountAmount
    const tax = cart.reduce((sum, item) => {
      const lineAfterDiscount = item.price * item.quantity * (1 - Math.max(0, Math.min(100, discount)) / 100)
      return sum + lineAfterDiscount * item.gstRate / 100
    }, 0)
    return { subtotal, discountAmount, taxable, tax, total: taxable + tax }
  }, [cart, discount])

  const addToCart = (product) => setCart((current) => {
    const exists = current.find((item) => item.id === product.id)
    return exists ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...product, quantity: 1, note: '' }]
  })
  const updateQuantity = (id, delta) => setCart((current) => current.map((item) => item.id === id ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item))

  const saveProduct = async () => {
    if (!editingProduct.name.trim() || Number(editingProduct.price) < 0) return showToast('Enter a valid product name and price.', 'warning')
    await savePosProduct({ ...editingProduct, price: Number(editingProduct.price), gstRate: Number(editingProduct.gstRate) })
    setProductModal(false)
    setEditingProduct(emptyProduct())
    await refresh()
    showToast('Product saved locally.', 'success')
  }

  const removeProduct = async (id) => {
    await deletePosProduct(id)
    setCart((current) => current.filter((item) => item.id !== id))
    await refresh()
  }

  const exportJson = (value, name) => downloadBlob(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }), name)
  const importProducts = async (file) => {
    try {
      const incoming = JSON.parse(await file.text())
      if (!Array.isArray(incoming)) throw new Error('Catalogue JSON must contain an array.')
      for (const product of incoming) await savePosProduct({ ...emptyProduct(), ...product, id: product.id || generateId(), price: Number(product.price || 0), gstRate: Number(product.gstRate || 0) })
      await refresh()
      showToast(`${incoming.length} products imported.`, 'success')
    } catch (error) { showToast(error.message, 'error') }
  }

  const buildBill = () => ({ id: generateId(), number: `POS-${Date.now().toString().slice(-8)}`, createdAt: Date.now(), store, customer, discount, items: cart, totals })

  const saveBill = async () => {
    if (!cart.length) return showToast('Add at least one product.', 'warning')
    const bill = buildBill()
    await savePosBill(bill)
    setBills(await getPosBills())
    showToast(`Bill ${bill.number} saved locally.`, 'success')
    return bill
  }

  const exportBillPdf = async (bill) => {
    const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([320, Math.max(520, 290 + bill.items.length * 28 + bill.items.filter((item) => item.note).length * 12)])
    const regular = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const unicodeFonts = { ...await embedUnicodeFonts(pdf), baseBold: bold }
    const height = page.getHeight()
    let y = height - 32
    const text = (value, x, size = 9, useBold = false) => { drawUnicodeText(page, value, { x, y, size, font: useBold ? bold : regular, color: rgb(0.08, 0.09, 0.12) }, unicodeFonts) }
    text(bill.store.name || 'Store', 24, 16, true); y -= 17
    if (bill.store.address) { text(bill.store.address.slice(0, 48), 24, 8); y -= 12 }
    if (bill.store.gstin) { text(`GSTIN: ${bill.store.gstin}`, 24, 8); y -= 12 }
    text(`Bill ${bill.number}`, 24, 9, true); text(new Date(bill.createdAt).toLocaleString(), 170, 8); y -= 18
    if (bill.customer.name) { text(`Customer: ${bill.customer.name}${bill.customer.phone ? ` · ${bill.customer.phone}` : ''}`, 24, 8); y -= 16 }
    if (bill.customer.reference) { text(`Reference: ${bill.customer.reference}`, 24, 8); y -= 14 }
    page.drawLine({ start: { x: 24, y }, end: { x: 296, y }, thickness: 0.6 }); y -= 14
    text('Item', 24, 8, true); text('Qty', 178, 8, true); text('Rate', 212, 8, true); text('Amount', 256, 8, true); y -= 14
    bill.items.forEach((item) => { text(item.name.slice(0, 24), 24, 8); text(item.quantity, 182, 8); text(item.price.toFixed(2), 210, 8); text((item.price * item.quantity).toFixed(2), 258, 8); y -= 14; if (item.note) { text(item.note.slice(0, 38), 24, 7); y -= 12 } })
    y -= 2; page.drawLine({ start: { x: 24, y }, end: { x: 296, y }, thickness: 0.6 }); y -= 15
    const row = (label, value, strong = false) => { text(label, 178, 9, strong); text(value, 252, 9, strong); y -= 14 }
    row('Subtotal', bill.totals.subtotal.toFixed(2)); if (bill.totals.discountAmount) row('Discount', `-${bill.totals.discountAmount.toFixed(2)}`); row('GST', bill.totals.tax.toFixed(2)); row('Total', bill.totals.total.toFixed(2), true)
    y -= 8; text(`Paid via ${bill.customer.payment}`, 24, 8); y -= 18; text('Thank you for your business.', 86, 9, true)
    const bytes = await pdf.save()
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${bill.number}.pdf`)
  }

  const downloadBill = async () => { const bill = await saveBill(); if (bill) await exportBillPdf(bill) }
  const printBill = async (bill = null) => {
    if (!bill && !cart.length) return showToast('Add at least one product.', 'warning')
    const printWindow = window.open('', '_blank')
    if (!printWindow) return showToast('Allow pop-ups to print the receipt.', 'warning')
    try {
      const receipt = bill || await saveBill()
      printWindow.document.open()
      printWindow.onload = () => printWindow.print()
      printWindow.document.write(receiptHtml(receipt))
      printWindow.document.close()
      printWindow.focus()
    } catch (error) { printWindow.close(); showToast(error.message, 'error') }
  }

  const saveStore = async () => { await setPosSetting('store', store); setSettingsOpen(false); showToast('Store settings saved.', 'success') }
  const loadBill = (bill) => { setCart(bill.items); setCustomer(bill.customer); setDiscount(bill.discount || 0); setHistoryOpen(false) }

  return (
    <ToolPage toolId="pos-billing">
      <div className="pos-toolbar">
        <div className="pos-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products or SKU" /></div>
        <select className="form-select" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
        <button className="btn btn-secondary" onClick={() => setHistoryOpen(true)}><History size={15} /> Bills</button>
        <button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}><Settings size={15} /> Store</button>
        <button className="btn btn-secondary" onClick={() => exportJson(products, 'pos-catalogue.json')}><Download size={15} /> Export</button>
        <label className="btn btn-secondary"><Upload size={15} /> Import<input hidden type="file" accept="application/json,.json" onChange={(event) => event.target.files[0] && importProducts(event.target.files[0])} /></label>
        <button className="btn btn-primary" onClick={() => { setEditingProduct(emptyProduct()); setProductModal(true) }}><Plus size={15} /> Product</button>
      </div>
      <div className="pos-workspace">
        <section className="pos-catalogue">
          {filtered.length ? <div className="product-grid">{filtered.map((product) => <article className="product-card" key={product.id}>
            <button className="product-main" onClick={() => addToCart(product)}>{product.image ? <img className="product-avatar" src={product.image} alt="" /> : <span className="product-avatar">{product.name.slice(0, 2).toUpperCase()}</span>}<strong>{product.name}</strong><small>{product.category} · {product.gstRate}% GST</small><b>{money(product.price)}</b></button>
            <div className="product-actions"><button onClick={() => { setEditingProduct(product); setProductModal(true) }}>Edit</button><button onClick={() => removeProduct(product.id)}>Delete</button></div>
          </article>)}</div> : <div className="empty-state"><ShoppingCart size={34} /><h3>No products yet</h3><p>Add your catalogue to start billing.</p></div>}
        </section>
        <aside className="bill-panel">
          <div className="bill-heading"><div><span>Current bill</span><strong>{cart.length} items</strong></div><button className="icon-btn" onClick={() => setCart([])} title="Clear cart"><Trash2 size={16} /></button></div>
          <div className="customer-fields"><input className="form-input" placeholder="Customer name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /><input className="form-input" placeholder="Phone" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} /><input className="form-input" placeholder="Order reference" value={customer.reference} onChange={(event) => setCustomer({ ...customer, reference: event.target.value })} /></div>
          <div className="cart-lines">{cart.map((item) => <div className="cart-line" key={item.id}><div><strong>{item.name}</strong><small>{money(item.price)} · GST {item.gstRate}%</small><input className="cart-note" placeholder="Item note" value={item.note || ''} onChange={(event) => setCart(cart.map((entry) => entry.id === item.id ? { ...entry, note: event.target.value } : entry))} /></div><div className="qty-control"><button onClick={() => updateQuantity(item.id, -1)}><Minus size={13} /></button><span>{item.quantity}</span><button onClick={() => updateQuantity(item.id, 1)}><Plus size={13} /></button></div><b>{money(item.price * item.quantity)}</b><button className="icon-btn" onClick={() => setCart(cart.filter((entry) => entry.id !== item.id))}><X size={14} /></button></div>)}</div>
          <div className="bill-options"><label>Discount %<input className="form-input" type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label><label>Payment<select className="form-select" value={customer.payment} onChange={(event) => setCustomer({ ...customer, payment: event.target.value })}><option>Cash</option><option>UPI</option><option>Card</option><option>Other</option></select></label></div>
          <div className="bill-totals"><div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div><div><span>Discount</span><b>-{money(totals.discountAmount)}</b></div><div><span>GST</span><b>{money(totals.tax)}</b></div><div className="grand-total"><span>Total</span><b>{money(totals.total)}</b></div></div>
          <div className="bill-actions"><button className="btn btn-secondary" onClick={saveBill}><Save size={15} /> Save</button><button className="btn btn-secondary" onClick={() => printBill()}><Printer size={15} /> Print</button><button className="btn btn-primary" onClick={downloadBill}><Download size={15} /> PDF Bill</button></div>
        </aside>
      </div>
      <Modal open={productModal} onClose={() => setProductModal(false)} title="Product" footer={<><button className="btn btn-secondary" onClick={() => setProductModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveProduct}>Save product</button></>}><div className="form-grid"><FormGroup label="Name"><input className="form-input" value={editingProduct.name} onChange={(event) => setEditingProduct({ ...editingProduct, name: event.target.value })} /></FormGroup><FormGroup label="SKU"><input className="form-input" value={editingProduct.sku} onChange={(event) => setEditingProduct({ ...editingProduct, sku: event.target.value })} /></FormGroup><FormGroup label="Category"><input className="form-input" value={editingProduct.category} onChange={(event) => setEditingProduct({ ...editingProduct, category: event.target.value })} /></FormGroup><FormGroup label="Price"><input className="form-input" type="number" min="0" value={editingProduct.price} onChange={(event) => setEditingProduct({ ...editingProduct, price: Number(event.target.value) })} /></FormGroup><FormGroup label="GST rate"><select className="form-select" value={editingProduct.gstRate} onChange={(event) => setEditingProduct({ ...editingProduct, gstRate: Number(event.target.value) })}>{[0, 5, 12, 18, 28].map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></FormGroup><FormGroup label="Description"><textarea className="form-textarea" value={editingProduct.description} onChange={(event) => setEditingProduct({ ...editingProduct, description: event.target.value })} /></FormGroup><FormGroup label="Product image"><input type="file" accept="image/*" onChange={(event) => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setEditingProduct((current) => ({ ...current, image: reader.result })); reader.readAsDataURL(file) }} /></FormGroup></div></Modal>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Saved bills"><div className="action-row"><button className="btn btn-secondary" onClick={() => exportJson(bills, 'pos-bill-history.json')}><Download size={14} /> Export history</button></div><div className="saved-list">{bills.length ? bills.map((bill) => <div key={bill.id} className="saved-workflow"><button className="saved-row" onClick={() => loadBill(bill)}><span><strong>{bill.number}</strong><small>{new Date(bill.createdAt).toLocaleString()} · {bill.customer?.name || 'Walk-in'}</small></span><b>{money(bill.totals.total)}</b></button><button className="icon-btn" title="Print saved receipt" onClick={() => printBill(bill)}><Printer size={15} /></button><button className="icon-btn" title="Download saved PDF" onClick={() => exportBillPdf(bill)}><Download size={15} /></button></div>) : <p className="empty-copy">No saved bills yet.</p>}</div></Modal>
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Store settings" footer={<button className="btn btn-primary" onClick={saveStore}>Save settings</button>}><div className="form-grid"><FormGroup label="Store name"><input className="form-input" value={store.name} onChange={(event) => setStore({ ...store, name: event.target.value })} /></FormGroup><FormGroup label="GSTIN"><input className="form-input" value={store.gstin} onChange={(event) => setStore({ ...store, gstin: event.target.value })} /></FormGroup><FormGroup label="Phone"><input className="form-input" value={store.phone} onChange={(event) => setStore({ ...store, phone: event.target.value })} /></FormGroup><FormGroup label="Address"><textarea className="form-textarea" value={store.address} onChange={(event) => setStore({ ...store, address: event.target.value })} /></FormGroup></div></Modal>
    </ToolPage>
  )
}
