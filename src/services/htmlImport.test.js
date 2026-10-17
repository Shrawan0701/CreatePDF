import { afterEach, describe, expect, it, vi } from 'vitest'
import { styledHtmlToPdf } from './htmlImport.js'
afterEach(() => vi.unstubAllGlobals())

describe('styled HTML conversion client', () => {
  it('sends original CSS to the renderer and returns the rendered PDF', async () => {
    const html = '<style>.cards { display: grid; }</style><div class="cards">Cards</div>'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/pdf' } })))
    expect(await (await styledHtmlToPdf(html, { margin: 20 })).text()).toContain('%PDF-')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ html, options: { margin: 20 } })
  })
  it('keeps actionable service errors and rejects invalid downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Document too large"}', { status: 413 })))
    await expect(styledHtmlToPdf('<p>Content</p>')).rejects.toThrow('Document too large')
    fetch.mockResolvedValue(new Response('<html>Error</html>', { headers: { 'Content-Type': 'application/pdf' } }))
    await expect(styledHtmlToPdf('<p>Content</p>')).rejects.toThrow('invalid PDF')
  })
  it('cancels an obsolete preview request when the content changes', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError'))))))
    const pending = styledHtmlToPdf('<p>Old content</p>', {}, { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})
