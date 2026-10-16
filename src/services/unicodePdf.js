import 'regenerator-runtime/runtime.js'
import fontkit from '@pdf-lib/fontkit'
import regularUrl from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url'
import boldUrl from '@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-700-normal.woff?url'
import bengaliRegularUrl from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff?url'
import bengaliBoldUrl from '@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-700-normal.woff?url'
import tamilRegularUrl from '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-400-normal.woff?url'
import tamilBoldUrl from '@fontsource/noto-sans-tamil/files/noto-sans-tamil-tamil-700-normal.woff?url'
import teluguRegularUrl from '../assets/fonts/NotoSansTelugu-Regular.ttf?url'
import teluguBoldUrl from '../assets/fonts/NotoSansTelugu-Bold.ttf?url'
import kannadaRegularUrl from '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-400-normal.woff?url'
import kannadaBoldUrl from '@fontsource/noto-sans-kannada/files/noto-sans-kannada-kannada-700-normal.woff?url'
import gujaratiRegularUrl from '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-400-normal.woff?url'
import gujaratiBoldUrl from '@fontsource/noto-sans-gujarati/files/noto-sans-gujarati-gujarati-700-normal.woff?url'

const fontScripts = [
  { name: 'devanagari', pattern: /[\u0900-\u097F\u20B9]/, urls: [regularUrl, boldUrl] },
  { name: 'bengali', pattern: /[\u0980-\u09FF]/, urls: [bengaliRegularUrl, bengaliBoldUrl] },
  { name: 'tamil', pattern: /[\u0B80-\u0BFF]/, urls: [tamilRegularUrl, tamilBoldUrl] },
  { name: 'telugu', pattern: /[\u0C00-\u0C7F]/, urls: [teluguRegularUrl, teluguBoldUrl] },
  { name: 'kannada', pattern: /[\u0C80-\u0CFF]/, urls: [kannadaRegularUrl, kannadaBoldUrl] },
  { name: 'gujarati', pattern: /[\u0A80-\u0AFF]/, urls: [gujaratiRegularUrl, gujaratiBoldUrl] },
]
let fontBytesPromise

async function getFontBytes() {
  if (!fontBytesPromise) fontBytesPromise = Promise.all(fontScripts.flatMap(script => script.urls).map(async (url) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Local PDF font could not be loaded.')
    return response.arrayBuffer()
  })).catch(error => { fontBytesPromise = undefined; throw error })
  return fontBytesPromise
}

export async function embedUnicodeFonts(pdf) {
  pdf.registerFontkit(fontkit)
  const bytes = await getFontBytes()
  const scripts = Object.fromEntries(await Promise.all(fontScripts.map(async (script, index) => [script.name, {
    regular: await pdf.embedFont(bytes[index * 2], { subset: true }),
    bold: await pdf.embedFont(bytes[index * 2 + 1], { subset: true }),
  }])))
  return { ...scripts.devanagari, scripts }
}

function selectFont(character, font, fonts, previousFont) {
  if (/[\u200C\u200D]/.test(character) && previousFont) return previousFont
  const script = fontScripts.find(entry => entry.pattern.test(character))
  const family = script && (fonts.scripts?.[script.name] || (script.name === 'devanagari' ? fonts : null))
  return family ? (font === fonts.baseBold ? family.bold : family.regular) : font
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
    const selectedFont = selectFont(character, font, fonts, currentFont)
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
    const selectedFont = selectFont(character, font, fonts, runFont)
    if (runFont && selectedFont !== runFont) flush()
    runFont = selectedFont
    if (selectedFont === font) {
      try { font.encodeText(character); run += character } catch { run += '?' }
    } else run += character
  }
  flush()
  return width
}
