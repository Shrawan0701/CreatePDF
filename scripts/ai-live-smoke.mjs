// Opt-in: makes real, billable OpenAI requests using a small synthetic document.
import assert from 'node:assert/strict';
import { runTask as runAiTask } from '../server/ai.js';
try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.OPENAI_API_KEY?.trim()) throw new Error('Set OPENAI_API_KEY in .env.local before running live AI checks.');
const runTask = (task, body) => runAiTask(task, body, process.env.AI_LIVE_DEBUG === '1' ? { fetchImpl: async (...args) => {
  const response = await fetch(...args);
  const output = await response.clone().json();
  console.log('Synthetic-document model output:', output.choices?.[0]?.message?.content || 'No model output.');
  return response;
} } : undefined);
const text = 'Project Cedar annual report. Annual revenue was INR 420,000. Profit was INR 84,000. The factory is in Pune. The report does not state employee salaries.';
const source = [{ id: '2-0', page: 2, text }];
const digits = (value) => value.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x0966));

if (!['summary', 'unsupported'].includes(process.env.AI_LIVE_FOCUS)) {
console.log('Testing real OpenAI multilingual evidence selection…');
const evidence = await runTask('chat', { phase: 'evidence', language: 'Spanish', question: '¿Cuáles fueron los ingresos anuales?', sections: [{ id: '1-0', page: 1, text: 'This section describes stationery products and packaging.' }, ...source] });
assert.ok(evidence.matches.some((match) => match.id === '2-0'));
console.log('Cross-language evidence selection passed.');

const answer = await runTask('chat', { question: 'वार्षिक महसूल किती होता?', language: 'Marathi', sections: source });
console.log(`Marathi answer source count: ${answer.sources.length}`);
assert.ok(/[\u0900-\u097f]/.test(answer.answer));
assert.ok(answer.sources.some((entry) => entry.page === 2 && text.includes(entry.quote)));
assert.match(digits(answer.answer), /420[,. ]?000/);
console.log(`Reviewed Marathi answer: ${answer.answer}`);

const followup = await runTask('chat', { question: 'और लाभ कितना था?', language: 'Hindi', sections: source, history: [{ role: 'user', content: 'वार्षिक महसूल किती होता?' }, { role: 'assistant', content: answer.answer }] });
assert.ok(/[\u0900-\u097f]/.test(followup.answer));
assert.match(digits(followup.answer), /84[,. ]?000/);
assert.ok(followup.sources.length);
console.log(`Reviewed Hindi follow-up: ${followup.answer}`);
if (process.env.AI_LIVE_FOCUS === 'chat') { console.log('Live chat checks passed.'); process.exit(0); }

const translation = await runTask('translate', { source: 'English', target: 'Marathi', blocks: [{ id: 't1', text: 'Annual revenue was INR 420,000. Profit was INR 84,000.' }] });
assert.ok(/[\u0900-\u097f]/.test(translation.blocks[0].text));
assert.match(digits(translation.blocks[0].text), /420[,. ]?000/);
console.log(`Reviewed translation: ${translation.blocks[0].text}`);
}

if (process.env.AI_LIVE_FOCUS !== 'unsupported') {
const summaryBody = { text: `[Page 2]\n${text}`, sourcePages: [2], language: 'Hindi', length: 'short', format: 'key-points' };
const draft = await runTask('summarize', { ...summaryBody, stage: 'final' });
const summary = await runTask('summarize', { ...summaryBody, stage: 'review', draft: draft.text });
console.log(`Reviewed Hindi summary: ${summary.text}`);
assert.ok(/[\u0900-\u097f]/.test(summary.text));
assert.match(digits(summary.text), /420[,. ]?000/);
assert.match(summary.text, /\[p\.\s*2\]/);
}

const missing = await runTask('chat', { question: 'Quel est le salaire du directeur ?', language: 'French', sections: source });
assert.ok(missing.sources.every((entry) => entry.page === 2 && text.includes(entry.quote)));
assert.match(missing.answer, /pas|aucun|impossible/i);
assert.doesNotMatch(digits(missing.answer), /420[,. ]?000|84[,. ]?000/);
console.log(`French response to an unsupported question: ${missing.answer}`);
console.log('Unsupported question correctly declined in French. Live AI checks passed.');
