import { INVOICE_COUNTRIES, INVOICE_CURRENCIES, countryCurrency, countryTax, currencyFactor, formatMinor, invoiceLocale } from './invoiceLocale';

// Editor and PDF share integer minor-unit calculations, with each separately
// reported tax rounded to the selected currency's precision.
export const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'],
  ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
].map(([code, name]) => ({ code, name, ut: ['04', '26', '31', '35', '38'].includes(code) }));
export const stateForGstin = value => GST_STATES.find(state => state.code === String(value).slice(0, 2))?.name;
export const stateInfo = name => GST_STATES.find(state => state.name === name);
export const localDate = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; };
const id = () => globalThis.crypto.randomUUID();
const value = input => typeof input === 'string' ? input : '';
const amount = number => Number.isFinite(Number(number)) ? Math.max(0, Number(number)) : 0;
export const fiscalYear = date => { const [year, month] = String(date).split('-').map(Number); return month >= 4 ? year : year - 1; };

export function nextInvoiceNumber(drafts = [], date = localDate(), country = '') {
  const year = country === 'IN' ? fiscalYear(date) : Number(date.slice(0, 4));
  const prefix = country === 'IN' ? `INV-${String(year).slice(-2)}${String(year + 1).slice(-2)}-` : `INV-${year}-`;
  let next = 1;
  const used = new Set(drafts.map(draft => draft.invoiceNumber));
  for (const number of used) if (number?.startsWith(prefix) && /^\d+$/.test(number.slice(prefix.length))) next = Math.max(next, Number(number.slice(prefix.length)) + 1);
  while (used.has(`${prefix}${String(next).padStart(4, '0')}`)) next++;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

export const newInvoiceItem = (country = '') => ({ id: id(), name: '', description: '', hsn: '', qty: 1, unit: 'pcs', rate: '', discount: 0, gstRate: country === 'IN' ? 18 : 0, cessRate: 0 });
export function newGstInvoice(drafts = [], seller = {}) {
  return { schemaVersion: 2, id: id(), createdAt: Date.now(), invoiceType: 'standard', invoiceNumber: nextInvoiceNumber(drafts, localDate(), seller.country), invoiceDate: localDate(),
    dueDate: '', supplyDate: '', placeOfSupply: '', reverseCharge: false, currency: countryCurrency(seller.country), taxName: '', additionalTaxes: [], paymentTerms: '', notes: '', terms: '',
    signature: { mode: 'none', text: '', image: '', size: 100 },
    seller: { country: '', taxId: '', legalName: '', tradeName: '', gstin: '', address: '', city: '', state: '', pin: '', phone: '', email: '', website: '', pan: '', bankName: '', accountNumber: '', ifsc: '', upiId: '', bankCode: '', ...seller },
    buyer: { country: seller.country || '', taxId: '', name: '', businessName: '', gstin: '', billingAddress: '', shippingAddress: '', state: '', pin: '', phone: '', email: '' }, items: [newInvoiceItem(seller.country)] };
}

export function normalizeGstInvoice(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items) || !data.seller || !data.buyer) throw new Error('Choose invoice data exported from this tool.');
  if (!data.items.length || data.items.length > 500) throw new Error('An invoice needs between 1 and 500 items.');
  const base = newGstInvoice();
  const output = { ...base };
  for (const key of ['invoiceType', 'invoiceNumber', 'invoiceDate', 'dueDate', 'supplyDate', 'placeOfSupply', 'currency', 'taxName', 'paymentTerms', 'notes', 'terms']) output[key] = value(data[key]) || base[key];
  output.reverseCharge = data.reverseCharge === true;
  for (const party of ['seller', 'buyer']) {
    output[party] = Object.fromEntries(Object.keys(base[party]).map(key => [key, value(data[party][key])]));
    output[party].gstin = output[party].gstin.replace(/\s/g, '').toUpperCase();
    output[party].country = output[party].country.trim().toUpperCase();
    output[party].taxId = output[party].taxId.trim();
    if (!data.schemaVersion && !data[party].country) output[party].country = 'IN';
    // Preserve the previous form's data while combining duplicate name inputs.
    if (party === 'seller') output.seller.legalName ||= output.seller.tradeName;
    else output.buyer.name ||= output.buyer.businessName;
  }
  const ids = new Set();
  output.items = data.items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('One invoice item could not be read.');
    const result = newInvoiceItem();
    for (const key of ['name', 'description', 'hsn', 'unit']) if (typeof item[key] === 'string') result[key] = item[key];
    for (const key of ['qty', 'rate', 'discount', 'gstRate', 'cessRate']) if (item[key] !== undefined) {
      if (!['number', 'string'].includes(typeof item[key]) || (item[key] !== '' && !Number.isFinite(Number(item[key])))) throw new Error(`Invalid ${key} in an invoice item.`);
      result[key] = item[key];
    }
    if (typeof item.id === 'string' && item.id && !ids.has(item.id)) result.id = item.id;
    ids.add(result.id); return result;
  });
  if (typeof data.id === 'string' && data.id) output.id = data.id;
  if (typeof data.createdAt === 'number' && Number.isFinite(data.createdAt)) output.createdAt = data.createdAt;
  if (data.signature) {
    if (!['none', 'type', 'image'].includes(data.signature.mode)) throw new Error('Unsupported signature format.');
    output.signature = { mode: data.signature.mode, text: value(data.signature.text), image: value(data.signature.image), size: data.signature.size ?? 100 };
    if (!['number', 'string'].includes(typeof output.signature.size)) throw new Error('The signature size could not be read.');
    if (output.signature.image && (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(output.signature.image) || output.signature.image.length > 3_000_000)) throw new Error('The saved signature image is not supported. Upload it again.');
  }
  if (data.additionalTaxes !== undefined) {
    if (!Array.isArray(data.additionalTaxes) || data.additionalTaxes.length > 5) throw new Error('Use up to five additional taxes.');
    output.additionalTaxes = data.additionalTaxes.map(tax => {
      if (!tax || typeof tax.name !== 'string' || !['number', 'string'].includes(typeof tax.rate)) throw new Error('An additional tax could not be read.');
      return { id: id(), name: tax.name, rate: tax.rate };
    });
  }
  if (!['tax', 'bill-of-supply', 'standard'].includes(output.invoiceType) || !INVOICE_CURRENCIES.includes(output.currency)) throw new Error('Unsupported invoice type or currency.');
  if (output.seller.country !== 'IN' && output.invoiceType === 'bill-of-supply') output.invoiceType = 'standard';
  return output;
}

