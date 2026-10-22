// Word needs a font that supports the script, including its shaping tables.
const scripts = [
  { pattern: /[\u0900-\u097f]/, name: /devanagari|mangal/i, font: 'Noto Sans Devanagari' },
  { pattern: /[\u0980-\u09ff]/, name: /bengali|vrinda/i, font: 'Noto Sans Bengali' },
  { pattern: /[\u0a80-\u0aff]/, name: /gujarati|shruti/i, font: 'Noto Sans Gujarati' },
  { pattern: /[\u0b80-\u0bff]/, name: /tamil|latha/i, font: 'Noto Sans Tamil' },
  { pattern: /[\u0c00-\u0c7f]/, name: /telugu|gautami/i, font: 'Noto Sans Telugu' },
  { pattern: /[\u0c80-\u0cff]/, name: /kannada|tunga/i, font: 'Noto Sans Kannada' },
  { pattern: /[\u0a00-\u0a7f\u0b00-\u0b7f\u0d00-\u0dff]/, font: 'Nirmala UI' },
  { pattern: /[\u0590-\u05ff\u0600-\u08ff\ufb1d-\ufeff]/, font: 'Arial', rtl: true },
  { pattern: /[\u0e00-\u0e7f]/, font: 'Leelawadee UI' },
  { pattern: /[\u3040-\u30ff]/, font: 'Yu Gothic' },
  { pattern: /[\uac00-\ud7af]/, font: 'Malgun Gothic' },
  { pattern: /[\u3400-\u9fff]/, font: 'Microsoft YaHei' },
]

export function wordScript(text, sourceFont = '') {
  return scripts.find(script => script.pattern.test(text)) || scripts.find(script => script.name?.test(sourceFont))
}

export function cleanWordText(value) {
  return [...value].filter(character => character.codePointAt(0) >= 32 && !/[\ufffe\uffff]/.test(character) || [9, 10, 13].includes(character.codePointAt(0))).join('').normalize('NFC')
}

export function wordTextNeedsReview(text) {
  // eslint-disable-next-line no-control-regex -- malformed PDF character mappings
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd\ue000-\uf8ff]/.test(text)
}

// Some PDFs map a visually placed pre-base vowel before its consonant cluster.
// Repair only an impossible leading/double-vowel sequence; valid किरण stays किरण.
export function logicalWordText(text) {
  return cleanWordText(text)
    .replace(/(^|[\s\u0900-\u0914\u093e-\u094c])\u093f([\u0915-\u0939\u0958-\u095f](?:\u093c)?(?:\u094d[\u200c\u200d]?[\u0915-\u0939\u0958-\u095f]\u093c?)*)/g, '$1$2\u093f')
    .replace(/(^|[\s\u0980-\u0994\u09be-\u09cc])([\u09bf\u09c7\u09c8])([\u0995-\u09b9\u09dc-\u09df](?:\u09bc)?(?:\u09cd[\u200c\u200d]?[\u0995-\u09b9\u09dc-\u09df]\u09bc?)*)/g, '$1$3$2')
    .replace(/(^|[\s\u0a80-\u0a94\u0abe-\u0acc])\u0abf([\u0a95-\u0ab9](?:\u0abc)?(?:\u0acd[\u200c\u200d]?[\u0a95-\u0ab9]\u0abc?)*)/g, '$1$2\u0abf')
    .replace(/(^|\s)([\u0bc6-\u0bc8])([\u0b95-\u0bb9])/g, '$1$3$2')
    .normalize('NFC')
}

// Keep words and combining marks together so Word shapes the entire syllable.
// A zero-width PDF item can carry real conjunct text and must never be discarded.
export function joinWordText(items) {
  let text = '', previous
  const rtl = items.filter(item => item.rtl).length > items.length / 2
  for (const item of rtl ? [...items].reverse() : items) {
    const value = logicalWordText(item.text)
    const gap = previous ? rtl ? previous.x - item.x - item.width : item.x - previous.x - previous.width : 0
    const adjacentCluster = previous && previous.width < .01 && Math.abs(item.x - previous.x) < 1
    if (previous && !adjacentCluster && gap > Math.max(.5, item.size * .12) && !/\s$/.test(text) && !/^\s/.test(value) && !/^\p{Mark}/u.test(value)) text += ' '
    text += value
    previous = item
  }
  return logicalWordText(text)
}

export function wordLineRegions(items) {
  const regions = []
  for (const item of items) {
    const region = regions.at(-1)
    // Normal translated word spacing can be much wider than a Latin space.
    if (!region || item.x - region.right > Math.max(18, item.size * 1.8)) regions.push({ items: [item], x: item.x, right: item.x + item.width })
    else { region.items.push(item); region.right = Math.max(region.right, item.x + item.width) }
  }
  return regions
}
