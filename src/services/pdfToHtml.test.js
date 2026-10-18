import { describe, expect, it } from 'vitest'
import { buildHtmlDocument, htmlEscape, htmlReadingContent, htmlSafeLink, htmlTextItems } from './pdfToHtml'

describe('HTML export escaping and links', () => {
  it('escapes document markup and strips invalid control characters', () => {
    expect(htmlEscape('<script>"&\u0000</script>')).toBe('&lt;script&gt;&quot;&amp;&lt;/script&gt;')
  })
  it.each(['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', 'blob:https://example.com/id', '/relative'])('rejects unsafe or nonportable link %s', link => {
    expect(htmlSafeLink(link)).toBe('')
  })
  it.each(['https://example.com/report?x=1&y=2', 'mailto:hello@example.com', 'tel:+911234567890'])('keeps supported link %s', link => {
    expect(htmlSafeLink(link)).toBe(link)
  })
})

describe('HTML document generation', () => {
  const page = { number: 2, width: 300, height: 400, pixelWidth: 600, pixelHeight: 800, data: 'data:image/png;base64,AAAA', path: 'assets/page-2.png', items: [], images: [], links: [{ x: 10, y: 20, width: 40, height: 15, href: 'https://example.com/?a=1&b=2', label: 'Open "report"' }], textHtml: '<span>Selectable text</span>' }
  it('produces self-contained offline HTML with responsive page geometry and escaped title', () => {
    const html = buildHtmlDocument([page], { title: '</title><script>unsafe()</script>' })
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;unsafe()&lt;/script&gt;')
    expect(html).not.toContain('<script>unsafe()')
    expect(html).toContain('data:image/png;base64,AAAA')
    expect(html).toContain('--page-ratio:300/400')
    expect(html).toContain('ResizeObserver')
    expect(html).toContain('aria-label="Open &quot;report&quot;"')
    expect(html).toContain('<span>Selectable text</span>')
  })
  it('uses relative ZIP paths and inline images in the matching preview', () => {
    expect(buildHtmlDocument([page], { packageAssets: true })).toContain('src="assets/page-2.png"')
    expect(buildHtmlDocument([page], { packageAssets: true }, true)).toContain('src="data:image/png;base64,AAAA"')
  })
  it('preserves scanned pages as images with an explicit OCR note in reading mode', () => {
    const html = buildHtmlDocument([page], { layout: 'reading' })
    expect(html).toContain('Scanned page preserved as an image')
    expect(html).toContain('class="scan-page"')
    expect(html).not.toContain('class="text-layer"')
  })
})

describe('reading layout structure', () => {
  const item = (text, x, y, size = 12, more = {}) => ({ text, x, y, size, width: 50, dir: 'ltr', ...more })
  it('creates real headings, paragraphs, lists, and links without raw source markup', () => {
    const html = htmlReadingContent([
      item('Report <title>', 20, 30, 22, { bold: true }),
      item('First line', 20, 70), item('continued paragraph', 20, 85),
      item('• A useful point', 20, 115), item('Open report', 20, 145),
    ], [{ x: 15, y: 130, width: 80, height: 20, href: 'https://example.com' }])
    expect(html).toContain('<h2 dir="ltr"><strong>Report &lt;title&gt;</strong></h2>')
    expect(html).toContain('<p dir="ltr">First line continued paragraph</p>')
    expect(html).toContain('<ul><li>A useful point</li></ul>')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('Report <title>')
  })
  it('reconstructs consistently aligned three-column tables without duplicating their text', () => {
    const items = [['Name', 'Qty', 'Price'], ['Apple', '2', '12'], ['Pear', '3', '15']].flatMap((row, rowIndex) => row.map((text, column) => item(text, 20 + column * 140, 100 + rowIndex * 20)))
    const html = htmlReadingContent(items)
    expect(html).toContain('<table><thead>')
    expect(html).toContain('<th scope="col">Name</th>')
    expect(html).toContain('<td>Apple</td>')
    expect(html.split('Apple').length).toBe(2)
  })
  it('recognizes a heading on a page containing only a title and one body line', () => {
    const html = htmlReadingContent([item('Short report', 20, 30, 22), item('Body text', 20, 65, 12)])
    expect(html).toContain('<h2 dir="ltr">Short report</h2>')
    expect(html).toContain('<p dir="ltr">Body text</p>')
  })
})

describe('selectable text geometry', () => {
  it('accounts for PDF font ascent, width, and rotation', () => {
    const content = { items: [{ str: 'Rotated', fontName: 'font', transform: [], width: 70, height: 12 }], styles: { font: { ascent: .75 } } }
    const [item] = htmlTextItems(content, { transform: [] }, { Util: { transform: () => [0, 12, -12, 0, 100, 200] } }, { commonObjs: { get: () => ({ name: 'Helvetica-Bold' }) } })
    expect(item.size).toBe(12)
    expect(item.angle).toBeCloseTo(Math.PI / 2)
    expect(item.left).toBeCloseTo(109)
    expect(item.top).toBeCloseTo(200)
    expect(item.width).toBe(70)
    expect(item.bold).toBe(true)
  })
  it('scales selection widths for PDFs with nonstandard user units', () => {
    const content = { items: [{ str: 'Scaled', fontName: 'font', transform: [], width: 70, height: 12 }], styles: { font: {} } }
    const [item] = htmlTextItems(content, { transform: [], scale: 1, userUnit: 2 }, { Util: { transform: () => [24, 0, 0, -24, 80, 160] } }, { commonObjs: { get: () => ({ name: 'Helvetica' }) } })
    expect(item.width).toBe(140)
    expect(item.size).toBe(24)
  })
})
