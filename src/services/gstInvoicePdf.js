import { getPdfLib } from './pdfEngine';
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from './unicodePdf';
import { additionalTaxTotals, gstInvoiceErrors, gstLine, gstTotals, invoiceTaxName, invoiceTitle, isDomesticIndia, isIndianInvoice, partyTaxId, stateInfo, supplyState, taxLabel } from './gstInvoice';
import { countryName, countryTax, currencyDigits, currencyFactor, invoiceLocale } from './invoiceLocale';
import { createTypedSignature } from './pdfSigning';

export async function createGstInvoicePdf(invoice) {
  const errors = gstInvoiceErrors(invoice);
  if (errors.length) throw new Error(errors[0]);
  const { PDFDocument, StandardFonts, rgb } = await getPdfLib();
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${invoiceTitle(invoice)} ${invoice.invoiceNumber}`);
  pdf.setAuthor(invoice.seller.legalName || invoice.seller.tradeName); pdf.setCreator('CreatePDF.si');
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  // Embed supported text as text. Other scripts use browser-shaped text images
  // rather than replacing international names with question marks.
  const allText = [invoice.invoiceNumber, invoice.notes, invoice.terms, invoice.paymentTerms,
    ...Object.values(invoice.seller), ...Object.values(invoice.buyer),
    invoice.taxName, ...invoice.additionalTaxes.map(tax => tax.name),
    ...invoice.items.flatMap(item => [item.name, item.description, item.unit, item.hsn])].filter(text => typeof text === 'string').join(' ');
  const scripts = [[/[\u0900-\u097f\u20b9]/, 'devanagari'], [/[\u0980-\u09ff]/, 'bengali'], [/[\u0a80-\u0aff]/, 'gujarati'], [/[\u0b80-\u0bff]/, 'tamil'], [/[\u0c00-\u0c7f]/, 'telugu'], [/[\u0c80-\u0cff]/, 'kannada']];
  const fonts = { ...(scripts.some(([pattern]) => pattern.test(allText)) ? await embedUnicodeFonts(pdf) : {}), baseBold: bold };
  const characterSets = new Map();
  const coverage = new Map();
  const usePdfText = value => Array.from(String(value)).every(character => {
    if (coverage.has(character)) return coverage.get(character);
    let supported = true;
    const script = scripts.find(([pattern]) => pattern.test(character));
    if (script) {
      const name = script[1], font = fonts.scripts?.[name]?.regular;
      if (!characterSets.has(name)) characterSets.set(name, new Set(font?.getCharacterSet() || []));
      supported = characterSets.get(name).has(character.codePointAt(0));
    } else {
      try { regular.encodeText(character); } catch { supported = false; }
    }
    coverage.set(character, supported); return supported;
  });
  await document.fonts.ready;
  const browserCanvas = document.createElement('canvas'), browserContext = browserCanvas.getContext('2d');
  const textImages = [];
  const browserFont = (size, strong) => `${strong ? 'bold ' : ''}${size}px Arial, sans-serif`;
  const ink = rgb(.12, .17, .19), muted = rgb(.38, .44, .45), accent = rgb(.18, .43, .37), pale = rgb(.94, .97, .96), border = rgb(.82, .86, .84);
  const width = 595.28, height = 841.89, margin = 42, contentWidth = width - margin * 2;
  const india = isIndianInvoice(invoice), intra = isDomesticIndia(invoice) && invoice.seller.state === supplyState(invoice), taxed = invoice.invoiceType === 'tax';
  const documentTitle = invoiceTitle(invoice), digits = currencyDigits(invoice.currency), factor = currencyFactor(invoice.currency), locale = invoiceLocale(invoice);
  const numeric = minor => (minor / factor).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const currency = minor => `${invoice.currency} ${numeric(minor)}`;
  let page, y;
  const measure = (value, size = 9, strong = false) => {
    if (usePdfText(value)) return measureUnicodeText(value, strong ? bold : regular, size, fonts);
    browserContext.font = browserFont(size, strong); return browserContext.measureText(value).width;
  };
  const lineAdvance = (value, size, strong = false) => {
    if (usePdfText(value)) return size + 5;
    browserContext.font = browserFont(size, strong);
    const metrics = browserContext.measureText(value);
    return Math.max(size + 5, (metrics.actualBoundingBoxAscent || size) + (metrics.actualBoundingBoxDescent || size * .25) + 4);
  };
  const text = (value, x, top, size = 9, strong = false, color = ink) => {
    const string = String(value ?? '').replace(/[\r\n\t]/g, ' ');
    if (usePdfText(string)) return drawUnicodeText(page, string, { x, y: top, size, font: strong ? bold : regular, color }, fonts);
    textImages.push({ page, string, x, top, size, strong, color });
  };
  const right = (value, end, top, size = 9, strong = false) => text(value, end - measure(value, size, strong), top, size, strong);
  const rule = () => page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .6, color: border });
  const newPage = (continued = true) => {
    page = pdf.addPage([width, height]); y = height - 45;
    const titleSize = continued ? 12 : 20;
    const fittedSize = Math.min(titleSize, titleSize * contentWidth / Math.max(1, measure(documentTitle, titleSize, true)));
    text(documentTitle, margin, y, fittedSize, true, accent);
    y -= fittedSize + 8;
    for (const line of wrap(`${invoice.invoiceNumber}${continued ? ' / continued' : ''}`, contentWidth, 10, true)) { text(line, margin, y, 10, true); y -= 14; }
    y -= 8;
  };
  const ensure = (needed = 16) => { if (y - needed < 48) newPage(); };
  const wrap = (value, maxWidth, size = 9, strong = false) => {
    const lines = [];
    for (const paragraph of String(value || '').split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.trim().split(/\s+/u).filter(Boolean)) {
        if (line && measure(`${line} ${word}`, size, strong) > maxWidth) { lines.push(line); line = ''; }
        if (measure(word, size, strong) > maxWidth) {
          const segments = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), item => item.segment) : Array.from(word);
          for (const segment of segments) {
            if (line && measure(line + segment, size, strong) > maxWidth) { lines.push(line); line = ''; }
            line += segment;
          }
        } else line += `${line ? ' ' : ''}${word}`;
      }
      lines.push(line);
    }
    return lines;
  };
  const flow = (value, { size = 9, strong = false, color = ink, maxWidth = contentWidth } = {}) => {
    for (const line of wrap(value, maxWidth, size, strong)) { const advance = lineAdvance(line, size, strong); ensure(advance + 1); text(line, margin, y, size, strong, color); y -= advance; }
  };
  const section = title => { ensure(36); y -= 12; text(title, margin, y, 9, true, accent); y -= 18; };
  const state = (name, country = 'IN') => { const info = country === 'IN' && stateInfo(name); return info ? `${info.name} (${info.code})` : name; };
  newPage(false);
  flow(invoice.seller.legalName || invoice.seller.tradeName, { size: 13, strong: true });
  if (invoice.seller.tradeName && invoice.seller.legalName && invoice.seller.tradeName !== invoice.seller.legalName) flow(invoice.seller.tradeName, { color: muted });
  flow([invoice.seller.address, invoice.seller.city, state(invoice.seller.state, invoice.seller.country), invoice.seller.pin, countryName(invoice.seller.country)].filter(Boolean).join(', '));
  if (partyTaxId(invoice.seller)) flow(`${countryTax(invoice.seller.country).idLabel}: ${partyTaxId(invoice.seller)}`, { strong: true });
  const contact = [invoice.seller.phone, invoice.seller.email, invoice.seller.website].filter(Boolean).join(' | ');
  if (contact) flow(contact, { size: 8, color: muted });
  y -= 5; ensure(55); rule(); y -= 18;
  flow(`Invoice date: ${invoice.invoiceDate}${invoice.dueDate ? `     Due: ${invoice.dueDate}` : ''}`);
  if (invoice.supplyDate) flow(`Supply date: ${invoice.supplyDate}`);
  if (india && taxed) flow(`Place of supply: ${isDomesticIndia(invoice) ? state(supplyState(invoice)) : countryName(invoice.buyer.country)}`);
  if (taxed && (india || invoice.reverseCharge)) flow(`Reverse charge: ${invoice.reverseCharge ? 'Yes - tax payable by recipient' : 'No'}`, { size: 8, color: muted });
  section('BILL TO');
  flow(invoice.buyer.name || invoice.buyer.businessName || 'Unregistered customer', { strong: true });
  if (invoice.buyer.businessName && invoice.buyer.name !== invoice.buyer.businessName) flow(invoice.buyer.businessName);
  if (invoice.buyer.billingAddress) flow(invoice.buyer.billingAddress);
  flow([state(invoice.buyer.state, invoice.buyer.country), invoice.buyer.pin, countryName(invoice.buyer.country)].filter(Boolean).join(' - '));
  if (partyTaxId(invoice.buyer)) flow(`${countryTax(invoice.buyer.country).idLabel}: ${partyTaxId(invoice.buyer)}`);
  if (invoice.buyer.phone || invoice.buyer.email) flow([invoice.buyer.phone, invoice.buyer.email].filter(Boolean).join(' | '), { size: 8, color: muted });
  if (invoice.buyer.shippingAddress && invoice.buyer.shippingAddress !== invoice.buyer.billingAddress) { section('DELIVERY ADDRESS'); flow(invoice.buyer.shippingAddress); }
  y -= 16;

  const columns = [42, 64, 254, 306, 344, 414, 459], ends = [60, 250, 302, 340, 410, 455, width - margin];
  const tableHeader = () => {
    ensure(43);
    page.drawRectangle({ x: margin, y: y - 7, width: contentWidth, height: 23, color: pale });
    ['#', 'Item / service', india ? 'HSN/SAC' : 'Item code', 'Qty', 'Rate', taxed ? 'Tax %' : '', `Amount (${invoice.currency})`].forEach((title, index) => {
      if (index >= 3) right(title, ends[index] - 3, y, 7.3, true);
      else text(title, columns[index] + 2, y, 7.3, true);
    });
    y -= 24;
  };
  const rowSpace = (needed = 17) => { if (y - needed < 48) { newPage(); tableHeader(); } };
  const cell = (value, index, strong = false) => {
    let size = 8;
    while (size > 5 && measure(String(value), size, strong) > ends[index] - columns[index] - 5) size -= .25;
    if (measure(String(value), size, strong) > ends[index] - columns[index] - 5) throw new Error('An item value is too wide for the PDF. Reduce its length or amount.');
    if (index >= 3) right(String(value), ends[index] - 3, y, size, strong);
    else text(value, columns[index] + 2, y, size, strong);
  };
  tableHeader();
  invoice.items.forEach((item, index) => {
    const line = gstLine(item, invoice);
    const nameLines = wrap(item.name, 182, 9, true), codeLines = wrap(item.hsn, ends[2] - columns[2] - 5, 8), description = item.description ? wrap(item.description, 182, 8) : [];
    let advance = Math.max(lineAdvance(nameLines[0], 9, true), lineAdvance(codeLines[0], 8));
    rowSpace(advance); cell(index + 1, 0); text(nameLines[0], columns[1] + 2, y, 9, true);
    cell(codeLines[0], 2); cell(item.qty, 3); cell(Number(item.rate).toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: 20 }), 4);
    if (invoice.invoiceType === 'tax') cell(`${line.rate}%`, 5);
    cell(numeric(line.total), 6, true); y -= advance;
    for (let part = 1; part < Math.max(nameLines.length, codeLines.length); part++) {
      advance = Math.max(lineAdvance(nameLines[part] || '', 9, true), lineAdvance(codeLines[part] || '', 8)); rowSpace(advance);
      if (nameLines[part]) text(nameLines[part], columns[1] + 2, y, 9, true);
      if (codeLines[part]) text(codeLines[part], columns[2] + 2, y, 8);
      y -= advance;
    }
    for (const value of description) { advance = lineAdvance(value, 8); rowSpace(advance); text(value, columns[1] + 2, y, 8, false, muted); y -= advance; }
    const detail = [item.unit ? `Unit: ${item.unit}` : '', Number(item.discount) ? `Discount: ${item.discount}% (${currency(line.discount)})` : '', `${taxed ? 'Taxable' : 'Net'}: ${currency(line.taxable)}`,
      ...(taxed ? !india ? [`${invoiceTaxName(invoice)}: ${currency(line.localTax)}`] : !intra ? [`IGST: ${currency(line.igst)}`] : [`CGST: ${currency(line.cgst)}`, `${taxLabel(invoice)}: ${currency(line.sgst)}`] : []),
      ...(line.cess ? [`Cess ${item.cessRate}%: ${currency(line.cess)}`] : []), ...line.extras.map(tax => `${tax.name} ${tax.rate}%: ${currency(tax.amount)}`)].filter(Boolean).join(' | ');
    for (const value of wrap(detail, contentWidth - 24, 7)) { advance = lineAdvance(value, 7); rowSpace(advance); text(value, columns[1] + 2, y, 7, false, muted); y -= advance; }
    rowSpace(); y -= 3; rule(); y -= 15;
  });
  ensure(175); y -= 4;
  const totals = gstTotals(invoice);
  const totalRow = (label, amount, strong = false) => {
    const lines = wrap(label, 270, strong ? 12 : 9, strong);
    ensure(lines.length * 17);
    lines.forEach((value, index) => { text(value, margin + 12, y, strong ? 12 : 9, strong); if (!index) right(currency(amount), width - margin - 8, y, strong ? 12 : 9, strong); y -= 17; });
  };
  totalRow('Subtotal', totals.gross);
  if (totals.discount) totalRow('Discount', -totals.discount);
  if (totals.discount) totalRow(taxed ? 'Taxable amount' : 'Net amount', totals.taxable);
  if (invoice.invoiceType === 'tax') {
    if (!india) { totalRow(invoiceTaxName(invoice), totals.localTax); for (const tax of additionalTaxTotals(invoice)) totalRow(`${tax.name} (${tax.rate}%)`, tax.amount); }
    else if (intra) { totalRow('CGST', totals.cgst); totalRow(taxLabel(invoice), totals.sgst); }
    else totalRow('IGST', totals.igst);
    if (totals.cess) totalRow('Cess', totals.cess);
  }
  y -= 6; rule(); y -= 21;
  totalRow(invoice.reverseCharge && invoice.invoiceType === 'tax' ? 'Amount due (excluding reverse-charge tax)' : 'Total amount due', totals.total, true);
  if (invoice.reverseCharge && invoice.invoiceType === 'tax') flow(`Tax payable by recipient: ${currency(totals.tax)}`, { size: 8, color: muted });
  if (invoice.seller.bankName || invoice.seller.accountNumber || (!india && invoice.seller.bankCode) || (india && (invoice.seller.ifsc || invoice.seller.upiId))) {
    section('PAYMENT DETAILS');
    if (invoice.seller.bankName) flow(invoice.seller.bankName);
    if (invoice.seller.accountNumber) flow(`Account: ${invoice.seller.accountNumber}`);
    if (india && invoice.seller.ifsc) flow(`IFSC: ${invoice.seller.ifsc}`);
    if (india && invoice.seller.upiId) flow(`UPI: ${invoice.seller.upiId}`);
    if (!india && invoice.seller.bankCode) flow(`Bank / routing / SWIFT code: ${invoice.seller.bankCode}`);
  }
  for (const [title, value] of [['PAYMENT TERMS', invoice.paymentTerms], ['NOTES', invoice.notes], ['TERMS', invoice.terms]]) if (value) { section(title); flow(value, { size: 9 }); }
  if (invoice.signature.mode !== 'none') {
    const signature = invoice.signature.mode === 'type' ? createTypedSignature(invoice.signature.text) : { dataUrl: invoice.signature.image };
    if (!signature?.dataUrl) throw new Error('The signature could not be created. Enter a name or upload another image.');
    const image = await pdf.embedPng(signature.dataUrl);
    const size = invoice.signature.mode === 'type' ? Number(invoice.signature.size ?? 100) / 100 : 1;
    const scale = Math.min(180 * size / image.width, 65 * size / image.height), imageWidth = image.width * scale, imageHeight = image.height * scale;
    ensure(imageHeight + 45); y -= 10;
    page.drawImage(image, { x: width - margin - imageWidth, y: y - imageHeight, width: imageWidth, height: imageHeight });
    y -= imageHeight + 16;
    right('Authorised signature', width - margin, y, 9);
  }
  for (const entry of textImages) {
    const { string, size, strong, color } = entry;
    browserContext.font = browserFont(size, strong);
    const metrics = browserContext.measureText(string), ascent = Math.max(metrics.actualBoundingBoxAscent || size, size), descent = Math.max(metrics.actualBoundingBoxDescent || size * .25, size * .25);
    const left = Math.max(0, metrics.actualBoundingBoxLeft || 0), right = Math.max(metrics.width, metrics.actualBoundingBoxRight || 0);
    const renderWidth = Math.ceil(left + right + 4), renderHeight = Math.ceil(ascent + descent + 4), scale = Math.min(3, 8192 / Math.max(renderWidth, renderHeight));
    browserCanvas.width = Math.max(1, Math.ceil(renderWidth * scale)); browserCanvas.height = Math.max(1, Math.ceil(renderHeight * scale));
    browserContext.scale(scale, scale); browserContext.font = browserFont(size, strong); browserContext.textBaseline = 'alphabetic';
    browserContext.fillStyle = `rgb(${Math.round(color.red * 255)},${Math.round(color.green * 255)},${Math.round(color.blue * 255)})`;
    browserContext.fillText(string, left + 2, ascent + 2);
    const image = await pdf.embedPng(browserCanvas.toDataURL('image/png'));
    entry.page.drawImage(image, { x: entry.x - left - 2, y: entry.top - (renderHeight - ascent - 2), width: renderWidth, height: renderHeight });
  }
  browserCanvas.width = browserCanvas.height = 0;
  pdf.getPages().forEach((output, index) => output.drawText(`Page ${index + 1} of ${pdf.getPageCount()}`, { x: margin, y: 23, size: 8, font: regular, color: muted }));
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