export const supplyState = invoice => invoice.placeOfSupply || invoice.buyer.state || invoice.seller.state;
export const isIndianInvoice = invoice => invoice.seller.country === 'IN';
export const isDomesticIndia = invoice => isIndianInvoice(invoice) && invoice.buyer.country === 'IN';
export const invoiceTaxName = invoice => isIndianInvoice(invoice) ? 'GST' : invoice.taxName.trim() || countryTax(invoice.seller.country).name;
export const partyTaxId = party => party.country === 'IN' ? party.gstin : party.taxId;
export const invoiceTitle = invoice => invoice.invoiceType === 'standard' ? 'INVOICE' : invoice.invoiceType === 'bill-of-supply' ? isIndianInvoice(invoice) ? 'BILL OF SUPPLY' : 'INVOICE' : invoiceTaxName(invoice).toUpperCase() === 'VAT' ? 'VAT INVOICE' : 'TAX INVOICE';
export function gstLine(item, invoice) {
  const gross = Math.round((amount(item.qty) * amount(item.rate) + Number.EPSILON) * currencyFactor(invoice.currency));
  const taxable = Math.round(gross * (1 - Math.min(100, amount(item.discount)) / 100));
  const rate = invoice.invoiceType === 'tax' ? Math.min(100, amount(item.gstRate)) : 0;
  const india = isIndianInvoice(invoice), intra = isDomesticIndia(invoice) && invoice.seller.state === supplyState(invoice);
  const cgst = india && intra ? Math.round(taxable * rate / 200) : 0;
  const sgst = cgst, igst = india && !intra ? Math.round(taxable * rate / 100) : 0;
  const localTax = india ? 0 : Math.round(taxable * rate / 100);
  const cess = india && invoice.invoiceType === 'tax' ? Math.round(taxable * Math.min(100, amount(item.cessRate)) / 100) : 0;
  const extras = !india && invoice.invoiceType === 'tax' ? invoice.additionalTaxes.map(tax => ({ name: tax.name, rate: amount(tax.rate), amount: Math.round(taxable * Math.min(100, amount(tax.rate)) / 100) })) : [];
  const extraTax = extras.reduce((sum, tax) => sum + tax.amount, 0);
  const tax = cgst + sgst + igst + cess + localTax + extraTax;
  const total = taxable + (invoice.invoiceType === 'tax' && invoice.reverseCharge ? 0 : tax);
  return { gross, discount: gross - taxable, taxable, cgst, sgst, igst, cess, localTax, extraTax, extras, tax, total, rate };
}
export function gstTotals(invoice) {
  return invoice.items.reduce((sum, item) => {
    const line = gstLine(item, invoice);
    for (const key of Object.keys(sum)) sum[key] += line[key];
    return sum;
  }, { gross: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, localTax: 0, extraTax: 0, tax: 0, total: 0 });
}
export const additionalTaxTotals = invoice => invoice.additionalTaxes.map((tax, index) => ({ ...tax, amount: invoice.items.reduce((sum, item) => sum + (gstLine(item, invoice).extras[index]?.amount || 0), 0) }));
export const money = (minor, currency = 'USD', country = '') => formatMinor(minor, currency, invoiceLocale({ seller: { country } }));
export const taxLabel = invoice => stateInfo(invoice.seller.state)?.ut ? 'UTGST' : 'SGST';

function validDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isFinite(parsed.getTime()) && `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}` === date;
}
export function gstInvoiceErrors(invoice, drafts = []) {
  const errors = [];
  const need = (condition, message) => { if (!condition) errors.push(message); };
  need(invoice.seller.legalName.trim() || invoice.seller.tradeName.trim(), 'Enter your business name.');
  need(invoice.seller.address.trim(), 'Enter the business address.');
  const india = isIndianInvoice(invoice), taxed = invoice.invoiceType === 'tax';
  need(INVOICE_COUNTRIES.some(country => country.code === invoice.seller.country), 'Choose your business country.');
  need(INVOICE_COUNTRIES.some(country => country.code === invoice.buyer.country), 'Choose the customer country.');
  const gstin = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  if (india && (taxed || invoice.invoiceType === 'bill-of-supply' || invoice.seller.gstin)) {
    need(gstin.test(invoice.seller.gstin), 'Enter a 15-character business GSTIN.');
    if (gstin.test(invoice.seller.gstin)) need(stateForGstin(invoice.seller.gstin) === invoice.seller.state, 'The business GSTIN and business state do not match.');
  }
  if (invoice.buyer.country === 'IN' && invoice.buyer.gstin) need(gstin.test(invoice.buyer.gstin) && stateForGstin(invoice.buyer.gstin), 'Check the customer GSTIN, or leave it blank for an unregistered customer.');
  if (isDomesticIndia(invoice) && taxed) need(stateInfo(supplyState(invoice)), 'Choose the Indian place of supply.');
  for (const [name, party] of [['Business', invoice.seller], ['Customer', invoice.buyer]]) {
    const taxId = partyTaxId(party);
    if (party.country !== 'IN' && taxId) need(taxId.length <= 64 && !/[\x00-\x1f]/.test(taxId), `${name} tax ID is not valid.`);
    if (party.email) need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(party.email), `Check the ${name.toLowerCase()} email address.`);
    if (party.country === 'IN' && party.pin) need(/^\d{6}$/.test(party.pin), `Check the ${name.toLowerCase()} six-digit PIN code.`);
  }
  if (taxed && !india && !['US', ''].includes(invoice.seller.country) && countryTax(invoice.seller.country).name !== 'Tax') need(invoice.seller.taxId.trim(), `Enter the business ${countryTax(invoice.seller.country).idLabel}, or choose an invoice without tax.`);
  if (taxed && invoice.seller.country === 'GB' && invoice.seller.taxId) need(/^(?:(?:GB|XI)?\d{9}(?:\d{3})?|(?:GB)?(?:GD|HA)\d{3})$/i.test(invoice.seller.taxId.replace(/[\s-]/g, '')), 'Check the business VAT registration number.');
  if (taxed && invoice.seller.country === 'AU') need(/^\d{11}$/.test(invoice.seller.taxId.replace(/\s/g, '')), 'Enter the business 11-digit ABN.');
  if (taxed && invoice.seller.country === 'NZ') need(/^\d{8,9}$/.test(invoice.seller.taxId.replace(/[\s-]/g, '')), 'Enter the business GST number (8 or 9 digits).');
  const gstDocument = india && invoice.invoiceType !== 'standard';
  need(gstDocument ? /^[A-Za-z0-9/-]{1,16}$/.test(invoice.invoiceNumber) : invoice.invoiceNumber.trim().length > 0 && invoice.invoiceNumber.length <= 40 && !/[\x00-\x1f]/.test(invoice.invoiceNumber), gstDocument ? 'Invoice number: use up to 16 letters, numbers, slashes or hyphens for GST documents.' : 'Enter an invoice number (up to 40 characters).');
  need(validDate(invoice.invoiceDate), 'Choose a valid invoice date.');
  if (invoice.dueDate) need(validDate(invoice.dueDate) && invoice.dueDate >= invoice.invoiceDate, 'The due date must be on or after the invoice date.');
  if (invoice.supplyDate) need(validDate(invoice.supplyDate), 'Choose a valid supply date.');
  const identity = party => `${party.country || 'IN'}:${(partyTaxId({ ...party, country: party.country || 'IN' }) || party.legalName || party.tradeName || '').replace(/\s/g, '').toUpperCase()}`;
  need(!drafts.some(draft => draft.id !== invoice.id && draft.invoiceNumber === invoice.invoiceNumber && identity(draft.seller || {}) === identity(invoice.seller) && (!india || fiscalYear(draft.invoiceDate) === fiscalYear(invoice.invoiceDate))), 'This invoice number already exists for this business.');
  const totals = gstTotals(invoice);
  if (!india || partyTaxId(invoice.buyer) || invoice.currency !== 'INR' || totals.total >= 5_000_000) {
    need(invoice.buyer.name.trim() || invoice.buyer.businessName.trim(), 'Enter the customer name.');
    need(invoice.buyer.billingAddress.trim(), 'Enter the customer billing address.');
  }
  need(invoice.items.length > 0 && invoice.items.length <= 500, 'Add between 1 and 500 items.');
  invoice.items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    need(item.name.trim(), `${label}: enter an item or service name.`);
    need(item.qty !== '' && Number.isFinite(Number(item.qty)) && Number(item.qty) > 0 && Number(item.qty) <= 1_000_000, `${label}: enter a quantity greater than zero (up to 1,000,000).`);
    need(item.rate !== '' && Number.isFinite(Number(item.rate)) && Number(item.rate) >= 0 && Number(item.rate) <= 100_000_000, `${label}: enter a valid non-negative unit price (up to 100,000,000).`);
    for (const [field, name] of [['discount', 'discount'], ...(taxed ? [['gstRate', `${invoiceTaxName(invoice)} rate`], ...(india ? [['cessRate', 'cess rate']] : [])] : [])]) {
      need(item[field] !== '' && Number.isFinite(Number(item[field])) && Number(item[field]) >= 0 && Number(item[field]) <= 100, `${label}: ${name} must be between 0 and 100.`);
    }
    if (item.hsn && india) need(/^\d{4,8}$/.test(item.hsn), `${label}: HSN/SAC must contain 4 to 8 digits.`);
  });
  if (!india && taxed) for (const tax of invoice.additionalTaxes) {
    need(tax.name.trim() && tax.name.length <= 30, 'Name each additional tax (up to 30 characters).');
    need(tax.rate !== '' && Number.isFinite(Number(tax.rate)) && Number(tax.rate) >= 0 && Number(tax.rate) <= 100, 'Additional tax rates must be between 0 and 100.');
  }
  need(invoice.taxName.length <= 24, 'Keep the tax name within 24 characters.');
  if (invoice.signature.mode === 'type') need(invoice.signature.text.trim() && invoice.signature.text.length <= 100, 'Enter a signature name (up to 100 characters), or choose no signature.');
  const signatureSize = invoice.signature.size ?? 100;
  if (invoice.signature.mode === 'type') need(signatureSize !== '' && Number.isFinite(Number(signatureSize)) && Number(signatureSize) >= 20 && Number(signatureSize) <= 200, 'Signature size must be between 20% and 200%.');
  if (invoice.signature.mode === 'image') need(/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(invoice.signature.image) && invoice.signature.image.length <= 3_000_000, 'Upload a signature image, or choose no signature.');
  need(Object.values(totals).every(Number.isSafeInteger) && totals.gross <= 100_000_000_000_000 && totals.total <= 100_000_000_000_000, 'This invoice amount is too large to calculate safely.');
  return errors;
}
