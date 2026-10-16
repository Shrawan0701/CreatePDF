export async function callAi(task, body, signal) {
  const response = await fetch(`/api/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json().catch(() => { throw new Error('The API is unavailable. Run npm run dev locally or deploy with Vercel functions.'); });
  if (!response.ok) throw new Error(data.error || 'The AI request failed.');
  return data;
}

export { LANGUAGE_NAMES as TRANSLATION_LANGUAGES, REPLY_LANGUAGES, SUMMARY_LANGUAGES } from '../../shared/languages';
