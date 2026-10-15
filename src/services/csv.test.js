import { describe, expect, it } from 'vitest'
import { formatCsv, parseCsv } from './csv'

describe('CSV document data', () => {
  it('keeps quoted commas, line breaks, quotes, and empty cells', () => {
    expect(parseCsv('\uFEFFName,Notes,Count\r\n"Apple, red","First line\nSecond ""quoted"" line",0\r\nPear,,2')).toEqual([
      ['Name', 'Notes', 'Count'], ['Apple, red', 'First line\nSecond "quoted" line', '0'], ['Pear', '', '2'],
    ])
  })
  it('rejects malformed input before silently changing document values', () => {
    expect(() => parseCsv('Name,Value\n"unclosed,1')).toThrow('unclosed')
    expect(() => parseCsv('Name\n"closed"suffix')).toThrow('must end')
  })
  it('round-trips exported values including zero and special characters', () => {
    const rows = [['Name', 'Value'], ['A "quoted", value', 0], ['Multiline', 'line 1\nline 2']]
    expect(parseCsv(formatCsv(rows))).toEqual(rows.map((row) => row.map(String)))
  })
})
