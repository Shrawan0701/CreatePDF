import { describe, expect, it } from 'vitest'
import { cleanWordText, joinWordText, logicalWordText, wordLineRegions, wordScript, wordTextNeedsReview } from './pdfWordText'
import { wordFontSfnt } from './pdfWordFonts'
import { readFile } from 'node:fs/promises'

const item = (text, x, width, extra = {}) => ({ text, x, width, size: 10, ...extra })

describe('multilingual Word text', () => {
  it('selects a font for each supported script instead of replacing it with Arial', () => {
    for (const [text, font] of [['मराठी', 'Noto Sans Devanagari'], ['বাংলা', 'Noto Sans Bengali'], ['ગુજરાતી', 'Noto Sans Gujarati'], ['தமிழ்', 'Noto Sans Tamil'], ['తెలుగు', 'Noto Sans Telugu'], ['ಕನ್ನಡ', 'Noto Sans Kannada']]) expect(wordScript(text).font).toBe(font)
    expect(wordScript('', 'NotoSansDevanagari-Regular-2261').font).toBe('Noto Sans Devanagari')
    expect(wordScript('English')).toBeUndefined()
    expect(wordScript('العربية').rtl).toBe(true)
    expect(wordScript('日本語').font).toBe('Microsoft YaHei')
    expect(wordScript('ひらがな').font).toBe('Yu Gothic')
  })
  it('keeps combining marks and zero-width conjunct text attached to their base', () => {
    expect(joinWordText([item('श', 0, 10), item('ि', 10, 0), item('क्षण', 10, 20)])).toBe('शिक्षण')
    expect(joinWordText([item(' क्र', 40, 0), item('मांक', 40, 20)])).toBe(' क्रमांक')
    expect(joinWordText([item('महाराष्ट्र', 0, 20), item('राज्य', 28, 15)])).toBe('महाराष्ट्र राज्य')
    expect(joinWordText([item('தமிழ்', 0, 20), item('ெமாழி', 28, 15)])).toBe('தமிழ் மொழி')
    expect(joinWordText([item('2026', 0, 20), item('िशक्षण', 28, 15)])).toBe('2026 शिक्षण')
  })
  it('repairs impossible visual-order short-i sequences without changing valid Unicode words', () => {
    expect(logicalWordText('िशक्षण तांित्रक पॉिलटेिक्नक')).toBe('शिक्षण तांत्रिक पॉलिटेक्निक')
    expect(logicalWordText('आिण')).toBe('आणि')
    expect(logicalWordText('িশক্ষা િશક્ષણ ெமாழி')).toBe('শিক্ষা શિક્ષણ மொழி')
    for (const text of ['किरण', 'शिक्षण', 'मराठी भाषा', 'हिन्दी', 'किंचित', 'प्रकृति', 'कि क्षि', 'শিক্ষা', 'શિક્ષણ', 'தேர்வு', 'పరీక్ష', 'ವಿದ್ಯಾರ್ಥಿ']) expect(logicalWordText(text)).toBe(text)
  })
  it('preserves Arabic logical reading order across separately positioned words', () => {
    expect(joinWordText([item('بالعالم', 0, 25, { rtl: true }), item('مرحبا', 30, 20, { rtl: true })])).toBe('مرحبا بالعالم')
  })
  it('separates columns while keeping ordinary translated word gaps together', () => {
    const regions = wordLineRegions([item('महाराष्ट्र', 40, 20), item('राज्य', 69, 15), item('नाव', 250, 20)])
    expect(regions).toHaveLength(2)
    expect(regions.map(region => region.items.map(item => item.text))).toEqual([['महाराष्ट्र', 'राज्य'], ['नाव']])
  })
  it('flags damaged mappings without inventing missing letters or losing join controls', () => {
    expect(wordTextNeedsReview('पूण\u0017')).toBe(true)
    expect(wordTextNeedsReview('\ufffd')).toBe(true)
    expect(wordTextNeedsReview('शिक्षण')).toBe(false)
    expect(cleanWordText('a\u0000b\nक्\u200dष')).toBe('ab\nक्\u200dष')
  })
})

describe('Word font embedding', () => {
  it('restores a valid sfnt checksum and preserves Indic shaping tables from bundled WOFF', async () => {
    const input = await readFile('node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff')
    const output = await wordFontSfnt(new Uint8Array(input))
    const view = new DataView(output.buffer), count = view.getUint16(4)
    expect(view.getUint32(0)).toBe(0x00010000)
    const tags = Array.from({ length: count }, (_, index) => String.fromCharCode(...output.slice(12 + index * 16, 16 + index * 16)))
    expect(tags).toContain('GSUB')
    expect(tags).toContain('GPOS')
    let checksum = 0
    for (let index = 0; index < output.length; index += 4) checksum = (checksum + view.getUint32(index)) >>> 0
    expect(checksum).toBe(0xb1b0afba)
  })
})
