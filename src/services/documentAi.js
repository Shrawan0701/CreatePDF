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
  const sections = documentSections(pages, 6500);
  const sourcePages = [...new Set(pages.filter((page) => page.text.trim()).map((page) => page.page))];
  const notes = [];
  for (let i = 0; i < sections.length; i++) {
    onStatus(`Summarizing section ${i + 1} of ${sections.length}…`);
    const section = sections[i];
    const original = `[Page ${section.page}]\n${section.text}`;
    const summary = await request('summarize', { text: original, sourcePages: [section.page], length: sections.length === 1 ? length : 'detailed', format, stage: sections.length === 1 ? 'final' : 'section', language }, signal);
    // Source labels are attached by code, so they survive map/reduce even if the model omits them.
    let note = summary.text;
    if (sections.length > 1) {
      onStatus(`Checking section ${i + 1} against its source…`);
      note = (await request('summarize', { text: original, sourcePages: [section.page], draft: note, length: 'detailed', format, stage: 'review', language }, signal)).text;
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
      next.push((await request('summarize', { text: groups[i], ...(groupPages.length ? { sourcePages: groupPages } : {}), length: 'medium', format, stage: 'combine', language }, signal)).text);
    }
    merged = next;
  }
  const reviewSource = sections.length === 1 ? `[Page ${sections[0].page}]\n${sections[0].text}` : merged.join('\n\n');
  let draft;
  if (sections.length === 1) draft = notes[0].replace(/^\[Page \d+\]\n/, '');
  else {
    onStatus('Writing the final summary…');
    draft = (await request('summarize', { text: reviewSource, sourcePages, length, format, stage: 'final', language }, signal)).text;
  }
  if (draft.length > 14000) throw new Error('The summary is too long to review safely. Try a shorter summary length.');
  onStatus('AI is reviewing facts, figures, coverage and language…');
  return (await request('summarize', { text: reviewSource, sourcePages, draft, length, format, stage: 'review', language }, signal)).text;
}
