import { createElement as h } from 'react';
import { VISIBLE_TOOLS as TOOLS } from '../data/tools.js';
import { FEATURED_SEO_TOOLS, TOOL_GUIDES } from './toolGuides.js';

const link = (Component, tool) => h(Component, { key: tool.id, ...(Component === 'a' ? { href: tool.route } : { to: tool.route }) }, tool.name);
const documentQuestions = {
  'pdf-translator': ['Can I translate a scanned PDF?', 'Yes. Printed text in scanned pages is recognized automatically before translation. Clear, upright scans give better results. Review names, numbers and formatting in the translated preview before downloading.'],
  'chat-with-pdf': ['How can I check an answer against my PDF?', 'Use the supporting quotes and source-page references shown with the answer. Open those pages to read the surrounding text, and ask a follow-up question if you need more detail.'],
  'pdf-summarizer': ['Can I choose the summary length and language?', 'Yes. Choose a short, medium or detailed summary, select the language, and pick a format such as key points, study notes or chapters. Review the result, then save it as TXT or PDF.'],
};
export function ToolGuide({ tool, LinkComponent = 'a' }) {
  const [purpose, steps, limitation] = TOOL_GUIDES[tool.id];
  const ai = tool.catKey === 'ai';
  const privacy = ai ? 'Your original PDF stays in your browser. Text from its pages is sent to our online document service to create the result. An internet connection is required.'
    : tool.id === 'html-to-pdf' ? 'HTML and CSS are sent to this app’s server for rendering, including previews. Referenced public HTTPS styles, fonts and images may be loaded. Uploaded scripts are disabled.'
    : ['word-to-pdf', 'powerpoint-to-pdf'].includes(tool.id) ? 'Your document is sent to this app’s server for layout-preserving conversion. The temporary document copy is deleted after conversion.'
    : tool.id === 'invoice-extractor' ? 'Text extraction and OCR run locally by default. If you choose optional AI extraction, the extracted bill text is sent to AI.'
    : tool.catKey === 'collab' ? 'Sharing and collaboration connect participants through the available rooms and peer connection. Only share documents and boards with the intended recipients.'
    : 'This tool processes your document in your browser. There is no document upload to the application server for this operation. Download the result to keep your own copy.';
  const related = [...TOOLS.filter((item) => item.id !== tool.id && item.category === tool.category), ...FEATURED_SEO_TOOLS.map((id) => TOOLS.find((item) => item.id === id))].filter((item, index, items) => item.id !== tool.id && items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 4);
  const extraQuestion = documentQuestions[tool.id] || ['Is a CreatePDF.tech account required?', 'No CreatePDF.tech account is needed. Core PDF operations do not add a watermark. Download any output you need to retain.'];
  return h('section', { className: 'tool-guide', 'aria-label': `${tool.name} guide` },
    h('h2', null, `How to use ${tool.name}`), h('p', null, purpose),
    h('ol', null, steps.map((step) => h('li', { key: step }, step))),
    h('h3', null, 'What to check before using the result'), h('p', null, limitation),
    h('div', { className: 'tool-guide-faq' },
      h('h3', null, 'Common questions'),
      h('details', null, h('summary', null, `Where does ${tool.name} process my document?`), h('p', null, privacy)),
      h('details', null, h('summary', null, `Can I use ${tool.name} on my phone?`), h('p', null, `Open ${tool.name} in a modern mobile browser and use the same document controls. Large files and image-heavy documents can take longer on a phone; a desktop browser is useful when you need more screen space.`)),
      h('details', null, h('summary', null, extraQuestion[0]), h('p', null, extraQuestion[1]))),
    h('h3', null, 'Related tools'), h('nav', { className: 'tool-guide-links', 'aria-label': `Related to ${tool.name}` }, related.map((item) => link(LinkComponent, item))));
}

export function HomeGuide({ LinkComponent = 'a' }) {
  return h('section', { className: 'tool-guide home-tool-guide', 'aria-label': 'PDF toolkit guide' },
    h('h2', null, 'Free online PDF tools for everyday document work'),
    h('p', null, 'Combine application documents, reduce an attachment’s size, turn images into a PDF or recover editable text for a Word document. CreatePDF.tech brings these different tasks into one browser workspace, with no account required for its core tools.'),
    h('h3', null, 'Choose the right tool for your file'),
    h('p', null, 'Merge PDF combines complete files. Split PDF keeps selected pages. Compress PDF reduces file size, while Images to PDF collects photographs into a document. PDF to Word reconstructs editable content; Word to PDF prepares a document for sharing. For a scanned file, the OCR-enabled translator, chat, summarizer and invoice extractor can recognize supported printed text.'),
    h('nav', { className: 'tool-guide-links', 'aria-label': 'Common PDF tasks' }, FEATURED_SEO_TOOLS.map((id) => link(LinkComponent, TOOLS.find((tool) => tool.id === id)))),
    h('h3', null, 'Document processing and privacy'),
    h('p', null, 'Core PDF tools work on your device and do not add watermarks. Translation, document questions and summaries send extracted text to an online document service and need an internet connection. Invoice extraction runs on your device unless you choose its optional online assistance. Scanned text is recognized in your browser, with language data downloaded on first use.'),
    h('h3', null, 'Review and save your output'),
    h('p', null, 'Check page order after merging or splitting, inspect images after compression, and review tables after converting a PDF into an editable format. AI and OCR results also need checking against the source. Download the finished file rather than relying only on browser storage.'));
}
