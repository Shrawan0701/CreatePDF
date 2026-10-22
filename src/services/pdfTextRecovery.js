import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { embedUnicodeFonts } from './unicodePdf';

const check = signal => { if (signal?.aborted) throw new DOMException('Repair cancelled.', 'AbortError'); };
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
const fontHeight = item => Math.max(Math.hypot(item.transform[2], item.transform[3]), 1);

// Keep drawing order: sorting overlapping paragraphs by Y would interleave them.
// Only identical runs at the same origin/scale are duplicates. Repeated words at
// different positions (including page headers) are retained.
function recoverLines(content, order, viewport) {
  const locations = new Map();
  let items = [];
  let duplicates = 0;
  for (const item of content.items) {
    if (typeof item.str !== 'string' || !item.str.trim()) continue;
    if (!item.transform?.every(Number.isFinite)) throw new Error('Text positions could not be decoded.');
    const [a, b, c, d, x, y] = item.transform;
    const cx = Math.floor(x), cy = Math.floor(y);
    let duplicate = false;
    for (let dx = -1; dx <= 1 && !duplicate; dx++) for (let dy = -1; dy <= 1 && !duplicate; dy++) {
      const bucket = locations.get(`${item.str}\0${cx + dx},${cy + dy}`) || [];
      duplicate = bucket.some(previous => Math.abs(previous.transform[4] - x) <= .65
        && Math.abs(previous.transform[5] - y) <= .65
        && [a, b, c, d].every((value, index) => Math.abs(value - previous.transform[index]) <= .02));
    }
    if (duplicate) { duplicates++; continue; }
    const key = `${item.str}\0${cx},${cy}`;
    if (!locations.has(key)) locations.set(key, []);
    locations.get(key).push(item);
    items.push(item);
  }
  if (order === 'position') {
    // This option is useful for files whose drawing order is scrambled. Use a
    // strict sort, then group baselines separately (no non-transitive comparator).
    const positions = new Map(items.map(item => [item, viewport.convertToViewportPoint(item.transform[4], item.transform[5])]));
    items.sort((a, b) => positions.get(a)[1] - positions.get(b)[1] || positions.get(a)[0] - positions.get(b)[0]);
    const rows = [];
    for (const item of items) {
      const row = rows.at(-1);
      const y = positions.get(item)[1];
      if (row && Math.abs(row.y - y) <= .8) row.items.push(item);
      else rows.push({ y, items: [item] });
    }
    items = rows.flatMap(row => row.items.sort((a, b) => positions.get(a)[0] - positions.get(b)[0]));
  }
  const lines = [];
  let current = '', previous;
  for (const item of items) {
    const text = item.str.replace(/[\r\n\t\f]/g, ' ');
    if (previous) {
      const t = previous.transform, u = item.transform;
      const length = Math.hypot(t[0], t[1]) || 1, ux = t[0] / length, uy = t[1] / length;
      const dx = u[4] - t[4], dy = u[5] - t[5];
      const gap = dx * ux + dy * uy - Math.abs(previous.width || 0);
      const baseline = Math.abs(-dx * uy + dy * ux);
      const height = Math.min(fontHeight(previous), fontHeight(item));
      if (previous.hasEOL || baseline > Math.max(.8, height * .1) || gap < -height * .2 || gap > height * 2) {
        if (current.trim()) lines.push(current.trim());
        current = '';
      } else if (gap > height * .1 && !/\s$/.test(current) && !/^\s/.test(text)) current += ' ';
    }
    current += text;
    previous = item;
  }
  if (current.trim()) lines.push(current.trim());
  return { lines, duplicates };
}

