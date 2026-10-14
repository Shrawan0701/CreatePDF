import { useEffect, useMemo, useState } from 'react'
import { Download, History, Minus, Plus, Printer, Save, Search, Settings, ShoppingCart, Trash2, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { FormGroup, Modal, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { getPdfLib } from '../../services/pdfEngine'
import { deletePosProduct, getPosBills, getPosProducts, getPosSetting, savePosBill, savePosProduct, setPosSetting } from '../../services/storage'

const emptyProduct = () => ({ id: generateId(), name: '', sku: '', category: 'General', description: '', price: 0, gstRate: 18 })
const money = (value) => `₹${Number(value || 0).toFixed(2)}`

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

  const buildBill = () => ({ id: generateId(), number: `POS-${Date.now().toString().slice(-8)}`, createdAt: Date.now(), store, customer, discount, items: cart, totals })

  const saveBill = async () => {
    if (!cart.length) return showToast('Add at least one product.', 'warning')
    const bill = buildBill()
    await savePosBill(bill)
    setBills(await getPosBills())
    showToast(`Bill ${bill.number} saved locally.`, 'success')
    return bill
  }

  const downloadBill = async () => {
    const bill = await saveBill()
    if (!bill) return
    const { PDFDocument, StandardFonts, rgb } = await getPdfLib()
    const pdf = await PDFDocument.create()
    const page = pdf.addPage([320, Math.max(520, 250 + bill.items.length * 28)])
    const regular = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    const height = page.getHeight()
    let y = height - 32
    const text = (value, x, size = 9, useBold = false) => { page.drawText(String(value), { x, y, size, font: useBold ? bold : regular, color: rgb(0.08, 0.09, 0.12) }) }
    text(store.name || 'Store', 24, 16, true); y -= 17
    if (store.address) { text(store.address.slice(0, 48), 24, 8); y -= 12 }
    if (store.gstin) { text(`GSTIN: ${store.gstin}`, 24, 8); y -= 12 }
    text(`Bill ${bill.number}`, 24, 9, true); text(new Date(bill.createdAt).toLocaleString(), 170, 8); y -= 18
    if (customer.name) { text(`Customer: ${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}`, 24, 8); y -= 16 }
    page.drawLine({ start: { x: 24, y }, end: { x: 296, y }, thickness: 0.6 }); y -= 14
    text('Item', 24, 8, true); text('Qty', 178, 8, true); text('Rate', 212, 8, true); text('Amount', 256, 8, true); y -= 14
    bill.items.forEach((item) => { text(item.name.slice(0, 24), 24, 8); text(item.quantity, 182, 8); text(item.price.toFixed(2), 210, 8); text((item.price * item.quantity).toFixed(2), 258, 8); y -= 14 })
    y -= 2; page.drawLine({ start: { x: 24, y }, end: { x: 296, y }, thickness: 0.6 }); y -= 15
    const row = (label, value, strong = false) => { text(label, 178, 9, strong); text(value, 252, 9, strong); y -= 14 }
    row('Subtotal', bill.totals.subtotal.toFixed(2)); if (bill.totals.discountAmount) row('Discount', `-${bill.totals.discountAmount.toFixed(2)}`); row('GST', bill.totals.tax.toFixed(2)); row('Total', bill.totals.total.toFixed(2), true)
    y -= 8; text(`Paid via ${customer.payment}`, 24, 8); y -= 18; text('Thank you for your business.', 86, 9, true)
    const bytes = await pdf.save()
    downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${bill.number}.pdf`)
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
        <button className="btn btn-primary" onClick={() => { setEditingProduct(emptyProduct()); setProductModal(true) }}><Plus size={15} /> Product</button>
      </div>
      <div className="pos-workspace">
        <section className="pos-catalogue">
          {filtered.length ? <div className="product-grid">{filtered.map((product) => <article className="product-card" key={product.id}>
            <button className="product-main" onClick={() => addToCart(product)}><span className="product-avatar">{product.name.slice(0, 2).toUpperCase()}</span><strong>{product.name}</strong><small>{product.category} · {product.gstRate}% GST</small><b>{money(product.price)}</b></button>
            <div className="product-actions"><button onClick={() => { setEditingProduct(product); setProductModal(true) }}>Edit</button><button onClick={() => removeProduct(product.id)}>Delete</button></div>
          </article>)}</div> : <div className="empty-state"><ShoppingCart size={34} /><h3>No products yet</h3><p>Add your catalogue to start billing.</p></div>}
        </section>
        <aside className="bill-panel">
          <div className="bill-heading"><div><span>Current bill</span><strong>{cart.length} items</strong></div><button className="icon-btn" onClick={() => setCart([])} title="Clear cart"><Trash2 size={16} /></button></div>
          <div className="customer-fields"><input className="form-input" placeholder="Customer name" value={customer.name} onChange={(event) => setCustomer({ ...customer, name: event.target.value })} /><input className="form-input" placeholder="Phone" value={customer.phone} onChange={(event) => setCustomer({ ...customer, phone: event.target.value })} /></div>
          <div className="cart-lines">{cart.map((item) => <div className="cart-line" key={item.id}><div><strong>{item.name}</strong><small>{money(item.price)} · GST {item.gstRate}%</small></div><div className="qty-control"><button onClick={() => updateQuantity(item.id, -1)}><Minus size={13} /></button><span>{item.quantity}</span><button onClick={() => updateQuantity(item.id, 1)}><Plus size={13} /></button></div><b>{money(item.price * item.quantity)}</b><button className="icon-btn" onClick={() => setCart(cart.filter((entry) => entry.id !== item.id))}><X size={14} /></button></div>)}</div>
          <div className="bill-options"><label>Discount %<input className="form-input" type="number" min="0" max="100" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} /></label><label>Payment<select className="form-select" value={customer.payment} onChange={(event) => setCustomer({ ...customer, payment: event.target.value })}><option>Cash</option><option>UPI</option><option>Card</option><option>Other</option></select></label></div>
          <div className="bill-totals"><div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div><div><span>Discount</span><b>-{money(totals.discountAmount)}</b></div><div><span>GST</span><b>{money(totals.tax)}</b></div><div className="grand-total"><span>Total</span><b>{money(totals.total)}</b></div></div>
          <div className="bill-actions"><button className="btn btn-secondary" onClick={saveBill}><Save size={15} /> Save</button><button className="btn btn-secondary" onClick={() => window.print()}><Printer size={15} /> Print</button><button className="btn btn-primary" onClick={downloadBill}><Download size={15} /> PDF Bill</button></div>
        </aside>
      </div>
      <Modal open={productModal} onClose={() => setProductModal(false)} title="Product" footer={<><button className="btn btn-secondary" onClick={() => setProductModal(false)}>Cancel</button><button className="btn btn-primary" onClick={saveProduct}>Save product</button></>}><div className="form-grid"><FormGroup label="Name"><input className="form-input" value={editingProduct.name} onChange={(event) => setEditingProduct({ ...editingProduct, name: event.target.value })} /></FormGroup><FormGroup label="SKU"><input className="form-input" value={editingProduct.sku} onChange={(event) => setEditingProduct({ ...editingProduct, sku: event.target.value })} /></FormGroup><FormGroup label="Category"><input className="form-input" value={editingProduct.category} onChange={(event) => setEditingProduct({ ...editingProduct, category: event.target.value })} /></FormGroup><FormGroup label="Price"><input className="form-input" type="number" min="0" value={editingProduct.price} onChange={(event) => setEditingProduct({ ...editingProduct, price: Number(event.target.value) })} /></FormGroup><FormGroup label="GST rate"><select className="form-select" value={editingProduct.gstRate} onChange={(event) => setEditingProduct({ ...editingProduct, gstRate: Number(event.target.value) })}>{[0, 5, 12, 18, 28].map((rate) => <option value={rate} key={rate}>{rate}%</option>)}</select></FormGroup><FormGroup label="Description"><textarea className="form-textarea" value={editingProduct.description} onChange={(event) => setEditingProduct({ ...editingProduct, description: event.target.value })} /></FormGroup></div></Modal>
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Saved bills"><div className="saved-list">{bills.length ? bills.map((bill) => <button key={bill.id} className="saved-row" onClick={() => loadBill(bill)}><span><strong>{bill.number}</strong><small>{new Date(bill.createdAt).toLocaleString()} · {bill.customer?.name || 'Walk-in'}</small></span><b>{money(bill.totals.total)}</b></button>) : <p className="empty-copy">No saved bills yet.</p>}</div></Modal>
      <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Store settings" footer={<button className="btn btn-primary" onClick={saveStore}>Save settings</button>}><div className="form-grid"><FormGroup label="Store name"><input className="form-input" value={store.name} onChange={(event) => setStore({ ...store, name: event.target.value })} /></FormGroup><FormGroup label="GSTIN"><input className="form-input" value={store.gstin} onChange={(event) => setStore({ ...store, gstin: event.target.value })} /></FormGroup><FormGroup label="Phone"><input className="form-input" value={store.phone} onChange={(event) => setStore({ ...store, phone: event.target.value })} /></FormGroup><FormGroup label="Address"><textarea className="form-textarea" value={store.address} onChange={(event) => setStore({ ...store, address: event.target.value })} /></FormGroup></div></Modal>
    </ToolPage>
  )
}
