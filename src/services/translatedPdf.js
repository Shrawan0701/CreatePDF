import { getPdfLib, withPdfDocument } from './pdfEngine';
import { drawUnicodeText, embedUnicodeFonts, measureUnicodeText } from './unicodePdf';

export function translationRegions(items) {
  const lines = [];
  for (const item of [...items].sort((first, second) => first.y - second.y || first.x - second.x)) {
    const line = lines.find(entry => Math.abs(entry.y - item.y) < Math.max(2, item.size * .25) && Math.abs(entry.angle - (item.angle || 0)) < .05);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, angle: item.angle || 0, items: [item] });
  }
  return lines.flatMap(line => {
    const regions = [];
    const lineSize = Math.max(...line.items.map(item => item.size));
    for (const item of line.items.sort((first, second) => first.x - second.x)) {
      const previous = regions.at(-1);
      const spacedScript = /[\u0900-\u0DFF]/.test(`${previous?.text || ''}${item.text}`);
      const spacing = spacedScript || item.size < lineSize * .75 ? Math.min(lineSize, 14) * 1.4 : item.size * .85;
      if (previous && !line.angle && item.x - (previous.x + previous.width) < Math.max(3, spacing)) {
        previous.text += ` ${item.text}`;
        previous.width = item.x + item.width - previous.x;
        previous.size = Math.max(previous.size, item.size);
        previous.items.push(item);
      } else regions.push({ ...item, items: [item] });
    }
    return regions;
  });
}

function wrapTranslation(text, width, size, region, measure, breakWords = false) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (measure(word, size, region) > width) {
      if (!breakWords) return null;
      if (line) { lines.push(line); line = ''; }
      const characters = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word);
      for (const { segment } of characters) {
        if (measure(segment, size, region) > width) return null;
        if (line && measure(line + segment, size, region) > width) { lines.push(line); line = ''; }
        line += segment;
      }
    } else {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate, size, region) > width) { lines.push(line); line = word; }
      else line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function layoutTranslatedText(regions, pageWidth, pageHeight, measure, { preserveUnchanged = false } = {}) {
  const margin = Math.max(0, Math.min(pageWidth * .1, ...regions.map(region => region.x)));
  const contentRight = Math.min(pageWidth, Math.max(pageWidth - margin, ...regions.map(region => region.x + region.width)));
  return regions.map(region => {
    if (preserveUnchanged && region.translated === region.text) return { region, x: region.x, y: region.y, size: region.size, lines: [], lineHeight: region.size * 1.15 };
    const text = region.translated.replace(/\s+/g, ' ').trim();
    const sameLine = regions.filter(other => Math.abs(other.y - region.y) <= Math.max(2, Math.min(other.size, region.size) * .35) && Math.abs((other.angle || 0) - (region.angle || 0)) < .05);
    const lineSize = Math.max(...sameLine.map(other => other.size));
    const baseSize = lineSize <= 14 && (region.size < 7 || region.size < lineSize * .85) ? Math.max(8, lineSize) : region.size;
    const minimumSize = Math.min(baseSize, Math.max(7, baseSize * .8));
    const siblings = sameLine.filter(other => other !== region).sort((first, second) => first.x - second.x);
    const previous = siblings.filter(other => other.x < region.x).at(-1);
    const next = siblings.find(other => other.x > region.x);
    const padding = Math.max(1, baseSize * .15);
    const left = previous ? Math.min(region.x, (previous.x + previous.width + region.x) / 2 + padding) : margin;
    const right = next ? Math.max(region.x + region.width, (region.x + region.width + next.x) / 2 - padding) : contentRight;
    const width = Math.max(region.width, right - left);
    const below = regions.filter(other => other.y > region.y + baseSize * .4 && other.x < right && other.x + other.width > left);
    const nextBaseline = Math.min(pageHeight, ...below.map(other => other.y));
    const descent = Math.max(0, Math.min((nextBaseline - region.y) * .5 - baseSize * .2, pageHeight - region.y - baseSize * .3));
    const position = (lines, size) => {
      const measured = Math.max(0, ...lines.map(line => measure(line, size, region)));
      const center = region.x + region.width / 2;
      let horizontal = region.x;
      if (Math.abs(center - pageWidth / 2) < baseSize) horizontal = center - measured / 2;
      else if (Math.abs(region.x + region.width - contentRight) < baseSize) horizontal = region.x + region.width - measured;
      const x = Math.max(left, Math.min(horizontal, right - measured));
      return { region, x, y: region.y, size, lines, lineHeight: size * 1.15 };
    };
    if (!text) return position([], baseSize);
    if (region.angle) {
      const size = Math.min(baseSize, baseSize * region.width / measure(text, baseSize, region));
      if (size >= minimumSize) return { ...position([text], size), x: region.x };
    } else {
      for (let size = baseSize; size >= minimumSize - .001; size = Math.max(minimumSize, size - .25)) {
        const lines = wrapTranslation(text, width, size, region, measure);
        const maxLines = Math.min(3, 1 + Math.floor(descent / (size * 1.15)));
        if (lines && lines.length <= maxLines) return position(lines, size);
        if (size === minimumSize) break;
      }
      const lines = wrapTranslation(text, width, minimumSize, region, measure, true);
      if (lines && lines.length <= Math.min(3, 1 + Math.floor(descent / (minimumSize * 1.15)))) return position(lines, minimumSize);
    }
    throw new Error('Some translated text cannot fit readably in this layout. Use the original PDF rather than an already reduced copy.');
  });
}

