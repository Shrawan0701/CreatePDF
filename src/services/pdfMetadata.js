import { getPdfLib } from './pdfEngine'

export const emptyPdfMetadata = () => ({ title: '', author: '', subject: '', keywords: '', producer: '' })

export async function readPdfMetadata(bytes) {
  const { PDFDocument } = await getPdfLib()
  // Loading a document must not replace its producer or original dates.
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  return {
    title: document.getTitle() || '',
    author: document.getAuthor() || '',
    subject: document.getSubject() || '',
    // pdf-lib returns a string, including when the PDF has multiple keywords.
    keywords: document.getKeywords() || '',
    producer: document.getProducer() || '',
  }
}

export async function updatePdfMetadata(bytes, metadata) {
  const { PDFDocument } = await getPdfLib()
  const document = await PDFDocument.load(bytes, { updateMetadata: false })
  document.setTitle(metadata.title)
  document.setAuthor(metadata.author)
  document.setSubject(metadata.subject)
  // Store the editable string intact: splitting and rejoining changes commas
  // and spacing in existing metadata on every save/re-upload cycle.
  document.setKeywords([metadata.keywords])
  document.setProducer(metadata.producer)
  document.setModificationDate(new Date())
  return new Blob([await document.save()], { type: 'application/pdf' })
}
