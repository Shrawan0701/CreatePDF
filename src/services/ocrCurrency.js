const wordsIn = data => (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)));

export function currencyCandidates(data) {
  return wordsIn(data).filter(word => {
    const prefix = word.symbols?.[0];
    return prefix?.bbox && prefix.text.length === 1 && !/\p{Sc}/u.test(word.text)
      && word.text.startsWith(prefix.text) && /^[\p{Nd},.]+[.,]\p{Nd}{2}$/u.test(word.text.slice(1));
  });
}

export function verifiedCurrencyPrefix(word, data, scale, padding) {
  const prefix = word.symbols[0].bbox;
  const expectedLeft = (prefix.x0 - word.bbox.x0) * scale + padding;
  const expectedRight = (prefix.x1 - word.bbox.x0) * scale + padding;
  const tolerance = scale * 2;
  const symbol = wordsIn(data)[0]?.symbols?.[0];
  return symbol?.text === '₹' && symbol.confidence >= 50
    && Math.abs(symbol.bbox.x0 - expectedLeft) <= tolerance
    && Math.abs(symbol.bbox.x1 - expectedRight) <= tolerance;
}

export async function verifyCurrencySymbols(image, data, { recognize, signal }) {
  const candidates = currencyCandidates(data);
  if (!candidates.length) return;
  let bitmap, changed = false;
  try {
    const source = image instanceof Blob ? bitmap = await createImageBitmap(image) : image;
    for (const word of candidates) {
      signal?.throwIfAborted();
      const { x0, y0, x1, y1 } = word.bbox;
      const width = x1 - x0, height = y1 - y0;
      if (width <= 0 || height <= 0 || width > 1500 || height > 300) continue;
      for (const { mode, scale } of [{ mode: '7', scale: 3 }, { mode: '13', scale: 4 }]) {
        const padding = 20;
        const crop = document.createElement('canvas');
        try {
          crop.width = width * scale + padding * 2;
          crop.height = height * scale + padding * 2;
          const context = crop.getContext('2d');
          context.fillStyle = 'white';
          context.fillRect(0, 0, crop.width, crop.height);
          context.drawImage(source, x0, y0, width, height, padding, padding, width * scale, height * scale);
          const checked = await recognize(crop, mode);
          if (!verifiedCurrencyPrefix(word, checked.data, scale, padding)) continue;
          word.text = `₹${word.text.slice(1)}`;
          word.symbols[0].text = '₹';
          changed = true;
          break;
        } finally { crop.width = crop.height = 0; }
      }
    }
  } finally {
    if (changed) data.text = (data.blocks || []).flatMap(block => block.paragraphs.map(paragraph => paragraph.lines.map(line => line.words.map(word => word.text).join(' ')).join('\n'))).join('\n\n');
    bitmap?.close();
  }
}
