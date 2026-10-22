import { afterEach, describe, expect, it, vi } from 'vitest'
import { wordToPdf, powerpointToPdf } from './wordImport'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('mobile Word conversion client', () => {
 it('uploads presentations to their own endpoint and reads streamed progress', async () => {
  const file = new Blob(['PPTX'])
  const pdf = '%PDF-1.7\nfixture'
  const progress = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`${JSON.stringify({ type: 'progress', label: 'Rendering slides' })}\n${JSON.stringify({ type: 'pdf', length: pdf.length })}\n${pdf}`, { headers: { 'Content-Type': 'application/vnd.createpdf.powerpoint-stream' } })))
  expect(await (await powerpointToPdf(file, progress)).text()).toBe(pdf)
  expect(fetch).toHaveBeenCalledWith('/api/powerpoint-to-pdf', expect.objectContaining({ body: file, headers: {
   'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
   Accept: 'application/vnd.createpdf.powerpoint-stream, application/pdf',
  } }))
  expect(progress).toHaveBeenCalledWith(60, 'Rendering slides')
 })
 it('reads real status events and a PDF split across arbitrary network chunks', async () => {
  const pdf = new TextEncoder().encode('%PDF-1.7\nfixture')
  const header = new TextEncoder().encode(`${JSON.stringify({ type: 'progress', label: 'Converting document' })}\n${JSON.stringify({ type: 'pdf', length: pdf.length })}\n`)
  const bytes = new Uint8Array(header.length + pdf.length)
  bytes.set(header); bytes.set(pdf, header.length)
  const progress = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
   for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3))
   controller.close()
  } }), { headers: { 'Content-Type': 'application/vnd.createpdf.word-stream' } })))
  expect(await (await wordToPdf(new Blob(), progress)).text()).toBe('%PDF-1.7\nfixture')
  expect(progress).toHaveBeenCalledWith(60, 'Converting document')
  expect(progress).toHaveBeenLastCalledWith(100, 'PDF ready')
  expect(progress.mock.calls.some(([value]) => value > 0 && value < 100)).toBe(true)
  const percentages = progress.mock.calls.map(([value]) => value)
  expect(percentages.every(value => Number.isFinite(value) && value >= 0 && value <= 100)).toBe(true)
  expect(percentages).toEqual([...percentages].sort((a, b) => a - b))
 })
 it('keeps stage percentages moving forward even when status labels arrive late', async () => {
  const progress = vi.fn(), pdf = '%PDF-1.7\nfixture'
  const events = ['Upload complete. Waiting for conversion slot', 'Preparing document', 'Starting conversion engine', 'Converting document', 'Preparing document'].map(label => JSON.stringify({ type: 'progress', label }))
  vi.stubGlobal('fetch', vi.fn(async () => new Response(`${events.join('\n')}\n${JSON.stringify({ type: 'pdf', length: pdf.length })}\n${pdf}`, { headers: { 'Content-Type': 'application/vnd.createpdf.word-stream' } })))
  await wordToPdf(new Blob(), progress)
  const values = progress.mock.calls.map(([value]) => value)
  expect(values).toEqual([...values].sort((a, b) => a - b))
  expect(progress).toHaveBeenCalledWith(60, 'Preparing document')
  expect(progress).toHaveBeenLastCalledWith(100, 'PDF ready')
 })
 it('rejects streamed errors and incomplete PDF downloads without reporting completion', async () => {
  const progress = vi.fn()
  const streamed = body => new Response(body, { headers: { 'Content-Type': 'application/vnd.createpdf.word-stream' } })
  vi.stubGlobal('fetch', vi.fn(async () => streamed('{"type":"error","error":"Invalid document"}\n')))
  await expect(wordToPdf(new Blob(), progress)).rejects.toThrow('Invalid document')
  fetch.mockResolvedValue(streamed('{"type":"pdf","length":100}\n%PDF-1.7'))
  await expect(wordToPdf(new Blob(), progress)).rejects.toThrow('interrupted')
  expect(progress.mock.calls.some(([value]) => value === 100)).toBe(false)
 })
 it('works without AbortSignal.timeout and returns a valid PDF for explicit download', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new TypeError('AbortSignal.timeout is unavailable') })
  const file = new Blob(['DOCX'])
  const progress = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } })))
  const blob = await wordToPdf(file, progress)
  expect(await blob.text()).toContain('%PDF-')
  expect(progress).toHaveBeenLastCalledWith(100, 'PDF ready')
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
 })
 it('keeps actionable server errors and rejects invalid downloads', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 })))
  await expect(wordToPdf(new Blob())).rejects.toThrow('Service unavailable')
  fetch.mockResolvedValue(new Response('<html>error</html>', { headers: { 'Content-Type': 'application/pdf' } }))
  await expect(wordToPdf(new Blob())).rejects.toThrow('invalid PDF')
 })
 it('reports network failures clearly', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
  await expect(wordToPdf(new Blob())).rejects.toThrow('Check your connection')
 })
})
