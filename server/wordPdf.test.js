import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { convertWordDocument, createWordPdfHandler, exportOfficePdf } from './wordPdf'

const pdf = Buffer.from('%PDF-1.7\nfixture')
const fixture = async () => { const zip = new JSZip(); zip.file('word/document.xml', '<document/>'); return zip.generateAsync({ type: 'nodebuffer' }) }
const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value }, end(value) { this.body = value } })

describe('native Word conversion', () => {
  it('exports the original DOCX bytes without HTML reconstruction and deletes temporary files', async () => {
    const input = await fixture()
    let temporary
    const result = await convertWordDocument(input, { exporter: async (path, directory) => {
      temporary = directory
      expect(await readFile(path)).toEqual(input)
      return pdf
    } })
    expect(result).toEqual(pdf)
    await expect(access(temporary)).rejects.toThrow()
  })
  it('cleans temporary files after an Office failure', async () => {
    let temporary
    await expect(convertWordDocument(await fixture(), { exporter: async (_path, directory) => { temporary = directory; throw new Error('Office failed') } })).rejects.toThrow('Office failed')
    await expect(access(temporary)).rejects.toThrow()
  })
  it('rejects malformed input before starting Office', async () => {
    await expect(convertWordDocument(Buffer.from('not a DOCX'))).rejects.toMatchObject({ status: 400 })
    const zip = new JSZip(); zip.file('other.xml', 'content')
    await expect(convertWordDocument(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toMatchObject({ status: 400 })
  })
  it.each(['win32', 'linux'])('uses the native %s engine with separate arguments and a bounded hidden process', async platform => {
    const directory = await mkdtemp(join(tmpdir(), 'office-test-'))
    try {
      const run = vi.fn(async () => { await writeFile(join(directory, 'document.pdf'), pdf) })
      expect(await exportOfficePdf(join(directory, 'document.docx'), directory, { platform, run, env: {} })).toEqual(pdf)
      const [binary, args, options] = run.mock.calls[0]
      expect(options).toMatchObject({ timeout: 120000, windowsHide: true })
      expect(options.shell).toBeUndefined()
      if (platform === 'win32') { expect(binary).toBe('powershell.exe'); expect(args).toContain('-File'); expect(args).toContain('-InputPath') }
      else { expect(binary).toBe('soffice'); expect(args).toContain('pdf:writer_pdf_Export'); expect(args.some(arg => arg.startsWith('-env:UserInstallation=file:'))).toBe(true) }
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
  it('returns a PDF response and disables caching', async () => {
    const request = Readable.from([await fixture()]); request.method = 'POST'; request.headers = {}
    const res = response()
    await createWordPdfHandler({ convert: async () => pdf })(request, res)
    expect(res.statusCode).toBe(200)
    expect(res.headers).toMatchObject({ 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' })
    expect(res.body).toEqual(pdf)
  })
  it('streams server stages before sending the original binary PDF', async () => {
    const request = Readable.from([await fixture()]); request.method = 'POST'; request.headers = { accept: 'application/vnd.createpdf.word-stream' }
    const res = response()
    const chunks = []
    res.write = data => chunks.push(data)
    await createWordPdfHandler({ convert: async (_bytes, progress) => { progress('Converting document'); return pdf } })(request, res)
    expect(res.headers['Content-Type']).toBe('application/vnd.createpdf.word-stream')
    const events = chunks.map(chunk => JSON.parse(chunk))
    expect(events).toContainEqual({ type: 'progress', label: 'Converting document' })
    expect(events.at(-1)).toEqual({ type: 'pdf', length: pdf.length })
    expect(res.body).toEqual(pdf)
  })
  it('sends a structured streaming error after headers have been sent', async () => {
    const request = Readable.from([await fixture()]); request.method = 'POST'; request.headers = { accept: 'application/vnd.createpdf.word-stream' }
    const res = response()
    const chunks = []
    res.write = data => chunks.push(JSON.parse(data))
    await createWordPdfHandler({ convert: async () => { throw Object.assign(new Error('Invalid document'), { status: 400 }) } })(request, res)
    expect(chunks.at(-1)).toEqual({ type: 'error', error: 'Invalid document' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toBeUndefined()
  })
  it('reports conversion failures without returning an invalid PDF', async () => {
    const request = Readable.from([await fixture()]); request.method = 'POST'; request.headers = {}
    const res = response()
    await createWordPdfHandler({ convert: async () => { throw new Error('ENOENT') } })(request, res)
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).error).toContain('could not process this document')
  })
  it('rejects oversized uploads and unsupported methods', async () => {
    for (const [method, headers, status] of [['GET', {}, 405], ['POST', { 'content-length': 40 * 1024 * 1024 }, 413]]) {
      const request = Readable.from([]); request.method = method; request.headers = headers
      const res = response()
      await createWordPdfHandler()(request, res)
      expect(res.statusCode).toBe(status)
    }
  })
})
