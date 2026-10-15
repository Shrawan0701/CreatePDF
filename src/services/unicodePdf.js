import 'regenerator-runtime/runtime.js'
import fontkit from '@pdf-lib/fontkit'
import regularUrl from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url'
import boldUrl from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff?url'

const devanagari = /[\u0900-\u097F\u20B9]/
let fontBytesPromise

async function getFontBytes() {
  if (!fontBytesPromise) fontBytesPromise = Promise.all([regularUrl, boldUrl].map(async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Local PDF font could not be loaded.')
    return response.arrayBuffer()
  }))
  return fontBytesPromise
}

export async function embedUnicodeFonts(pdf) {
  pdf.registerFontkit(fontkit)
  const [regularBytes, boldBytes] = await getFontBytes()
  return {
    regular: await pdf.embedFont(regularBytes, { subset: true }),
    bold: await pdf.embedFont(boldBytes, { subset: true }),
  }
}

export function drawUnicodeText(page, text, options, fonts) {
  const value = String(text ?? '')
  const { font, x, size } = options
  let offset = 0
  let current = ''
  let currentFont = null
  const flush = () => {
    if (!current) return
    page.drawText(current, { ...options, x: x + offset, font: currentFont })
    offset += currentFont.widthOfTextAtSize(current, size)
    current = ''
  }
  for (const character of value) {
    const selectedFont = devanagari.test(character) ? (font === fonts.baseBold ? fonts.bold : fonts.regular) : font
    let safeCharacter = character
    if (selectedFont === font) {
      try { font.encodeText(character) } catch { safeCharacter = '?' }
    }
    if (currentFont && selectedFont !== currentFont) flush()
    currentFont = selectedFont
    current += safeCharacter
  }
  flush()
  return offset
}

export function measureUnicodeText(text, font, size, fonts) {
  let width = 0
  let run = ''
  let runFont = null
  const flush = () => { if (run) width += runFont.widthOfTextAtSize(run, size); run = '' }
  for (const character of String(text ?? '')) {
    const selectedFont = devanagari.test(character) ? (font === fonts.baseBold ? fonts.bold : fonts.regular) : font
    if (runFont && selectedFont !== runFont) flush()
    runFont = selectedFont
    if (selectedFont === font) {
      try { font.encodeText(character); run += character } catch { run += '?' }
    } else run += character
  }
  flush()
  return width
}
