import { callAi } from './aiClient';
import { documentSections, retrieveSections, splitText } from './documentText';

export async function answerDocument({ pages, question, history = [], language = 'Same as question', signal, onStatus = () => {}, request = callAi }) {
  const all = documentSections(pages, 2600);
  let sections;
  if (all.length <= 14) {
    // Include the entire text for small documents, regardless of query language.
    sections = retrieveSections(pages, question, history, 14);
  } else {
    const matches = [];
    for (let start = 0; start < all.length; start += 7) {
      onStatus(`AI is reading document evidence: batch ${Math.floor(start / 7) + 1} of ${Math.ceil(all.length / 7)}…`);
      const result = await request('chat', { phase: 'evidence', question, history, language, sections: all.slice(start, start + 7) }, signal);
      matches.push(...result.matches);
    }
    const ranked = [...new Map(matches.sort((a, b) => b.relevance - a.relevance).map((match) => [match.id, match])).values()];
    const byId = new Map(all.map((section) => [section.id, section]));
    // Spread the strongest evidence across pages before filling remaining slots.
    const chosen = new Map(), perPage = new Map();
    for (const match of ranked) {
      const section = byId.get(match.id);
      if (section && (perPage.get(section.page) || 0) < 2 && chosen.size < 14) { chosen.set(section.id, section); perPage.set(section.page, (perPage.get(section.page) || 0) + 1); }
    }
    for (const match of ranked) { const section = byId.get(match.id); if (section && chosen.size < 14) chosen.set(section.id, section); }
    sections = chosen.size ? [...chosen.values()] : retrieveSections(pages, question, history, 14);
  }
  onStatus('Writing the answer and checking source references…');
  return request('chat', { phase: 'answer', question, history, language, sections }, signal);
}

export function packSections(sections, max = 17000) {
  const groups = []; let group = '';
  for (const section of sections.flatMap((value) => splitText(value, max))) { if (group && group.length + section.length + 2 > max) { groups.push(group); group = ''; } group += `${group ? '\n\n' : ''}${section}`; }
  if (group) groups.push(group);
  return groups;
}

export async function summarizeDocument({ pages, length, format, language = 'Same as document', signal, onStatus = () => {}, request = callAi }) {
  const readablePages = pages.filter(page => !page.blank && page.readIssue !== 'unreadable' && page.text.trim());
  const sections = documentSections(readablePages, 6500);
  if (!sections.length) throw new Error('No readable content was found for a summary. Try a clearer PDF or scan.');
  const sourcePages = [...new Set(readablePages.map(page => page.page))];
  const retryable = error => !signal?.aborted && error.name !== 'AbortError' && !/not configured|key was rejected|quota|billing/i.test(error.message) && (error instanceof TypeError || [408, 429, 500, 502, 503, 504].includes(error.status));
  const summarize = async body => {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        const response = await request('summarize', body, signal);
        if (typeof response?.text !== 'string' || !response.text.trim()) throw Object.assign(new Error('No summary was returned.'), { status: 502 });
        return response;
      } catch (error) {
        if (attempt || !retryable(error)) throw error;
        onStatus('Retrying summary automatically…');
      }
    }
  };
  const review = async (draft, text) => {
    if (draft.length > 14000) return draft;
    onStatus('Reviewing summary…');
    try { return (await summarize({ text, sourcePages, draft, length, format, stage: 'review', language })).text; }
    catch (error) { if (retryable(error)) return draft; throw error; }
  };
  const completeSource = sections.map(section => `[Page ${section.page}]\n${section.text}`).join('\n\n');
  if (completeSource.length <= 17000) {
    onStatus('Creating summary…');
    const draft = (await summarize({ text: completeSource, sourcePages, length, format, stage: 'final', language })).text;
    return review(draft, completeSource);
  }
  const notes = [];
  for (let i = 0; i < sections.length; i++) {
    onStatus(`Summarizing section ${i + 1} of ${sections.length}…`);
    const section = sections[i];
    const original = `[Page ${section.page}]\n${section.text}`;
    const summary = await summarize({ text: original, sourcePages: [section.page], length: sections.length === 1 ? length : 'detailed', format, stage: sections.length === 1 ? 'final' : 'section', language });
    // Source labels are attached by code, so they survive map/reduce even if the model omits them.
    let note = summary.text;
    if (sections.length > 1) {
      onStatus(`Checking section ${i + 1} against its source…`);
      note = (await summarize({ text: original, sourcePages: [section.page], draft: note, length: 'detailed', format, stage: 'review', language })).text;
    }
    notes.push(`[Page ${section.page}]\n${note}`);
  }
  let merged = notes;
  for (let level = 0; merged.join('\n\n').length > 17000; level++) {
    if (level >= 12) throw new Error('This document is too large to combine safely. Please split it into smaller documents.');
    const groups = packSections(merged);
    const next = [];
    for (let i = 0; i < groups.length; i++) {
      onStatus(`Combining summary groups: ${i + 1} of ${groups.length}…`);
      const groupPages = [...new Set([...groups[i].matchAll(/\[(?:Page\s+|p\.\s*)(\d+)\]/gi)].map((match) => Number(match[1])))].filter((page) => sourcePages.includes(page));
      next.push((await summarize({ text: groups[i], ...(groupPages.length ? { sourcePages: groupPages } : {}), length: 'medium', format, stage: 'combine', language })).text);
    }
    merged = next;
  }
  const reviewSource = sections.length === 1 ? `[Page ${sections[0].page}]\n${sections[0].text}` : merged.join('\n\n');
  let draft;
  if (sections.length === 1) draft = notes[0].replace(/^\[Page \d+\]\n/, '');
  else {
    onStatus('Writing the final summary…');
    draft = (await summarize({ text: reviewSource, sourcePages, length, format, stage: 'final', language })).text;
  }
  return review(draft, reviewSource);
}
