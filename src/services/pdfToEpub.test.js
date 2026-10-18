import { describe, expect, it } from 'vitest'
import { epubPackage, epubPreviewDocument, epubSettings, epubStyles, epubXhtml } from './pdfToEpub'

describe('EPUB metadata and reading preferences', () => {
  it('normalizes metadata and bounds reading settings', () => {
    const settings = epubSettings({ title: '  A book  ', author: '  Author  ', fontSize: 900, lineHeight: -2, fontFamily: 'injected-font', scale: 99 }, 'source.pdf')
    expect(settings.title).toBe('A book')
    expect(settings.author).toBe('Author')
    expect(settings.fontSize).toBe(160)
    expect(settings.lineHeight).toBe(1.2)
    expect(settings.fontFamily).toBe('serif')
    expect(settings.scale).toBe(2)
  })
  it('uses sensible fallbacks for blank or nonfinite numeric input', () => {
    const settings = epubSettings({ fontSize: '', lineHeight: NaN }, 'Chapter one.pdf')
    expect(settings.title).toBe('Chapter one')
    expect(settings.fontSize).toBe(100)
    expect(settings.lineHeight).toBe(1.6)
  })
  it.each(['en', 'hi', 'mr', 'ar', 'en-IN', 'zh-Hant'])('accepts language tag %s', language => {
    expect(epubSettings({ language }).language).toBe(language)
  })
  it.each(['en" onclick="alert(1)', '../en', 'english', 'en-'])('rejects invalid language tag %s', language => {
    expect(() => epubSettings({ language })).toThrow('language code')
  })
})

describe('EPUB package and content documents', () => {
  const chapters = [{ id: 'page-2', filename: 'page-2.xhtml', number: 2, label: 'Chapter two' }]
  const assets = [{ id: 'image-2', path: 'page-2.png' }, { id: 'cover-image', path: 'cover.png', cover: true }]
  it('escapes metadata and connects the manifest, spine, cover, and NCX', () => {
    const settings = epubSettings({ title: 'A <book> & notes', author: 'Jane & Joe', description: 'A "description"' })
    const opf = epubPackage(chapters, assets, settings, { identifier: 'urn:uuid:test', modified: '2026-10-18T12:00:00Z', cover: true })
    expect(opf).toContain('<dc:title>A &lt;book&gt; &amp; notes</dc:title>')
    expect(opf).toContain('<dc:creator>Jane &amp; Joe</dc:creator>')
    expect(opf).toContain('properties="cover-image"')
    expect(opf).toContain('<spine toc="ncx">')
    expect(opf).toContain('<itemref idref="page-2"/>')
    expect(opf).toContain('<meta property="rendition:layout">reflowable</meta>')
  })
  it('declares fixed layout and keeps contents reflowable for image books', () => {
    const settings = epubSettings({ readingLayout: 'pages', language: 'ar' })
    const opf = epubPackage(chapters, assets, settings, { identifier: 'test', modified: '2026-10-18T12:00:00Z' })
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>')
    expect(opf).toContain('page-progression-direction="rtl"')
    expect(opf).toContain('properties="rendition:layout-reflowable"')
    const chapter = epubXhtml('Page <2>', '<p>Content</p>', settings, { width: 842, height: 595, className: 'fixed-body' })
    expect(chapter).toContain('content="width=842,height=595"')
    expect(chapter).toContain('xml:lang="ar"')
    expect(chapter).toContain('<title>Page &lt;2&gt;</title>')
  })
  it('writes requested reading styles without arbitrary CSS interpolation', () => {
    const css = epubStyles(epubSettings({ fontFamily: 'sans-serif', fontSize: 120, lineHeight: 1.8 }))
    expect(css).toContain('font-family:sans-serif;font-size:120%;line-height:1.8')
    expect(css).toContain('img{max-width:100%;height:auto}')
  })
})

describe('book preview', () => {
  it('inlines book assets and reading CSS from the same chapter used in the EPUB', () => {
    const settings = epubSettings()
    const chapter = { id: 'page-2', xhtml: epubXhtml('Chapter', '<section><p>Chapter text</p><img src="images/photo.png" alt="Photo"/></section>', settings) }
    const preview = epubPreviewDocument({ settings, chapters: [chapter], assets: [{ path: 'images/photo.png', data: 'data:image/png;base64,AAAA' }] }, 'page-2', 'night')
    expect(preview).toContain('<p>Chapter text</p>')
    expect(preview).toContain('src="data:image/png;base64,AAAA"')
    expect(preview).not.toContain('href="styles.css"')
    expect(preview).toContain('background:#17231e')
    expect(preview).toContain('epub-preview-navigation')
  })
})
