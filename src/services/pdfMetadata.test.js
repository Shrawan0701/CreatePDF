import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { emptyPdfMetadata, readPdfMetadata, updatePdfMetadata } from './pdfMetadata'

async function sourcePdf(keywords = ['sales', 'report']) {
  const document = await PDFDocument.create({ updateMetadata: false })
  document.addPage([400, 600])
  document.setTitle('Original title')
  document.setAuthor('Original author')
  document.setSubject('Original subject')
  if (keywords) document.setKeywords(keywords)
  document.setProducer('Original PDF Producer')
  document.setCreator('Original Creator')
  document.setCreationDate(new Date('2020-01-02T03:04:05Z'))
  return document.save()
}

describe('PDF metadata editing', () => {
  it('reads existing keywords as a string without replacing the producer', async () => {
    expect(await readPdfMetadata(await sourcePdf())).toEqual({ title: 'Original title', author: 'Original author', subject: 'Original subject', keywords: 'sales report', producer: 'Original PDF Producer' })
  })
  it('loads PDFs without keywords and creates independent blank form values', async () => {
    expect((await readPdfMetadata(await sourcePdf(null))).keywords).toBe('')
    const first = emptyPdfMetadata()
    first.title = 'Edited'
    expect(emptyPdfMetadata().title).toBe('')
  })
  it('round-trips every edited field, Unicode, commas, and spacing', async () => {
    const source = await sourcePdf()
    const original = source.slice()
    const metadata = { title: 'वार्षिक अहवाल — Café', author: 'Shrawan Wandhekar', subject: 'Sales report', keywords: 'hotel analytics, sales,  monthly report', producer: 'My PDF application' }
    const output = await updatePdfMetadata(source, metadata)
    const bytes = new Uint8Array(await output.arrayBuffer())
    expect(await readPdfMetadata(bytes)).toEqual(metadata)
    expect(source).toEqual(original)
    const document = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(document.getPages()[0].getSize()).toEqual({ width: 400, height: 600 })
    expect(document.getCreator()).toBe('Original Creator')
    expect(document.getCreationDate().toISOString()).toBe('2020-01-02T03:04:05.000Z')
    expect(document.getModificationDate().getFullYear()).toBe(new Date().getFullYear())
  })
  it('allows fields to be cleared without adding producer branding', async () => {
    const blob = await updatePdfMetadata(await sourcePdf(), emptyPdfMetadata())
    expect(await readPdfMetadata(await blob.arrayBuffer())).toEqual(emptyPdfMetadata())
  })
  it('rejects unreadable PDFs so the interface can show a useful error', async () => {
    await expect(readPdfMetadata(new Uint8Array([0, 1, 2]))).rejects.toThrow()
  })
})
