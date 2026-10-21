import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, History, Minus, Plus, Printer, Save, Search, Settings, ShoppingCart, Trash2, Upload, X } from 'lucide-react'
import { ToolPage } from '../../components/ToolPage'
import { FormGroup, Modal, downloadBlob, generateId } from '../../components/ui'
import { useApp } from '../../context/AppContext'
import { deletePosProduct, getPosBills, getPosProducts, getPosSetting, savePosBill, savePosProduct, savePosProducts, setPosSetting } from '../../services/storage'
import { countryCurrency, countryTax, currencyDigits, currencyFactor, formatMinor, INVOICE_COUNTRIES, INVOICE_CURRENCIES } from '../../services/invoiceLocale'
import { newPosProduct, newPosStore, normalizePosBill, normalizePosProduct, normalizePosStore, parsePosCatalogue, posBillError, posCatalogueCsv, posPayment, posProductError, posTotals } from '../../services/posBilling'
import { createPosReceiptPdf, posReceiptHtml } from '../../services/posReceipt'
import { readEditorImage } from '../../services/pdfEditor'
import './PosBilling.css'

function Field({ label, hint, value, onChange, multiline, inputRef, ...props }) {
  const shared = { ...props, value: value ?? '', onChange: event => onChange(event.target.value) }
  return <FormGroup label={label} hint={hint}>{multiline ? <textarea className="form-textarea" {...shared} /> : <input ref={inputRef} className="form-input" {...shared} />}</FormGroup>
}
const newIdentity = () => {
  const id = globalThis.crypto?.randomUUID?.() || generateId(), createdAt = Date.now(), date = new Date(createdAt)
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`
  return { id, number: `POS-${day}-${id.replaceAll('-', '').slice(-8).toUpperCase()}`, createdAt }
}
const newCustomer = () => ({ name: '', phone: '', reference: '' })
const newPayment = () => ({ method: 'Not paid', received: '' })
const newQuickItem = () => ({ name: '', price: '', quantity: 1 })
const safeFilename = value => String(value).replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 100) || 'receipt'

export default function PosBilling() {
  const { showToast } = useApp()
  const [products, setProducts] = useState([]), [bills, setBills] = useState([])
  const [cart, setCart] = useState([]), [identity, setIdentity] = useState(newIdentity)
  const [store, setStore] = useState(newPosStore), [storeDraft, setStoreDraft] = useState(newPosStore)
  const configuredStore = useRef(newPosStore())
  const [customer, setCustomer] = useState(newCustomer), [payment, setPayment] = useState(newPayment)
  const [discount, setDiscount] = useState(0), [quick, setQuick] = useState(newQuickItem)
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All')
  const [productModal, setProductModal] = useState(false), [editingProduct, setEditingProduct] = useState(() => newPosProduct(generateId()))
  const [historyOpen, setHistoryOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false)
  const [historyQuery, setHistoryQuery] = useState(''), [busy, setBusy] = useState(''), [ready, setReady] = useState(false), [loadError, setLoadError] = useState(''), [draftError, setDraftError] = useState('')
  const lock = useRef(false), fileInput = useRef(null), quickName = useRef(null), draftSnapshot = useRef(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getPosProducts(), getPosBills(), getPosSetting('store'), getPosSetting('active-bill-v2')]).then(([catalogue, history, settings, draft]) => {
      if (cancelled) return
      // The previous catalogue stored all prices in INR, even if the user had
      // never opened Store settings. Do not silently relabel those prices USD.
      const savedStore = normalizePosStore(settings || (catalogue.some(item => !item.currency) ? { name: 'My Store', currency: 'INR', country: 'IN' } : null))
      setProducts(catalogue.map(normalizePosProduct)); setBills(history.map(normalizePosBill)); configuredStore.current = savedStore
      setStore(draft?.cart?.length ? normalizePosStore(draft.store) : savedStore)
      if (draft && Array.isArray(draft.cart) && draft.identity?.id) {
        setCart(draft.cart); setIdentity(draft.identity); setCustomer({ ...newCustomer(), ...draft.customer }); setPayment({ ...newPayment(), ...draft.payment }); setDiscount(draft.discount ?? 0)
      }
      setReady(true)
    }).catch(error => { if (!cancelled) setLoadError(`Local records could not be opened: ${error.message}`) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!ready) return
    const snapshot = { cart, identity, store, customer, payment, discount }
    draftSnapshot.current = snapshot
    const timer = setTimeout(() => {
      setPosSetting('active-bill-v2', snapshot).then(() => setDraftError('')).catch(() => setDraftError('Draft could not be saved. Download the receipt before leaving.'))
    }, 400)
    return () => clearTimeout(timer)
  }, [ready, cart, identity, store, customer, payment, discount])
  useEffect(() => {
    const flush = () => { if (draftSnapshot.current) setPosSetting('active-bill-v2', draftSnapshot.current).catch(() => {}) }
    window.addEventListener('pagehide', flush)
    return () => { window.removeEventListener('pagehide', flush); flush() }
  }, [])

  const run = async (label, work) => {
    if (lock.current || !ready) return
    lock.current = true; setBusy(label)
    try { await work() } catch (error) { showToast(error.message || 'The action could not be completed.', 'error') }
    finally { lock.current = false; setBusy('') }
  }
  const money = minor => formatMinor(minor, store.currency, store.country === 'IN' ? 'en-IN' : 'en-US')
  const unitMoney = value => new Intl.NumberFormat(store.country === 'IN' ? 'en-IN' : 'en-US', { style: 'currency', currency: store.currency, maximumFractionDigits: 20 }).format(Number(value) || 0)
  const totals = useMemo(() => posTotals(cart, discount, store), [cart, discount, store])
  const paid = posPayment({ totals, payment, store }), billError = posBillError(cart, discount, store, payment)
  const currentProducts = products.filter(product => product.currency === store.currency)
  const categories = ['All', ...new Set(currentProducts.map(product => product.category).filter(Boolean))]
  const filtered = currentProducts.filter(product => (category === 'All' || product.category === category) && `${product.name} ${product.sku} ${product.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const disabled = !!busy || !ready
  const historyMatches = bills.filter(bill => `${bill.number} ${bill.customer?.name || ''} ${bill.customer?.phone || ''}`.toLowerCase().includes(historyQuery.toLowerCase()))
  const updateLine = (id, patch) => setCart(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  const addToCart = product => setCart(current => {
    const exists = current.find(item => item.id === product.id)
    const line = { ...product, quantity: product.quantity || 1, note: '' }
    delete line.image
    return exists ? current.map(item => item.id === product.id ? { ...item, quantity: Math.min(1e6, (Number(item.quantity) || 0) + 1) } : item) : [...current, line]
  })
  const addQuickItem = event => {
    event.preventDefault()
    const product = { ...newPosProduct(generateId()), ...quick, currency: store.currency }
    const error = posBillError([product], 0, store, newPayment())
    if (error) return showToast(error, 'warning')
    addToCart({ ...normalizePosProduct(product), quantity: Number(quick.quantity) }); setQuick(newQuickItem()); quickName.current?.focus()
  }
  const newBill = () => {
    setIdentity(newIdentity()); setCart([]); setCustomer(newCustomer()); setPayment(newPayment()); setDiscount(0); setStore(configuredStore.current); setQuick(newQuickItem()); setCategory('All')
  }
  const buildBill = () => {
    const error = posBillError(cart, discount, store, payment)
    if (error) throw new Error(error)
    return { schemaVersion: 2, ...identity, updatedAt: Date.now(), store: { ...store }, customer: { ...customer }, payment: { ...payment }, discount: Number(discount), items: cart.map(item => ({ ...item, name: item.name.trim(), price: Number(item.price), quantity: Number(item.quantity), gstRate: Number(item.gstRate) })), totals }
  }
  const persistBill = async () => {
    const bill = buildBill()
    await savePosBill(bill)
    setBills(current => [bill, ...current.filter(entry => entry.id !== bill.id)].sort((a, b) => b.createdAt - a.createdAt))
    return bill
  }
  const downloadBill = source => run('PDF', async () => {
    const bill = source || buildBill(), blob = await createPosReceiptPdf(bill)
    downloadBlob(blob, `${safeFilename(bill.number)}.pdf`)
    if (!source) {
      try { await persistBill() }
      catch { showToast('Receipt downloaded, but bill history could not be saved on this device.', 'warning') }
    }
  })
  const printBill = source => {
    if (lock.current || !ready) return
    if (!source && billError) return showToast(billError, 'warning')
    const popup = window.open('', '_blank')
    if (!popup) return showToast('Allow pop-ups to print this receipt.', 'warning')
    run('Print', async () => {
      try {
        const bill = source || buildBill()
        popup.opener = null
        popup.document.open(); popup.onload = () => { popup.focus(); popup.print() }; popup.document.write(posReceiptHtml(bill)); popup.document.close()
        if (!source) {
          try { await persistBill() }
          catch { showToast('Receipt opened for printing, but bill history could not be saved on this device.', 'warning') }
        }
      } catch (error) { popup.close(); throw error }
    })
  }
  const editProduct = product => { setEditingProduct(product ? { ...product } : { ...newPosProduct(generateId()), currency: store.currency }); setProductModal(true) }
  const saveProduct = () => run('Product', async () => {
    const error = posProductError(editingProduct)
    if (error) throw new Error(error)
    const product = normalizePosProduct(editingProduct)
    if (product.sku && products.some(item => item.id !== product.id && item.currency === product.currency && item.sku.toLowerCase() === product.sku.toLowerCase())) throw new Error('This SKU already belongs to another product.')
    await savePosProduct(product); setProducts(current => [...current.filter(item => item.id !== product.id), product]); setProductModal(false)
    showToast('Product saved on this device.', 'success')
  })
  const removeProduct = id => run('Delete', async () => {
    await deletePosProduct(id); setProducts(current => current.filter(item => item.id !== id))
    showToast('Removed from the catalogue. Current bill items are kept.', 'success')
  })
  const importProducts = file => run('Import', async () => {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) throw new Error('Use a catalogue file under 8 MB.')
    const incoming = parsePosCatalogue(await file.text(), /\.json$/i.test(file.name), store.currency), next = new Map(products.map(item => [item.id, item])), used = new Set()
    for (const product of incoming) {
      const key = `${product.currency}:${product.sku.toLowerCase()}`
      if (product.sku && used.has(key)) throw new Error(`Duplicate SKU in the import: ${product.sku}`)
      used.add(key)
      const existing = product.sku && products.find(item => item.currency === product.currency && item.sku.toLowerCase() === product.sku.toLowerCase()), id = existing?.id || generateId()
      next.set(id, { ...product, id, image: product.image || existing?.image || '' })
    }
    await savePosProducts([...next.values()].filter(item => !products.some(old => old === item)))
    setProducts([...next.values()]); setCategory('All'); showToast(`${incoming.length} products imported. Matching SKUs were updated.`, 'success')
  })
  const saveStore = () => run('Store', async () => {
    const settings = normalizePosStore(storeDraft)
    if (cart.length && settings.currency !== store.currency) throw new Error('Start a new bill before changing currency.')
    if (settings.name.length > 200 || settings.address.length > 2000 || settings.taxId.length > 100 || !settings.taxName.trim() || settings.taxName.length > 40) throw new Error('Check the store name, address and tax details.')
    await setPosSetting('store', settings); configuredStore.current = settings; setStore(settings); setSettingsOpen(false); setCategory('All'); showToast('Store settings saved.', 'success')
  })
  const copyBill = bill => {
    const source = normalizePosBill(bill)
    setIdentity(newIdentity()); setStore(source.store); setCart(source.items.map(item => ({ ...item }))); setCustomer({ ...source.customer }); setDiscount(source.discount || 0); setPayment(newPayment()); setCategory('All'); setHistoryOpen(false)
    showToast('Copied to a new bill. The saved receipt is unchanged.', 'success')
  }
  const productField = (key, label, props = {}) => <Field label={label} value={editingProduct[key]} disabled={!!busy} onChange={value => setEditingProduct(current => ({ ...current, [key]: value }))} {...props} />
  const storeField = (key, label, props = {}) => <Field label={label} value={storeDraft[key]} disabled={!!busy} onChange={value => setStoreDraft(current => ({ ...current, [key]: value }))} {...props} />
  const exportCatalogue = (data, name) => downloadBlob(new Blob([posCatalogueCsv(data)], { type: 'text/csv;charset=utf-8' }), name)

  return <ToolPage toolId="pos-billing">
    <div className="pos2">
      <div className="pos2-top">
        <button className="btn btn-secondary" disabled={disabled} onClick={() => { setStoreDraft({ ...store }); setSettingsOpen(true) }}><Settings size={16} />{store.name || 'Store settings'}<span className="pos2-code">{store.currency}</span></button>
        <div className="pos2-top-actions"><button className="btn btn-secondary" onClick={() => setHistoryOpen(true)} disabled={disabled}><History size={16} /> Bills{bills.length ? ` (${bills.length})` : ''}</button><button className="btn btn-secondary" onClick={newBill} disabled={disabled || !cart.length}><Plus size={16} /> New bill</button></div>
      </div>
      {loadError && <p role="alert" className="pos2-error">{loadError} Reload this page to try again.</p>}
      <div className="pos2-layout">
        <section className="pos2-catalogue" aria-label="Items and product catalogue">
          <div className="pos2-card pos2-quick">
            <h3>Quick item <small>No catalogue needed</small></h3>
            <form onSubmit={addQuickItem} className="pos2-quick-form">
              <Field label="Item name" inputRef={quickName} value={quick.name} onChange={name => setQuick({ ...quick, name })} placeholder="e.g. Coffee" maxLength={300} required disabled={disabled} />
              <Field label={`Price (${store.currency})`} type="number" min="0" max="1000000000" step="any" inputMode="decimal" value={quick.price} onChange={price => setQuick({ ...quick, price })} placeholder="0.00" required disabled={disabled} />
              <Field label="Qty" type="number" min="0.001" max="1000000" step="any" value={quick.quantity} onChange={quantity => setQuick({ ...quick, quantity })} required disabled={disabled} />
              <button className="btn btn-primary" disabled={disabled}><Plus size={16} /> Add</button>
            </form>
          </div>
          <div className="pos2-card">
            <div className="pos2-section-heading"><h3>Products <small>{currentProducts.length}</small></h3><button className="btn btn-secondary btn-sm" onClick={() => editProduct()} disabled={disabled}><Plus size={15} /> Product</button></div>
            <div className="pos2-search-row">
              <div className="pos2-search"><Search size={17} /><input aria-label="Search products or SKU" value={query} placeholder="Search products or SKU" disabled={disabled} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
                if (event.key === 'Enter') { const product = currentProducts.find(item => item.sku && item.sku.toLowerCase() === query.trim().toLowerCase()); if (product) { event.preventDefault(); addToCart(product); setQuery('') } }
              }} /></div>
              {categories.length > 1 && <select className="form-select" aria-label="Product category" value={category} onChange={event => setCategory(event.target.value)} disabled={disabled}>{categories.map(item => <option key={item}>{item}</option>)}</select>}
            </div>
            {filtered.length ? <div className="pos2-products">{filtered.map(product => <article className="pos2-product" key={product.id}>
              <button className="pos2-product-add" onClick={() => addToCart(product)} disabled={disabled} aria-label={`Add ${product.name} to bill`}>
                {product.image ? <img src={product.image} alt="" /> : <span className="pos2-avatar">{Array.from(product.name).slice(0, 2).join('').toUpperCase()}</span>}
                <strong>{product.name}</strong><small>{product.sku || product.category || 'Item'}{Number(product.gstRate) ? ` · ${store.taxName} ${product.gstRate}%` : ''}</small><b>{unitMoney(product.price)}</b><span className="pos2-add-hint"><Plus size={13} /> Add to bill</span>
              </button>
              <div className="pos2-product-actions"><button onClick={() => editProduct(product)} disabled={disabled}>Edit</button><button className="icon-btn" title={`Delete ${product.name} from catalogue`} aria-label={`Delete ${product.name} from catalogue`} onClick={() => removeProduct(product.id)} disabled={disabled}><Trash2 size={14} /></button></div>
            </article>)}</div> : <div className="pos2-empty"><ShoppingCart size={30} /><strong>{currentProducts.length ? 'No matching products' : 'Your catalogue is ready to fill'}</strong><p>{currentProducts.length ? 'Try another name, SKU or category.' : 'Use a quick item above, or save products you sell often.'}</p>{query || category !== 'All' ? <button className="btn btn-secondary btn-sm" onClick={() => { setQuery(''); setCategory('All') }}>Clear filters</button> : null}</div>}
            {products.length > currentProducts.length && <p className="pos2-muted">{products.length - currentProducts.length} products use another currency. Switch currency in Store settings to see them.</p>}
            <details className="pos2-details"><summary>Catalogue files</summary><p className="pos2-muted">CSV contains product details and prices. Images stay on this device. Matching SKUs update existing products.</p><div className="pos2-file-actions">
              <button className="btn btn-secondary btn-sm" disabled={disabled || !products.length} onClick={() => exportCatalogue(products, 'pos-products.csv')}><Download size={14} /> Export CSV</button>
              <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={14} /> Import catalogue</button>
              <button className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => exportCatalogue([{ name: 'Example product', price: 10, currency: store.currency, gstRate: 0, sku: 'ITEM-001', category: 'General', description: '' }], 'pos-catalogue-template.csv')}>CSV template</button>
              <input ref={fileInput} hidden type="file" accept=".csv,text/csv,.json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) importProducts(file) }} />
            </div></details>
          </div>
        </section>
        <section className="pos2-card pos2-bill" aria-label="Current bill">
          <div className="pos2-section-heading"><div><h3>Current bill <small>{cart.length} {cart.length === 1 ? 'line' : 'lines'}</small></h3><span className="pos2-muted">{identity.number}</span></div>{cart.length > 0 && <button className="icon-btn" title="Clear bill items" aria-label="Clear bill items" disabled={disabled} onClick={() => { setCart([]); setDiscount(0); setPayment(newPayment()) }}><Trash2 size={17} /></button>}</div>
          <div className="pos2-cart">{cart.length ? cart.map((item, index) => <div className="pos2-line" key={item.id}>
            <div className="pos2-line-heading"><strong>{item.name}</strong><button className="icon-btn" aria-label={`Remove ${item.name}`} title={`Remove ${item.name}`} disabled={disabled} onClick={() => setCart(current => current.filter(entry => entry.id !== item.id))}><X size={15} /></button></div>
            <div className="pos2-line-main"><span className="pos2-muted">{unitMoney(item.price)}{Number(item.gstRate) ? ` · ${item.gstRate}% ${store.taxName}` : ''}</span><div className="pos2-quantity"><button aria-label={`Decrease ${item.name} quantity`} disabled={disabled || Number(item.quantity) <= 1} onClick={() => updateLine(item.id, { quantity: Math.max(1, Number(item.quantity) - 1) })}><Minus size={13} /></button><input aria-label={`${item.name} quantity`} type="number" min="0.001" max="1000000" step="any" value={item.quantity} onChange={event => updateLine(item.id, { quantity: event.target.value })} disabled={disabled} /><button aria-label={`Increase ${item.name} quantity`} disabled={disabled || Number(item.quantity) >= 1e6} onClick={() => updateLine(item.id, { quantity: Math.min(1e6, (Number(item.quantity) || 0) + 1) })}><Plus size={13} /></button></div><b>{money(totals.lines[index].gross)}</b></div>
            <details className="pos2-line-details"><summary>Price, tax & note</summary><div className="pos2-fields"><Field label={`Unit price (${store.currency})`} type="number" min="0" max="1000000000" step="any" value={item.price} disabled={disabled} onChange={price => updateLine(item.id, { price })} /><Field label={`${store.taxName} %`} type="number" min="0" max="100" step="any" value={item.gstRate} disabled={disabled} onChange={gstRate => updateLine(item.id, { gstRate })} /></div><Field label="Item note (optional)" value={item.note || ''} disabled={disabled} maxLength={2000} onChange={note => updateLine(item.id, { note })} /></details>
          </div>) : <div className="pos2-empty pos2-empty-bill"><ShoppingCart size={27} /><strong>Add your first item</strong><p>Choose a product or enter a quick item.</p></div>}</div>
          <details className="pos2-details"><summary>Customer details <span className="pos2-muted">{customer.name || 'Optional'}</span></summary><Field label="Customer name" value={customer.name} maxLength={200} disabled={disabled} onChange={name => setCustomer({ ...customer, name })} /><div className="pos2-fields"><Field label="Phone" type="tel" value={customer.phone} maxLength={50} disabled={disabled} onChange={phone => setCustomer({ ...customer, phone })} /><Field label="Order reference" value={customer.reference} maxLength={100} disabled={disabled} onChange={reference => setCustomer({ ...customer, reference })} /></div></details>
          <div className="pos2-fields pos2-payment"><Field label="Discount %" type="number" min="0" max="100" step="any" value={discount} disabled={disabled} onChange={setDiscount} /><FormGroup label="Payment"><select className="form-select" value={payment.method} disabled={disabled} onChange={event => setPayment({ method: event.target.value, received: '' })}>{['Not paid', 'Cash', 'Card', 'Bank transfer', 'Digital wallet', 'UPI', 'Other'].map(method => <option key={method}>{method}</option>)}</select></FormGroup></div>
          {payment.method === 'Cash' && <Field label={`Cash received (${store.currency})`} hint="Leave blank for the exact total." type="number" min="0" max="10000000000" step={1 / currencyFactor(store.currency)} placeholder={(totals.total / currencyFactor(store.currency)).toFixed(currencyDigits(store.currency))} value={payment.received} disabled={disabled} onChange={received => setPayment({ ...payment, received })} />}
          <div className="pos2-totals" aria-live="polite">
            <div><span>Subtotal</span><b>{money(totals.subtotal)}</b></div>
            {totals.discountAmount > 0 && <div><span>Discount</span><b>−{money(totals.discountAmount)}</b></div>}
            {(totals.tax > 0 || cart.some(item => Number(item.gstRate))) && <div><span>{store.taxName}{store.taxInclusive ? ' (included)' : ''}</span><b>{money(totals.tax)}</b></div>}
            <div className="pos2-total"><span>Total <small>{store.currency}</small></span><b>{money(totals.total)}</b></div>
            {cart.length > 0 && <><div><span>{paid.status}</span><b>{paid.method === 'Not paid' ? money(paid.due) + ' due' : paid.method}</b></div>{paid.change > 0 && <div><span>Change</span><b>{money(paid.change)}</b></div>}{paid.due > 0 && paid.method !== 'Not paid' && <div><span>Balance due</span><b>{money(paid.due)}</b></div>}</>}
          </div>
          {cart.length > 0 && billError && <p role="alert" className="pos2-error">{billError}</p>}
          <div className="pos2-bill-actions"><button className="btn btn-primary" disabled={disabled || !!billError} onClick={() => downloadBill()}><Download size={16} />{busy === 'PDF' ? 'Creating PDF…' : 'Download receipt'}</button><div><button className="btn btn-secondary" disabled={disabled || !!billError} onClick={() => run('Save', async () => { const bill = await persistBill(); showToast(`${bill.number} saved.`, 'success') })}><Save size={15} /> Save bill</button><button className="btn btn-secondary" disabled={disabled || !!billError} onClick={() => printBill()}><Printer size={15} /> Print</button></div></div>
          <p className={`pos2-muted pos2-draft ${draftError ? 'pos2-error' : ''}`} role={draftError ? 'alert' : undefined}>{draftError || (ready ? 'Current draft and saved bills stay on this device.' : loadError ? 'Local storage is unavailable.' : 'Opening local records…')}</p>
        </section>
      </div>
    </div>
    <Modal open={productModal} onClose={() => !busy && setProductModal(false)} title={products.some(item => item.id === editingProduct.id) ? 'Edit product' : 'Add product'} footer={<><button className="btn btn-secondary" disabled={!!busy} onClick={() => setProductModal(false)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={saveProduct}>{busy === 'Product' ? 'Saving…' : 'Save product'}</button></>}>
      <div className="pos2-modal">{productField('name', 'Product name', { autoFocus: true, maxLength: 300 })}<div className="pos2-fields">{productField('price', `Price (${editingProduct.currency || store.currency})`, { type: 'number', min: 0, max: 1e9, step: 'any' })}{productField('gstRate', `${store.taxName} %`, { type: 'number', min: 0, max: 100, step: 'any' })}</div>
        <details className="pos2-details"><summary>SKU, category & image <span className="pos2-muted">Optional</span></summary><div className="pos2-fields">{productField('sku', 'SKU / barcode', { maxLength: 100 })}{productField('category', 'Category', { maxLength: 100 })}</div>{productField('description', 'Description', { multiline: true, maxLength: 2000 })}<FormGroup label="Product image"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={!!busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''
          if (file) run('Image', async () => { if (file.size > 8 * 1024 * 1024) throw new Error('Use a PNG, JPG or WebP image under 8 MB.'); const result = await readEditorImage(file); if (result.dataUrl.length > 6000000) throw new Error('Choose a smaller image.'); setEditingProduct(current => ({ ...current, image: result.dataUrl })) })
        }} /></FormGroup>{editingProduct.image && <div className="pos2-image"><img src={editingProduct.image} alt="Product" /><button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => setEditingProduct(current => ({ ...current, image: '' }))}>Remove image</button></div>}</details>
      </div>
    </Modal>
    <Modal open={settingsOpen} onClose={() => !busy && setSettingsOpen(false)} title="Store settings" footer={<><button className="btn btn-secondary" disabled={!!busy} onClick={() => setSettingsOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={!!busy} onClick={saveStore}>Save settings</button></>}>
      <div className="pos2-modal">{storeField('name', 'Store name', { maxLength: 200, placeholder: 'Your business' })}<div className="pos2-fields">
        <FormGroup label="Country"><select className="form-select" value={storeDraft.country} disabled={!!busy} onChange={event => { const country = event.target.value; setStoreDraft(current => ({ ...current, country, taxName: countryTax(country).name, ...(!cart.length ? { currency: countryCurrency(country) } : {}) })) }}><option value="">Choose country</option>{INVOICE_COUNTRIES.map(country => <option value={country.code} key={country.code}>{country.name}</option>)}</select></FormGroup>
        <FormGroup label="Currency" hint={cart.length ? 'Start a new bill to change currency.' : undefined}><select className="form-select" value={storeDraft.currency} disabled={!!busy || !!cart.length} onChange={event => setStoreDraft(current => ({ ...current, currency: event.target.value }))}>{INVOICE_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></FormGroup>
      </div><FormGroup label="Prices"><select className="form-select" value={storeDraft.taxInclusive ? 'included' : 'excluded'} disabled={!!busy} onChange={event => setStoreDraft(current => ({ ...current, taxInclusive: event.target.value === 'included' }))}><option value="excluded">Tax added to item prices</option><option value="included">Tax already included in item prices</option></select></FormGroup>
        <details className="pos2-details"><summary>Address, contact & tax details <span className="pos2-muted">Optional</span></summary>{storeField('address', 'Address', { multiline: true, maxLength: 2000 })}{storeField('phone', 'Phone', { type: 'tel', maxLength: 50 })}<div className="pos2-fields">{storeField('taxId', countryTax(storeDraft.country).idLabel, { maxLength: 100 })}{storeField('taxName', 'Tax label', { maxLength: 40 })}</div></details>
      </div>
    </Modal>
    <Modal open={historyOpen} onClose={() => !busy && setHistoryOpen(false)} title="Saved bills" maxWidth={720}>
      <div className="pos2-modal"><input className="form-input" aria-label="Search saved bills" placeholder="Search bill number or customer" value={historyQuery} onChange={event => setHistoryQuery(event.target.value)} /><div className="pos2-history">{historyMatches.map(bill => <article key={bill.id}><div><strong>{bill.number}</strong><span>{bill.customer?.name || 'Walk-in'} · {new Date(bill.createdAt).toLocaleString()}</span><b>{formatMinor(bill.totals.total, bill.store.currency)} <small>{posPayment(bill).status}</small></b></div><div className="pos2-history-actions"><button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => copyBill(bill)}>Copy to new bill</button><button className="icon-btn" title="Print saved receipt" aria-label={`Print ${bill.number}`} disabled={!!busy} onClick={() => printBill(bill)}><Printer size={16} /></button><button className="icon-btn" title="Download saved receipt" aria-label={`Download ${bill.number}`} disabled={!!busy} onClick={() => downloadBill(bill)}><Download size={16} /></button></div></article>)}</div>{!historyMatches.length && <p className="pos2-muted">{bills.length ? 'No bills match this search.' : 'Save or download your first bill to see it here.'}</p>}</div>
    </Modal>
  </ToolPage>
}
