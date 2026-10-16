import 'regenerator-runtime/runtime.js';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import { describe, expect, it } from 'vitest';

describe('Indic PDF font outlines', () => {
  const scripts = [
    ['bengali', 'মোট আয় 420'],
    ['tamil', 'மொத்த வருவாய் 420'],
    ['telugu', 'మొత్తం ఆదాయం 420'],
    ['kannada', 'ಒಟ್ಟು ಆದಾಯ 420'],
    ['gujarati', 'કુલ આવક 420'],
  ];
  it.each(scripts)('shapes visible %s glyphs in regular and bold without empty letter outlines', async (script, sample) => {
    for (const [weight, name] of [[400, 'Regular'], [700, 'Bold']]) {
      const path = script === 'telugu'
        ? `../assets/fonts/NotoSansTelugu-${name}.ttf`
        : `../../node_modules/@fontsource/noto-sans-${script}/files/noto-sans-${script}-${script}-${weight}-normal.woff`;
      const font = fontkit.create(new Uint8Array(await readFile(new URL(path, import.meta.url))));
      const scriptText = sample.replace(/[\u0000-\u007F]/g, '');
      for (const character of scriptText) expect(font.hasGlyphForCodePoint(character.codePointAt(0))).toBe(true);
      const shaped = font.layout(scriptText);
      expect(shaped.glyphs.length).toBeGreaterThan(0);
      for (const glyph of shaped.glyphs) {
        if (glyph.codePoints.some(codePoint => !/\s/.test(String.fromCodePoint(codePoint)))) expect(glyph.path.commands.length).toBeGreaterThan(0);
      }
    }
  });
});