function eraseScannedText(context, items, scaleX, scaleY) {
  for (const item of items) {
    const left = Math.max(0, Math.floor(item.x * scaleX) - 1);
    const top = Math.max(0, Math.floor(item.top * scaleY) - 1);
    const width = Math.min(context.canvas.width - left, Math.ceil(item.width * scaleX) + 2);
    const height = Math.min(context.canvas.height - top, Math.ceil(item.height * scaleY) + 2);
    const samples = [[left, Math.max(0, top - 2)], [Math.min(context.canvas.width - 1, left + width), top], [left, Math.min(context.canvas.height - 1, top + height)]];
    const colors = samples.map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3));
    const background = [0, 1, 2].map(channel => colors.map(color => color[channel]).sort((first, second) => first - second)[1]);
    context.fillStyle = `rgb(${background.join(',')})`;
    context.fillRect(left, top, width, height);
  }
}

export async function translatedLayoutPdf(file, pages, { title, signal, onStatus = () => {}, onProgress = () => {} } = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await getPdfLib();
  const output = await PDFDocument.create();
  if (title) output.setTitle(title);
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const mono = await output.embedFont(StandardFonts.Courier);
  const fonts = { ...await embedUnicodeFonts(output), baseBold: bold };
  await withPdfDocument(file, async (source, pdfjs) => {
    for (const translated of pages) {
      signal?.throwIfAborted();
      onStatus(`Preserving layout on page ${translated.page} of ${pages.length}…`);
      const original = await source.getPage(translated.page);
      const viewport = original.getViewport({ scale: Math.min(2, 3200 / Math.max(translated.width, translated.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      try {
        const context = canvas.getContext('2d');
        const textOperators = new Set([pdfjs.OPS.showText, pdfjs.OPS.showSpacedText, pdfjs.OPS.nextLineShowText, pdfjs.OPS.nextLineSetSpacingShowText]);
        await original.render({ canvasContext: context, viewport, operationsFilter: translated.ocr ? undefined : (index, operators) => !textOperators.has(operators.fnArray[index]) }).promise;
        signal?.throwIfAborted();
        if (translated.ocr) eraseScannedText(context, translated.regions.filter(region => region.translated !== region.text).flatMap(region => region.items), viewport.width / translated.width, viewport.height / translated.height);
        const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!imageBlob) throw new Error('Could not preserve the original page artwork.');
        const background = await output.embedPng(await imageBlob.arrayBuffer());
        const page = output.addPage([translated.width, translated.height]);
        page.drawImage(background, { x: 0, y: 0, width: translated.width, height: translated.height });
        const fontFor = region => /bold|black/i.test(region.fontFamily) ? bold : /mono|courier/i.test(region.fontFamily) ? mono : regular;
        const placements = layoutTranslatedText(translated.regions, translated.width, translated.height, (text, size, region) => measureUnicodeText(text, fontFor(region), size, fonts), { preserveUnchanged: translated.ocr });
        for (const placement of placements) {
          const { region, x, y, size, lines, lineHeight } = placement;
          if (translated.ocr && region.translated === region.text) continue;
          for (const [index, text] of lines.entries()) drawUnicodeText(page, text, { x, y: translated.height - y - index * lineHeight, size, font: fontFor(region), color: rgb(0, 0, 0), rotate: degrees(-region.angle * 180 / Math.PI) }, fonts);
        }
      } finally { canvas.width = canvas.height = 0; original.cleanup(); }
      onProgress(translated.page / pages.length * 100);
    }
  });
  signal?.throwIfAborted();
  return new Blob([await output.save()], { type: 'application/pdf' });
}
