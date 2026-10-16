import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_LANGUAGES, LANGUAGE_NAMES, OCR_LANGUAGES } from '../../shared/languages';
import { answerDocument, summarizeDocument } from './documentAi';

describe('language coverage', () => {
  it('gives every translation/reply language its actual OCR language and English mixed option', () => {
    expect(LANGUAGE_NAMES).toHaveLength(8);
    for (const { name, ocr } of DOCUMENT_LANGUAGES) {
      expect(OCR_LANGUAGES[name]).toBe(ocr);
      if (name !== 'English') expect(OCR_LANGUAGES[`English + ${name}`]).toBe(`eng+${ocr}`);
    }
    expect(OCR_LANGUAGES).toMatchObject({ Spanish: 'spa', French: 'fra', German: 'deu', Portuguese: 'por', Italian: 'ita' });
  });
});

describe('multilingual document AI orchestration', () => {
  it('includes all small-document text even with no literal cross-language matches', async () => {
    const pages = [{ page: 1, text: 'The company sells pens.' }, { page: 2, text: 'Revenue was INR 420000.' }];
    const request = vi.fn(async () => ({ answer: 'उत्तर [p. 2]', sources: [] }));
    await answerDocument({ pages, question: 'महसूल किती होता?', language: 'Marathi', request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1].sections.map((section) => section.page).sort()).toEqual([1, 2]);
    expect(request.mock.calls[0][1].language).toBe('Marathi');
  });
  it('lets AI find distant evidence across every long-document section', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ page: i + 1, text: i === 29 ? 'The annual revenue is 420000 rupees.' : `Background material from chapter ${i + 1}.` }));
    const request = vi.fn(async (_, body) => body.phase === 'evidence'
      ? { matches: body.sections.filter((section) => section.page === 30).map((section) => ({ id: section.id, quote: section.text, relevance: 5 })) }
      : { answer: 'Los ingresos son 420000 rupias [p. 30].', sources: [{ page: 30, quote: pages[29].text }] });
    const history = [{ role: 'user', content: 'Explain the annual report' }];
    const answer = await answerDocument({ pages, question: '¿Cuáles son los ingresos?', language: 'Spanish', history, request });
    expect(answer.sources[0].page).toBe(30);
    const scanned = request.mock.calls.filter(([, body]) => body.phase === 'evidence').flatMap(([, body]) => body.sections);
    expect(new Set(scanned.map((section) => section.id)).size).toBe(30);
    expect(request.mock.calls.at(-1)[1].sections[0].page).toBe(30);
    expect(request.mock.calls.every(([, body]) => body.language === 'Spanish' && body.history === history)).toBe(true);
  });
  it('reviews each source section and the final summary without dropping original page labels', async () => {
    const pages = [{ page: 3, text: 'Revenue was 420000.' }, { page: 7, text: 'Profit was 84000.' }];
    const request = vi.fn(async (_, body) => ({ text: body.stage === 'review' ? `Corrected ${body.draft}` : body.stage === 'final' ? 'Combined summary [p. 3] [p. 7]' : `Notes ${body.text}` }));
    const result = await summarizeDocument({ pages, length: 'short', format: 'key-points', language: 'Hindi', request });
    expect(result).toMatch(/^Corrected Combined/);
    const reviewCalls = request.mock.calls.filter(([, body]) => body.stage === 'review');
    expect(reviewCalls).toHaveLength(3);
    expect(reviewCalls[0][1].text).toContain('[Page 3]\nRevenue was 420000.');
    expect(reviewCalls.at(-1)[1].text).toContain('[Page 7]');
    expect(request.mock.calls.every(([, body]) => body.language === 'Hindi')).toBe(true);
  });
});
