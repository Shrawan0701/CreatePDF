import { describe, expect, it, vi } from 'vitest';
import { complete, createHandler, runTask } from './ai';

const stub = (content, finish_reason = 'stop') => ({ apiKey: 'test-server-key', fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] }) })) });

describe('shared OpenAI API', () => {
  it('repairs summary amounts that do not match the source before returning them', async () => {
    const options = stub({ text: 'बिर्याणी ₹1.00; पनीर ₹398.00; एकूण ₹399.00. [p. 1]' });
    options.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'बिर्याणी ₹31.00; पनीर ₹7398.00; एकूण ₹3399.00. [p. 1]' }) } }] }) });
    const input = { text: '[Page 1] Biryani ₹1.00; paneer ₹398.00; grand total ₹399.00.', sourcePages: [1], length: 'short', format: 'executive', stage: 'final', language: 'Marathi' };
    const result = await runTask('summarize', input, options);
    expect(result.text).toContain('₹399.00');
    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(JSON.parse(options.fetchImpl.mock.calls[1][1].body).messages[1].content).unsupportedFigures).toEqual(['31.00', '7398.00', '3399.00']);
    await expect(runTask('summarize', input, stub({ text: 'एकूण ₹3399.00. [p. 1]' }))).rejects.toThrow('figures could not be verified');
  });
  it('accepts localized Marathi source references without unnecessary repair requests', async () => {
    const options = stub({ text: 'पोर्टल विद्यार्थ्यांना नोकरीच्या संधी शोधण्यास मदत करते. [पृ. ५]' });
    const result = await runTask('summarize', { text: '[Page 5] The portal helps students find jobs.', sourcePages: [5], length: 'short', format: 'executive', stage: 'final', language: 'Marathi' }, options);
    expect(result.text).toContain('[p. 5]');
    expect(options.fetchImpl).toHaveBeenCalledTimes(1);
  });
  const addedLanguages = [
    ['Bengali', 'মোট আয় 420 ছিল।'],
    ['Tamil', 'மொத்த வருவாய் 420 ஆகும்.'],
    ['Telugu', 'మొత్తం ఆదాయం 420.'],
    ['Kannada', 'ಒಟ್ಟು ಆದಾಯ 420 ಆಗಿತ್ತು.'],
    ['Gujarati', 'કુલ આવક 420 હતી.'],
  ];
  const translationSamples = [
    ['English', 'Annual revenue was 420 in the report.'],
    ['Hindi', 'वार्षिक आय रिपोर्ट में 420 थी।'],
    ['Marathi', 'अहवालातील वार्षिक महसूल 420 होता.'],
    ...addedLanguages,
    ['Spanish', 'Los ingresos anuales fueron 420.'],
    ['French', 'Le revenu annuel était de 420.'],
    ['German', 'Der Jahresumsatz betrug 420.'],
    ['Portuguese', 'A receita anual foi de 420.'],
    ['Italian', 'Il fatturato annuale era di 420.'],
  ];
  const translationPairs = translationSamples.flatMap(([source, original]) => translationSamples.filter(([target]) => target !== source).map(([target, translated]) => ({ source, target, original, translated })));
  it.each(translationPairs)('keeps $target as the required target when translating from $source', async ({ source, target, original, translated }) => {
    const options = stub({ blocks: [{ id: '1', text: translated }] });
    const result = await runTask('translate', { source, target, blocks: [{ id: '1', text: original }] }, options);
    expect(result.blocks[0].text).toBe(translated);
    for (const [, request] of options.fetchImpl.mock.calls) {
      const body = JSON.parse(request.body);
      expect(body.messages[0].content).toContain(`REQUIRED OUTPUT LANGUAGE: ${target}`);
      expect(JSON.parse(body.messages[1].content)).toMatchObject({ source, target });
    }
  });
  it('repairs Hindi returned for an auto-detected source with an English target', async () => {
    const hindi = 'वार्षिक आय रिपोर्ट में 420 थी।';
    const options = stub({ blocks: [{ id: '1', text: 'Annual revenue was 420 in the report.' }] });
    options.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ blocks: [{ id: '1', text: hindi }] }) } }] }) });
    const result = await runTask('translate', { source: 'Auto-detect', target: 'English', blocks: [{ id: '1', text: hindi }] }, options);
    expect(result.blocks[0].text).toBe('Annual revenue was 420 in the report.');
    expect(JSON.parse(options.fetchImpl.mock.calls[1][1].body).messages[0].content).toContain('failed target-language validation');
    await expect(runTask('translate', { source: 'Auto-detect', target: 'English', blocks: [{ id: '1', text: hindi }] }, stub({ blocks: [{ id: '1', text: hindi }] }))).rejects.toThrow('not returned in English');
  });
  it.each(addedLanguages)('supports %s translation, grounded chat and summary language repair', async (language, nativeText) => {
    const blocks = [{ id: '1', text: 'Revenue was 420.' }];
    const translation = stub({ blocks: [{ id: '1', text: nativeText }] });
    expect((await runTask('translate', { source: 'English', target: language, blocks }, translation)).blocks[0].text).toBe(nativeText);
    await expect(runTask('translate', { source: language, target: 'English', blocks: [{ id: '1', text: nativeText }] }, stub({ blocks }))).resolves.toEqual({ blocks });
    const answer = { answer: `${nativeText} [p. 2]`, language, supported: true, sources: [{ page: 2, quote: blocks[0].text }] };
    expect((await runTask('chat', { question: 'What was revenue?', language, sections: [{ page: 2, text: blocks[0].text }] }, stub(answer))).answer).toContain(nativeText);
    const summary = stub({ text: `${nativeText} [p. 2]` });
    summary.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Revenue was 420. [p. 2]' }) } }] }) });
    const result = await runTask('summarize', { text: '[Page 2] Revenue was 420.', sourcePages: [2], length: 'short', format: 'executive', stage: 'final', language }, summary);
    expect(result.text).toContain(nativeText);
    expect(summary.fetchImpl).toHaveBeenCalledTimes(2);
    const unsupported = await runTask('chat', { question: 'What is missing?', language, sections: [{ page: 2, text: blocks[0].text }] }, stub({ answer: 'Not found.', language, supported: false, sources: [] }));
    expect(unsupported.sources).toEqual([]);
    expect(unsupported.answer).not.toMatch(/I could not verify/);
  });
  it('keeps the requested model server-side and handles missing configuration', async () => {
    const options = stub({ text: 'Result' });
    await complete('Return JSON', {}, options);
    const [url, request] = options.fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(JSON.parse(request.body)).toMatchObject({ model: 'gpt-4o-mini', store: false, response_format: { type: 'json_object' } });
    await expect(complete('JSON', {}, { apiKey: '' })).rejects.toMatchObject({ status: 503 });
  });
  it('rejects omitted translations and truncated model output', async () => {
    const input = { source: 'English', target: 'Marathi', blocks: [{ id: '1', text: 'hello' }] };
    await expect(runTask('translate', input, stub({ blocks: [] }))).rejects.toThrow('incomplete');
    await expect(runTask('translate', input, stub({ blocks: [{ id: '1', text: 'नमस्कार' }] }))).resolves.toEqual({ blocks: [{ id: '1', text: 'नमस्कार' }] });
    await expect(complete('JSON', {}, stub({}, 'length'))).rejects.toThrow('did not finish');
  });
  it('validates source citations against exact page text and rejects invented pages', async () => {
    const input = { question: 'What was revenue?', sections: [{ page: 2, text: 'Revenue was 420 million.' }] };
    const good = { answer: 'Revenue was 420 million [p. 2].', sources: [{ page: 2, quote: 'Revenue was 420 million.' }] };
    expect((await runTask('chat', input, stub(good))).sources).toHaveLength(1);
    expect((await runTask('chat', input, stub({ ...good, sources: [{ page: 7, quote: good.sources[0].quote }] }))).sources).toEqual([]);
    expect((await runTask('chat', input, stub({ ...good, answer: 'Revenue [p. 90].' }))).sources).toEqual([]);
  });
  it('rejects invalid summary formats before calling OpenAI', async () => {
    const options = stub({ text: 'summary' });
    await expect(runTask('summarize', { text: 'content', length: 'medium', format: 'invalid', stage: 'final' }, options)).rejects.toMatchObject({ status: 400 });
    expect(options.fetchImpl).not.toHaveBeenCalled();
  });
  it('returns actionable rate-limit errors and avoids upstream response disclosure', async () => {
    await expect(complete('JSON', {}, { apiKey: 'key', fetchImpl: async () => ({ ok: false, status: 429 }) })).rejects.toMatchObject({ status: 429 });
  });
  it('handles method and malformed input consistently for Vercel and Vite', async () => {
    const response = () => ({ headers: {}, setHeader(name, value) { this.headers[name] = value; }, end(value) { this.body = JSON.parse(value); } });
    const get = response(); await createHandler('translate')({ method: 'GET', headers: {} }, get); expect(get.statusCode).toBe(405);
    const invalid = response(); await createHandler('translate')({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }, invalid); expect(invalid.statusCode).toBe(400);
  });
  it('uses strict schemas and reviews translations against their original text', async () => {
    const options = stub({ blocks: [{ id: 'a', text: 'Le total est 420.' }] });
    await runTask('translate', { source: 'English', target: 'French', blocks: [{ id: 'a', text: 'Total is 420.' }] }, options);
    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse(options.fetchImpl.mock.calls[0][1].body);
    const review = JSON.parse(options.fetchImpl.mock.calls[1][1].body);
    expect(first.response_format).toMatchObject({ type: 'json_schema', json_schema: { name: 'translate', strict: true } });
    expect(JSON.parse(review.messages[1].content)).toMatchObject({ blocks: [{ id: 'a', text: 'Total is 420.' }], draft: [{ id: 'a', text: 'Le total est 420.' }] });
  });
  it('checks chat claims against sources again and preserves requested language', async () => {
    const options = stub({ answer: 'Le total est 420 [p. 4].', language: 'French', supported: true, sources: [{ page: 4, quote: 'Total is 420.' }] });
    await runTask('chat', { question: 'Quel est le total ?', language: 'French', sections: [{ id: '4-0', page: 4, text: 'Total is 420.' }] }, options);
    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
    const review = JSON.parse(options.fetchImpl.mock.calls[1][1].body);
    expect(review.messages[0].content).toContain('grounded answer review');
    expect(JSON.parse(review.messages[1].content).language).toBe('French');
  });
  it('verifies AI evidence IDs and quotes before forwarding them to the answer step', async () => {
    const result = await runTask('chat', { phase: 'evidence', language: 'Hindi', question: 'कुल कितना है?', sections: [{ id: 'real', page: 4, text: 'Grand total is 420 rupees.' }] }, stub({ matches: [{ id: 'real', quote: 'Grand total is 420 rupees.', relevance: 5 }, { id: 'invented', quote: 'Grand total is 420 rupees.', relevance: 5 }, { id: 'real', quote: 'The answer is 999.', relevance: 5 }] }));
    expect(result.matches).toEqual([{ id: 'real', quote: 'Grand total is 420 rupees.', relevance: 5 }]);
  });
  it('declines unsupported answers in the chosen language and rejects unlisted languages', async () => {
    const input = { question: 'What is missing?', language: 'Marathi', sections: [{ page: 1, text: 'Nothing relevant is stated.' }] };
    const result = await runTask('chat', input, stub({ answer: 'Not found.', language: 'Marathi', supported: false, sources: [] }));
    expect(result.answer).toContain('दस्तऐवजात'); expect(result.sources).toEqual([]);
    await expect(runTask('chat', { ...input, language: 'invented' }, stub({}))).rejects.toMatchObject({ status: 400 });
  });
  it('blocks summary page references absent from the actual source', async () => {
    await expect(runTask('summarize', { text: '[Page 2] Revenue was 420.', length: 'short', format: 'executive', stage: 'review', draft: 'Draft', language: 'English' }, stub({ text: 'Revenue was 420 [p. 99].' }))).rejects.toThrow('page absent');
  });
  it('uses physical source pages rather than page references printed inside a document', async () => {
    await expect(runTask('summarize', { text: '[Page 2] The bibliography mentions [p. 99].', sourcePages: [2], length: 'short', format: 'executive', stage: 'final', language: 'English' }, stub({ text: 'A finding [p. 99].' }))).rejects.toThrow('page absent');
  });
  it('repairs language drift and missing summary citations before returning output', async () => {
    const options = stub({ text: 'आय 420 है। [p. 2]' });
    options.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: 'Revenue is 420.' }) } }] }) });
    const result = await runTask('summarize', { text: '[Page 2] Revenue was 420.', sourcePages: [2], length: 'short', format: 'key-points', stage: 'final', language: 'Hindi' }, options);
    expect(result.text).toContain('आय');
    expect(options.fetchImpl).toHaveBeenCalledTimes(2);
    expect(JSON.parse(options.fetchImpl.mock.calls[1][1].body).messages[0].content).toContain('REQUIRED OUTPUT LANGUAGE: Hindi');
  });
  it('returns the fact-reviewed chat answer rather than its first draft', async () => {
    const source = { page: 2, quote: 'Revenue was 420.' };
    const options = stub({ answer: 'Revenue was 420 [p. 2].', supported: true, language: 'English', sources: [source] });
    options.fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ answer: 'Revenue was 999 [p. 2].', supported: true, language: 'English', sources: [source] }) } }] }) });
    const result = await runTask('chat', { question: 'What was revenue?', sections: [{ page: 2, text: source.quote }] }, options);
    expect(result.answer).toBe('Revenue was 420 [p. 2].');
  });
  it('renders omitted chat page markers from verified quotes and normalizes localized citation digits', async () => {
    const input = { question: 'महसूल किती?', language: 'Marathi', sections: [{ page: 2, text: 'Revenue was 420.' }] };
    const options = stub({ answer: 'महसूल 420 होता.', language: 'Marathi', supported: true, sources: [{ page: 2, quote: 'Revenue was 420.' }] });
    expect((await runTask('chat', input, options)).answer).toContain('[p. 2]');
    expect((await runTask('chat', input, stub({ answer: 'महसूल 420 होता. [पृ. २]', language: 'Marathi', supported: true, sources: [{ page: 2, quote: 'Revenue was 420.' }] }))).answer).toContain('[p. 2]');
  });
});
