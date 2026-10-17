import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { createHtmlPdfHandler, fetchHtmlAsset, isPublicAssetAddress } from './htmlPdf.js'

describe('HTML rendering service', () => {
  it('passes the complete HTML and CSS to the browser renderer', async () => {
    const html = '<html><head><style>.grid{display:grid}</style></head><body><div class="grid">Content</div></body></html>'
    const request = Readable.from([Buffer.from(JSON.stringify({ html, options: { webLayout: 'desktop', pageSize: 'A4' } }))])
    request.method = 'POST'
    request.headers = {}
    const response = { headers: {}, setHeader(name, value) { this.headers[name] = value }, end(value) { this.body = value } }
    const convert = vi.fn(async () => Buffer.from('%PDF-1.7\nfixture'))
    await createHtmlPdfHandler({ convert })(request, response)
    expect(convert).toHaveBeenCalledWith(html, { webLayout: 'desktop', pageSize: 'A4' }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(response.headers).toMatchObject({ 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' })
    expect(response.body.toString()).toContain('%PDF-')
  })
  it.each([
    ['GET', '', {}, 405],
    ['POST', 'invalid JSON', {}, 400],
    ['POST', '{"html":" "}', {}, 400],
    ['POST', '{"html":42}', {}, 400],
    ['POST', '', { 'content-length': 5 * 1024 * 1024 }, 413],
  ])('rejects invalid requests (%s, %s)', async (method, body, headers, status) => {
    const request = Readable.from([Buffer.from(body)])
    Object.assign(request, { method, headers })
    const response = { setHeader() {}, end(value) { this.body = value } }
    const convert = vi.fn()
    await createHtmlPdfHandler({ convert })(request, response)
    expect(response.statusCode).toBe(status)
    expect(convert).not.toHaveBeenCalled()
  })
  it.each(['127.0.0.1', '10.0.0.1', '192.168.1.1', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1'])('blocks private asset address %s', address => {
    expect(isPublicAssetAddress(address)).toBe(false)
  })
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows public asset address %s', address => {
    expect(isPublicAssetAddress(address)).toBe(true)
  })
  it.each(['file:///etc/passwd', 'http://example.com/image.png', 'https://127.0.0.1/image.png', 'https://[::1]/', 'https://example.com:8443/image', 'https://user:pass@example.com/image'])('rejects unsupported asset URL %s', async address => {
    await expect(fetchHtmlAsset(address, { budget: { requests: 0, bytes: 0 } })).rejects.toThrow()
  })
})
