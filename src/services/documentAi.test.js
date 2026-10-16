import { describe, expect, it, vi } from 'vitest';
import { DOCUMENT_LANGUAGES, LANGUAGE_NAMES, OCR_LANGUAGES } from '../../shared/languages';
import { answerDocument, summarizeDocument } from './documentAi';

describe('language coverage', () => {
  it('gives every translation/reply language its actual OCR language and English mixed option', () => {
    expect(LANGUAGE_NAMES).toHaveLength(13);
    for (const { name, ocr } of DOCUMENT_LANGUAGES) {
      expect(OCR_LANGUAGES[name]).toBe(ocr);
      if (name !== 'English') expect(OCR_LANGUAGES[`English + ${name}`]).toBe(`eng+${ocr}`);
    }
    expect(OCR_LANGUAGES).toMatchObject({ Spanish: 'spa', French: 'fra', German: 'deu', Portuguese: 'por', Italian: 'ita', Bengali: 'ben', Tamil: 'tam', Telugu: 'tel', Kannada: 'kan', Gujarati: 'guj' });
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
  it('summarizes small documents together and reviews against all original page labels', async () => {
    const pages = [{ page: 3, text: 'Revenue was 420000.' }, { page: 7, text: 'Profit was 84000.' }];
    const request = vi.fn(async (_, body) => ({ text: body.stage === 'review' ? `Corrected ${body.draft}` : body.stage === 'final' ? 'Combined summary [p. 3] [p. 7]' : `Notes ${body.text}` }));
    const result = await summarizeDocument({ pages, length: 'short', format: 'key-points', language: 'Hindi', request });
    expect(result).toMatch(/^Corrected Combined/);
    const reviewCalls = request.mock.calls.filter(([, body]) => body.stage === 'review');
    expect(request).toHaveBeenCalledTimes(2);
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0][1].text).toContain('[Page 3]\nRevenue was 420000.');
    expect(reviewCalls.at(-1)[1].text).toContain('[Page 7]');
    expect(request.mock.calls.every(([, body]) => body.language === 'Hindi')).toBe(true);
  });
  it('keeps section reviews for documents too large for one source request', async () => {
    const pages = [{ page: 3, text: 'Revenue was 420000. '.repeat(500) }, { page: 7, text: 'Profit was 84000. '.repeat(500) }];
    const request = vi.fn(async (_, body) => ({ text: body.stage === 'review' ? `Checked ${body.draft}` : body.stage === 'final' ? 'Final summary [p. 3] [p. 7]' : body.stage === 'combine' ? 'Combined notes [p. 3] [p. 7]' : `Notes ${body.text}` }));
    const text = await summarizeDocument({ pages, length: 'short', format: 'key-points', language: 'Marathi', request });
    expect(text).toContain('Final summary');
    expect(request.mock.calls.filter(([, body]) => body.stage === 'section')).toHaveLength(4);
    expect(request.mock.calls.filter(([, body]) => body.stage === 'review')).toHaveLength(5);
    expect(request.mock.calls.at(-1)[1].sourcePages).toEqual([3, 7]);
  });
  it('continues with readable pages without inventing content from blank or unreadable pages', async () => {
    const pages = [{ page: 1, text: 'Revenue was 420.' }, { page: 2, text: '', blank: true }, { page: 3, text: 'garbled image', readIssue: 'unreadable' }, { page: 4, text: 'Profit was 84.', readIssue: 'uncertain' }];
    const request = vi.fn(async () => ({ text: 'महसूल 420 आणि नफा 84 होता. [p. 1] [p. 4]' }));
    const result = await summarizeDocument({ pages, length: 'medium', format: 'executive', language: 'Marathi', request });
    expect(result).toContain('महसूल');
    expect(request.mock.calls[0][1]).toMatchObject({ sourcePages: [1, 4], language: 'Marathi' });
    expect(request.mock.calls[0][1].text).not.toContain('garbled image');
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('automatically retries a transient generation failure once', async () => {
    const request = vi.fn(async () => ({ text: 'Summary [p. 1]' })).mockRejectedValueOnce(Object.assign(new Error('Temporary outage'), { status: 503 }));
    expect(await summarizeDocument({ pages: [{ page: 1, text: 'Revenue was 420.' }], length: 'short', format: 'executive', request })).toBe('Summary [p. 1]');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('keeps the generated summary if the optional final review remains unavailable', async () => {
    const request = vi.fn(async (_, body) => {
      if (body.stage === 'review') throw Object.assign(new Error('Temporary review outage'), { status: 502 });
      return { text: 'महसूल 420 होता. [p. 1]' };
    });
    expect(await summarizeDocument({ pages: [{ page: 1, text: 'Revenue was 420.' }], length: 'short', format: 'executive', language: 'Marathi', request })).toBe('महसूल 420 होता. [p. 1]');
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not invent a response when no source is readable or the API is unconfigured', async () => {
    const request = vi.fn(async () => { throw Object.assign(new Error('AI is not configured'), { status: 503 }); });
    await expect(summarizeDocument({ pages: [{ page: 1, text: '', blank: true }], length: 'short', format: 'executive', request })).rejects.toThrow('No readable content');
    expect(request).not.toHaveBeenCalled();
    await expect(summarizeDocument({ pages: [{ page: 1, text: 'Readable source.' }], length: 'short', format: 'executive', request })).rejects.toThrow('not configured');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
