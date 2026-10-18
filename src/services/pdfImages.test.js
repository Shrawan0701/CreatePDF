import { describe, expect, it } from 'vitest'
import { decodedImagePixels, filterPdfImages, imagePageNumbers } from './pdfImages'

describe('PDF image pixel decoding', () => {
  it('decodes packed monochrome scans with per-row padding', () => {
    const pixels = decodedImagePixels({ width: 3, height: 2, kind: 1, data: new Uint8Array([0b10100000, 0b01000000]) })
    expect([...pixels]).toEqual([
      255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    ])
  })
  it('decodes monochrome stencil masks with transparent backgrounds', () => {
    expect([...decodedImagePixels({ width: 2, height: 1, data: new Uint8Array([0b01000000]) }, true)])
      .toEqual([0, 0, 0, 255, 0, 0, 0, 0])
  })
  it('keeps RGB colors and RGBA transparency', () => {
    expect([...decodedImagePixels({ width: 1, height: 1, kind: 2, data: new Uint8Array([24, 65, 210]) })]).toEqual([24, 65, 210, 255])
    expect([...decodedImagePixels({ width: 1, height: 1, kind: 3, data: new Uint8Array([24, 65, 210, 43]) })]).toEqual([24, 65, 210, 43])
  })
})

describe('extraction page selection', () => {
  it('selects every page by default and normalizes specified pages', () => {
    expect(imagePageNumbers('', 3)).toEqual([1, 2, 3])
    expect(imagePageNumbers(' 3, 1 - 2, 1 ', 3)).toEqual([1, 2, 3])
  })
  it.each(['0', '4', '2-1', '1-4', 'abc', '1,', '-1', '1.5'])('rejects invalid page selection %s', range => {
    expect(() => imagePageNumbers(range, 3)).toThrow()
  })
})

describe('image library filtering', () => {
  const images = [
    { id: 'a', pageNumber: 1, width: 120, height: 100, hash: 'same', blob: { size: 90 } },
    { id: 'b', pageNumber: 2, width: 120, height: 100, hash: 'same', blob: { size: 90 } },
    { id: 'c', pageNumber: 2, width: 400, height: 300, hash: 'large', blob: { size: 300 } },
    { id: 'd', pageNumber: 2, width: 500, height: 12, hash: 'line', blob: { size: 80 } },
  ]
  it('deduplicates images across pages and retains page attribution without mutation', () => {
    const result = filterPdfImages(images)
    expect(result.map(image => image.id)).toEqual(['a', 'c', 'd'])
    expect(result[0].pageNumbers).toEqual([1, 2])
    expect(images[0].pageNumbers).toBeUndefined()
  })
  it('applies source page filtering before deduplication', () => {
    expect(filterPdfImages(images, { page: '2' }).map(image => image.id)).toEqual(['b', 'c', 'd'])
  })
  it('uses both dimensions for size filtering and sorts by pixel area', () => {
    expect(filterPdfImages(images, { deduplicate: false, minSize: 32, sort: 'largest' }).map(image => image.id)).toEqual(['c', 'a', 'b'])
  })
})
