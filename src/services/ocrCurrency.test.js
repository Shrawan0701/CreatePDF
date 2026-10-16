import { afterEach, describe, expect, it, vi } from 'vitest';
import { currencyCandidates, verifiedCurrencyPrefix, verifyCurrencySymbols } from './ocrCurrency';

const pageData = words => ({ text: words.map(word => word.text).join(' '), blocks: [{ paragraphs: [{ lines: [{ words }] }] }] });
const amount = (text = '3399.00') => ({ text, confidence: 92, bbox: { x0: 10, y0: 20, x1: 80, y1: 40 }, symbols: [{ text: text[0], bbox: { x0: 10, y0: 20, x1: 20, y1: 40 } }] });
const verified = (scale = 3, text = '₹', right = 20 + 10 * scale) => ({ data: pageData([{ text, symbols: [{ text, confidence: 90, bbox: { x0: 20, y0: 20, x1: right, y1: 80 } }] }]) });

afterEach(() => vi.unstubAllGlobals());

describe('visual currency symbol verification', () => {
  it('only checks decimal amounts with individual symbol positions', () => {
    const words = [amount('31.00'), amount('7398.00'), amount('₹399.00'), amount('393949333'), amount('13/10/2026'), { text: '399.00' }];
    expect(currencyCandidates(pageData(words))).toEqual(words.slice(0, 2));
  });
  it('requires a confident rupee symbol matching exactly the original first glyph', () => {
    const word = amount();
    expect(verifiedCurrencyPrefix(word, verified().data, 3, 20)).toBe(true);
    expect(verifiedCurrencyPrefix(word, verified(3, '3').data, 3, 20)).toBe(false);
    expect(verifiedCurrencyPrefix(word, verified(3, '₹', 100).data, 3, 20)).toBe(false);
    const lowConfidence = verified().data;
    lowConfidence.blocks[0].paragraphs[0].lines[0].words[0].symbols[0].confidence = 30;
    expect(verifiedCurrencyPrefix(word, lowConfidence, 3, 20)).toBe(false);
  });
  const mockCanvas = () => {
    const context = { fillRect: vi.fn(), drawImage: vi.fn() };
    const canvases = [];
    vi.stubGlobal('document', { createElement: () => { const canvas = { getContext: () => context }; canvases.push(canvas); return canvas; } });
    return canvases;
  };
  it('corrects currency prefixes in both text and word positions without modifying any numeric digits', async () => {
    const canvases = mockCanvas();
    const data = pageData([amount('31.00'), amount('7398.00'), amount('3399.00')]);
    await verifyCurrencySymbols({}, data, { recognize: vi.fn(async () => verified()) });
    expect(data.text).toBe('₹1.00 ₹398.00 ₹399.00');
    expect(data.blocks[0].paragraphs[0].lines[0].words.map(word => word.text)).toEqual(['₹1.00', '₹398.00', '₹399.00']);
    expect(canvases.every(canvas => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });
  it('keeps genuine leading digits when independent recognition does not confirm currency', async () => {
    mockCanvas();
    const data = pageData([amount('3399.00')]);
    await verifyCurrencySymbols({}, data, { recognize: vi.fn(async () => verified(3, '3')) });
    expect(data.text).toBe('3399.00');
  });
  it('retries with raw-line recognition when the first pass merges currency and an adjacent digit', async () => {
    mockCanvas();
    const data = pageData([amount('31.00')]);
    const recognize = vi.fn().mockResolvedValueOnce(verified(3, '₹', 110)).mockResolvedValueOnce(verified(4));
    await verifyCurrencySymbols({}, data, { recognize });
    expect(recognize.mock.calls.map(call => call[1])).toEqual(['7', '13']);
    expect(data.text).toBe('₹1.00');
  });
  it('keeps corrected text and word items consistent if a later crop fails', async () => {
    mockCanvas();
    const data = pageData([amount('31.00'), amount('7398.00')]);
    const recognize = vi.fn().mockResolvedValueOnce(verified()).mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(verifyCurrencySymbols({}, data, { recognize })).rejects.toThrow('Network unavailable');
    expect(data.text).toBe('₹1.00 7398.00');
  });
});
