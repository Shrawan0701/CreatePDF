import { describe, expect, it } from 'vitest';
import { layoutTranslatedText, translationRegions } from './translatedPdf';

describe('translation layout regions', () => {
  const item = (text, x, y, width, size = 12) => ({ text, x, y, width, size, top: y - size, height: size, angle: 0 });

  it('keeps table columns separate while joining words within a cell', () => {
    const regions = translationRegions([
      item('399.00', 270, 120, 40), item('name', 120, 100, 30),
      item('Product', 70, 100, 45), item('Amount', 270, 100, 45),
      item('Rice', 70, 120, 30),
    ]);
    expect(regions.map(region => region.text)).toEqual(['Product name', 'Amount', 'Rice', '399.00']);
    expect(regions[0]).toMatchObject({ x: 70, y: 100, width: 80 });
    expect(regions[1]).toMatchObject({ x: 270, y: 100, width: 45 });
    expect(regions[0].items).toHaveLength(2);
  });

  it('retains OCR word boxes for removing scanned text without erasing table borders', () => {
    const words = [item('Grand', 50, 100, 30), item('total', 85, 100, 25)];
    const [region] = translationRegions(words);
    expect(region.items).toEqual(words);
    expect(region).toMatchObject({ text: 'Grand total', width: 60, top: 88, height: 12 });
  });

  it('does not merge text with different rotations or separate rows', () => {
    const regions = translationRegions([item('First', 50, 100, 30), { ...item('Vertical', 90, 100, 40), angle: Math.PI / 2 }, item('Second', 50, 120, 45)]);
    expect(regions).toHaveLength(3);
    expect(regions[1].angle).toBe(Math.PI / 2);
    expect(translationRegions([])).toEqual([]);
  });
});

describe('readable translated text fitting', () => {
  const measure = (text, size) => text.length * size * .5;
  const region = (text, translated, x, y, width, size = 10) => ({ text, translated, x, y, width, size, angle: 0 });

  it('uses unused space before reducing the original font size', () => {
    const regions = [region('कुल आय', 'Total Revenue', 50, 50, 25), region('आदेश', 'Orders', 200, 50, 35)];
    const [label] = layoutTranslatedText(regions, 350, 200, measure);
    expect(label.size).toBe(10);
    expect(label.lines).toEqual(['Total Revenue']);
    expect(label.x + measure(label.lines[0], label.size)).toBeLessThan(200);
  });

  it('wraps a longer label at full size inside available row space', () => {
    const regions = [region('#', '#', 20, 50, 15), region('कुल', 'Total Revenue', 50, 50, 25), region('संख्या', 'Qty', 110, 50, 30), region('अगली पंक्ति', 'Next row', 50, 100, 80)];
    const [, label] = layoutTranslatedText(regions, 200, 180, measure);
    expect(label.size).toBe(10);
    expect(label.lines).toEqual(['Total', 'Revenue']);
    expect(label.y + label.lineHeight).toBeLessThan(100);
  });

  it('restores tiny translated headers to the surrounding row font size', () => {
    const regions = [region('#', '#', 20, 50, 5, 8.5), region('Sales', 'Sales', 100, 50, 9, 3.7), region('Revenue', 'Revenue', 190, 50, 17, 4.2)];
    const placements = layoutTranslatedText(regions, 300, 200, measure);
    expect(placements.map(placement => placement.size)).toEqual([8.5, 8.5, 8.5]);
  });

  it('leaves unchanged scanned amounts untouched rather than refitting OCR guesses', () => {
    const numeric = region('399.00', '399.00', 50, 50, 10);
    const [placement] = layoutTranslatedText([numeric], 100, 100, measure, { preserveUnchanged: true });
    expect(placement.lines).toEqual([]);
  });

  it('does not silently reduce text to an unreadable size when the layout is impossible', () => {
    const narrow = region('a', 'AnExtremelyLongUnbrokenLabel', 10, 15, 5);
    expect(() => layoutTranslatedText([narrow], 20, 20, measure)).toThrow('cannot fit readably');
  });
});
