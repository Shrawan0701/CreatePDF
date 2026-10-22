import { getPdfLib, withPdfDocument } from './pdfEngine';
import { normalizeGstInvoice } from './gstInvoice';

const dataFilename = 'CreatePDF-invoice-data.json';
const maxDataBytes = 5 * 1024 * 1024;

// A regular, readable PDF with its editable invoice model embedded as a standard
// attachment. This preserves exact amounts, country settings and signatures.
export async function exportEditableInvoicePdf(blob, invoice) {
  const model = normalizeGstInvoice(invoice);
  const bytes = new TextEncoder().encode(JSON.stringify({ format: 'createpdf-invoice', version: 1, invoice: model }));
  if (bytes.byteLength > maxDataBytes) throw new Error('The editable invoice data is too large to export. Reduce long descriptions or the signature image.');
  const { PDFDocument } = await getPdfLib();
  const pdf = await PDFDocument.load(await blob.arrayBuffer());
  await pdf.attach(bytes, dataFilename, { mimeType: 'application/json', description: 'Editable invoice details for reopening in CreatePDF.tech' });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

export async function importEditableInvoicePdf(file) {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Choose an invoice PDF.');
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Choose an invoice PDF up to 20 MB.');
  try {
    return await withPdfDocument(file, async pdf => {
      const attachments = await pdf.getAttachments();
      const entries = attachments instanceof Map ? [...attachments.entries()] : Object.entries(attachments || {});
      const entry = entries.find(([key, item]) => key === dataFilename || item.filename === dataFilename);
      if (!entry) throw new Error('This PDF has no editable invoice details. Use a PDF saved with Export editable PDF in this generator.');
      const bytes = entry[1].content ?? await pdf.getAttachmentContent(entry[0]);
      if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > maxDataBytes) throw new Error('The PDF contains invalid or oversized invoice details.');
      let data;
      try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new Error('The editable invoice details in this PDF could not be read.'); }
      if (data?.format !== 'createpdf-invoice' || data.version !== 1) throw new Error('This PDF uses an unsupported invoice data format.');
      return normalizeGstInvoice(data.invoice);
    }, { isEvalSupported: false, stopAtErrors: true });
  } catch (error) {
    if (error.name === 'PasswordException') throw new Error('Remove the opening password before importing this invoice PDF.');
    throw error;
  }
}