async function makeTextWriter(pdf) {
  const base = await pdf.embedFont(StandardFonts.Helvetica);
  let unicode;
  // Wrapping normalizes whitespace to ASCII spaces, including PDFs that use
  // non-breaking spaces exclusively.
  const fonts = new Map([[' ', base]]);
  const scriptFonts = [
    [/^[\u0900-\u097f\u20b9]$/, 'devanagari'], [/^[\u0980-\u09ff]$/, 'bengali'],
    [/^[\u0b80-\u0bff]$/, 'tamil'], [/^[\u0c00-\u0c7f]$/, 'telugu'],
    [/^[\u0c80-\u0cff]$/, 'kannada'], [/^[\u0a80-\u0aff]$/, 'gujarati'],
  ];
  const prepare = async text => {
    for (const character of text) {
      if (fonts.has(character)) continue;
      try { base.encodeText(character); fonts.set(character, base); continue; } catch { /* Try the bundled script fonts. */ }
      unicode ??= await embedUnicodeFonts(pdf);
      const family = scriptFonts.find(([pattern]) => pattern.test(character));
      const candidate = family ? unicode.scripts[family[1]].regular : unicode.regular;
      if (!candidate.getCharacterSet().includes(character.codePointAt(0))) {
        throw new Error(`Cannot safely reproduce character U+${character.codePointAt(0).toString(16).toUpperCase()}. The page was not replaced with missing letters.`);
      }
      fonts.set(character, candidate);
    }
  };
  const runs = text => {
    const result = [];
    for (const character of text) {
      const previous = result.at(-1), font = fonts.get(character);
      if (previous?.font === font) previous.text += character;
      else result.push({ text: character, font });
    }
    return result;
  };
  const width = (text, size) => runs(text).reduce((sum, run) => sum + run.font.widthOfTextAtSize(run.text, size), 0);
  const draw = (page, text, x, y, size) => {
    for (const run of runs(text)) {
      page.drawText(run.text, { x, y, size, font: run.font, color: rgb(.12, .15, .18) });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  return { base, prepare, width, draw };
}

function wrapLine(text, writer, size, maxWidth) {
  const result = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    if (line && writer.width(`${line} ${word}`, size) > maxWidth) { result.push(line); line = ''; }
    if (writer.width(word, size) > maxWidth) {
      const graphemes = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), entry => entry.segment)
        : Array.from(word);
      for (const character of graphemes) {
        if (line && writer.width(line + character, size) > maxWidth) { result.push(line); line = ''; }
        line += character;
      }
    } else line += `${line ? ' ' : ''}${word}`;
  }
  if (line) result.push(line);
  return result;
}

export async function recoverReadableText(source, { signal, onProgress, textOrder = 'content' }) {
  const output = await PDFDocument.create();
  output.setTitle('Recovered readable text'); output.setCreator('CreatePDF.tech');
  const writer = await makeTextWriter(output);
  const recoveredPages = [], skippedPages = [], pageSources = [];
  let duplicateRuns = 0, recoveredCharacters = 0, sourceSignatureCount = 0;
  try { sourceSignatureCount = (await source.getSignatures())?.length || 0; } catch { /* Damaged signatures may be unreadable. */ }
  for (let number = 1; number <= source.numPages; number++) {
    check(signal); await pause();
    onProgress?.(8 + (number - 1) / source.numPages * 44, `Recovering text on page ${number} of ${source.numPages}…`);
    let page, extracted;
    try {
      page = await source.getPage(number);
      extracted = recoverLines(await page.getTextContent(), textOrder, page.getViewport({ scale: 1 }));
      if (!extracted.lines.length) throw new Error('No selectable text. Image-only pages need OCR; images and graphics are not copied in this mode.');
      if (extracted.lines.some(line => /\ufffd/.test(line))) throw new Error('The PDF text encoding contains unreadable characters. Original letters cannot be inferred safely.');
      // Validate fonts before adding any output page for this source page.
      await writer.prepare(extracted.lines.join(' '));
    } catch (failure) {
      check(signal); skippedPages.push({ page: number, reason: failure.message || 'Text could not be extracted.' });
      continue;
    } finally { page?.cleanup(); }
    check(signal);
    const width = 595.28, height = 841.89, margin = 48, size = 11, lineHeight = 17;
    let target, y;
    const addPage = () => {
      target = output.addPage([width, height]); pageSources.push(number); y = height - 88;
      target.drawText(`Recovered text | Source page ${number}`, { x: margin, y: height - 42, size: 9, font: writer.base, color: rgb(.4, .45, .48) });
      target.drawText(`${output.getPageCount()}`, { x: margin, y: 27, size: 9, font: writer.base, color: rgb(.4, .45, .48) });
    };
    addPage();
    for (let index = 0; index < extracted.lines.length; index++) {
      if (index % 50 === 0) { check(signal); await pause(); }
      for (const line of wrapLine(extracted.lines[index], writer, size, width - margin * 2)) {
        if (y < margin + size) addPage();
        writer.draw(target, line, margin, y, size); y -= lineHeight;
      }
    }
    recoveredPages.push(number); duplicateRuns += extracted.duplicates;
    recoveredCharacters += extracted.lines.join('\n').length;
  }
  check(signal);
  if (!recoveredPages.length) throw new Error(`No text could be recovered. ${skippedPages[0]?.reason || 'Try Rebuild pages to preserve visible content.'}`);
  onProgress?.(55, 'Creating readable text PDF…');
  const bytes = await output.save({ useObjectStreams: true });
  check(signal);
  return { blob: new Blob([bytes], { type: 'application/pdf' }), sourcePages: source.numPages, outputPages: pageSources.length,
    recoveredPages, skippedPages, pageSources, duplicateRuns, recoveredCharacters, sourceSignatureCount, textOrder };
}
