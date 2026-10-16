import { afterEach, describe, expect, it, vi } from 'vitest'
import { wordToPdf } from './wordImport'
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('mobile Word conversion client', () => {
 it('works without AbortSignal.timeout and returns a valid PDF for explicit download', async () => {
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { throw new TypeError('AbortSignal.timeout is unavailable') })
  const file = new Blob(['DOCX'])
  const progress = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } })))
  const blob = await wordToPdf(file, progress)
  expect(await blob.text()).toContain('%PDF-')
  expect(progress).toHaveBeenLastCalledWith(100)
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
