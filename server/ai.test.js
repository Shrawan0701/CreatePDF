import { describe, expect, it, vi } from 'vitest';
import { complete, createHandler, runTask } from './ai';

const stub = (content, finish_reason = 'stop') => ({ apiKey: 'test-server-key', fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(content) } }] }) })) });

describe('shared OpenAI API', () => {
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
