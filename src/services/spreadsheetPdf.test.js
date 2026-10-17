import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { spreadsheetColumnCount, spreadsheetTablesHtml } from './spreadsheetPdf'

describe('spreadsheet report conversion', () => {
  it('retains columns introduced after a single-cell title row', () => {
    const rows = parseCsv('BUSINESS DASHBOARD\nTotal Orders:,39\nDATE,DAY,ORDERS,REVENUE,AVERAGE\n2026-07-19,Sunday,7,910.00,130.00')
    expect(spreadsheetColumnCount(rows)).toBe(5)
    const html = spreadsheetTablesHtml([{ name: 'CSV', rows }], { includeSheetNames: false })
    expect(html).not.toContain('<h2>')
    expect(html).toContain('<tr><td>BUSINESS DASHBOARD</td><td></td><td></td><td></td><td></td></tr>')
    expect(html).toContain('<tr><td>2026-07-19</td><td>Sunday</td><td>7</td><td>910.00</td><td>130.00</td></tr>')
  })
  it('escapes literal CSV markup and preserves zero, empty cells, and quoted values', () => {
    const rows = parseCsv('Item,Notes,Value\n"Apple, red","line one\nline two",0\n<script>alert(1)</script>,,2')
    const html = spreadsheetTablesHtml([{ rows }])
    expect(html).toContain('<td>Apple, red</td><td>line one\nline two</td><td>0</td>')
    expect(html).toContain('<td>&lt;script&gt;alert(1)&lt;/script&gt;</td><td></td><td>2</td>')
    expect(html).not.toContain('<script>')
  })
  it('keeps workbook sheet headings and page breaks, including a real sheet named CSV', () => {
    const html = spreadsheetTablesHtml([{ name: 'Sales & orders', rows: [['A', 0]] }, { name: 'CSV', rows: [['B']] }])
    expect(html).toContain('<h2>Sales &amp; orders</h2>')
    expect(html).toContain('<section data-page-break="before"><h2>CSV</h2>')
    expect(spreadsheetColumnCount([])).toBe(0)
  })
})
