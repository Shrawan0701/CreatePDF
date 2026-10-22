import devanagari from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url'
import devanagariBold from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff?url'
import bengali from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff?url'
import bengaliBold from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff?url'
import gujarati from '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff?url'
import gujaratiBold from '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-700-normal.woff?url'
import tamil from '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff?url'
import tamilBold from '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-700-normal.woff?url'
import telugu from '../assets/fonts/NotoSansTelugu-Regular.ttf?url'
import teluguBold from '../assets/fonts/NotoSansTelugu-Bold.ttf?url'
import kannada from '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-400-normal.woff?url'
import kannadaBold from '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-700-normal.woff?url'

const bundled = {
  'Noto Sans Devanagari': [devanagari, devanagariBold],
  'Noto Sans Bengali': [bengali, bengaliBold],
  'Noto Sans Gujarati': [gujarati, gujaratiBold],
  'Noto Sans Tamil': [tamil, tamilBold],
  'Noto Sans Telugu': [telugu, teluguBold],
  'Noto Sans Kannada': [kannada, kannadaBold],
}
const cache = new Map()

// DOCX embeds OpenType/sfnt, not the WOFF wrapper used by the browser assets.
// Restore the original tables, retaining GSUB/GPOS for complex-script shaping.
export async function wordFontSfnt(bytes) {
  const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (input.getUint32(0) !== 0x774f4646) return bytes
  const count = input.getUint16(12), size = input.getUint32(16)
  if (!count || size > 20 * 1024 * 1024 || 44 + count * 20 > bytes.length) throw new Error('Invalid bundled Word font.')
  const output = new Uint8Array(size), view = new DataView(output.buffer)
  view.setUint32(0, input.getUint32(4)); view.setUint16(4, count)
  const power = Math.floor(Math.log2(count))
  view.setUint16(6, 16 * 2 ** power); view.setUint16(8, power); view.setUint16(10, count * 16 - 16 * 2 ** power)
  let offset = 12 + count * 16, head
  for (let index = 0; index < count; index++) {
    const entry = 44 + index * 20, directory = 12 + index * 16
    const tag = input.getUint32(entry), start = input.getUint32(entry + 4), compressed = input.getUint32(entry + 8), length = input.getUint32(entry + 12)
    if (start + compressed > bytes.length || offset + length > size) throw new Error('Invalid bundled Word font table.')
    const packed = bytes.slice(start, start + compressed)
    const table = compressed < length ? new Uint8Array(await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()) : packed
    if (table.length !== length) throw new Error('Could not read the bundled Word font.')
    view.setUint32(directory, tag); view.setUint32(directory + 4, input.getUint32(entry + 16)); view.setUint32(directory + 8, offset); view.setUint32(directory + 12, length)
    output.set(table, offset)
    if (tag === 0x68656164) head = offset
    offset += (length + 3) & ~3
  }
  if (head !== undefined) {
    view.setUint32(head + 8, 0)
    let checksum = 0
    for (let index = 0; index < size; index += 4) checksum = (checksum + view.getUint32(index)) >>> 0
    view.setUint32(head + 8, (0xb1b0afba - checksum) >>> 0)
  }
  return output
}

export async function loadWordFonts(names) {
  return Promise.all([...new Set(names)].filter(name => bundled[name]).map(name => {
    if (!cache.has(name)) cache.set(name, Promise.all(bundled[name].map(async (url, index) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error('Could not load the local Word font. Please try again.')
      const bytes = await wordFontSfnt(new Uint8Array(await response.arrayBuffer()))
      const face = new FontFace(name, bytes, { weight: index ? '700' : '400' })
      document.fonts.add(await face.load())
      return bytes
    })).then(([data, bold]) => ({ name, data, bold })).catch(error => { cache.delete(name); throw error }))
    return cache.get(name)
  }))
}
