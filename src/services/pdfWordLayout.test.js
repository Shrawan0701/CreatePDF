import { describe, expect, it } from 'vitest'
import { detectBorderlessWordTables, detectWordTables, groupWordLines, wordLinkRectangle, wordPageSelection } from './pdfWordLayout'

const text = (value, x, y, size = 10) => ({ text: value, x, y, width: value.length * size * .45, size })
describe('PDF to Word layout', () => {
  it('positions link rectangles with the viewport matrix, including rotated pages', () => {
    expect(wordLinkRectangle([40, 100, 140, 115], [1, 0, 0, -1, 0, 842])).toEqual({ x: 40, y: 727, width: 100, height: 15 })
    expect(wordLinkRectangle([40, 100, 140, 115], [0, 1, 1, 0, 0, 0])).toEqual({ x: 100, y: 40, width: 15, height: 100 })
  })
  it('ignores malformed link rectangles instead of failing the document conversion', () => {
    for (const rectangle of [undefined, null, [], [1, 2], [1, 2, NaN, 4], [1, 2, Infinity, 4]]) expect(wordLinkRectangle(rectangle, [1, 0, 0, 1, 0, 0])).toBeNull()
  })
  it('keeps wrapped text in a single table cell using the drawn row boundaries', () => {
    const segments = []
    for (const y of [100, 125, 165, 205]) segments.push({ x1: 40, x2: 340, y1: y, y2: y })
    for (const x of [40, 140, 240, 340]) segments.push({ x1: x, x2: x, y1: 100, y2: 205 })
    const items = [text('Order', 45, 115), text('Product', 145, 115), text('Status', 245, 115), text('ORD-1', 45, 140), text('Mechanical', 145, 140), text('Keyboard', 145, 153), text('Delivered', 245, 140), text('ORD-2', 45, 180), text('Mouse', 145, 180)]
    const [table] = detectWordTables(items, segments)
    expect(table.rows).toHaveLength(3)
    expect(table.rows[1][1].map(item => item.text)).toEqual(['Mechanical', 'Keyboard'])
    expect(table.rows[2][2]).toEqual([])
    expect(table.xs).toEqual([40, 140, 240, 340])
  })
  it('merges adjacent cell borders into complete row and column rules', () => {
    const segments = []
    for (const y of [100, 120, 140]) for (const x of [40, 140]) segments.push({ x1: x, x2: x + 100, y1: y, y2: y })
    for (const x of [40, 140, 240]) for (const y of [100, 120]) segments.push({ x1: x, x2: x, y1: y, y2: y + 20 })
    expect(detectWordTables([text('Name', 45, 114), text('Value', 145, 114)], segments)).toHaveLength(1)
  })
  it('does not classify ordinary sentences or signature pairs as tables', () => {
    const items = [text('Dear reader,', 40, 100), text('This is', 40, 120), text('a normal', 73, 120), text('sentence.', 116, 120), text('Director One', 40, 200), text('Director Two', 260, 200)]
    expect(detectWordTables(items, [])).toEqual([])
    expect(detectBorderlessWordTables(items)).toEqual([])
  })
  it('keeps separate grids separate even when they have the same width', () => {
    const segments = []
    const items = []
    for (const top of [100, 300]) {
      for (const y of [top, top + 20, top + 40]) segments.push({ x1: 40, x2: 240, y1: y, y2: y })
      for (const x of [40, 140, 240]) segments.push({ x1: x, x2: x, y1: top, y2: top + 40 })
      items.push(text('Name', 45, top + 14), text('Value', 145, top + 14))
    }
    expect(detectWordTables(items, segments)).toHaveLength(2)
  })
  it('recognizes a consistent borderless table without requiring borders', () => {
    const items = ['Name,Qty,Price', 'Apple,2,12', 'Pear,3,15'].flatMap((row, index) => row.split(',').map((value, col) => text(value, [40, 240, 400][col], 100 + index * 25)))
    const tables = detectBorderlessWordTables(items)
    expect(tables).toHaveLength(1)
    expect(tables[0].rows).toHaveLength(3)
    expect(tables[0].ruled).toBe(false)
    expect(groupWordLines(items)).toHaveLength(3)
  })
  it('validates page ranges without silently exporting unexpected pages', () => {
    expect(wordPageSelection('', 3)).toEqual([1, 2, 3])
    expect(wordPageSelection('3, 1-2, 2', 3)).toEqual([1, 2, 3])
    for (const range of ['0', '4', '2-1', 'x', '1,']) expect(() => wordPageSelection(range, 3)).toThrow()
  })
})
