import { createElement as h } from 'react';
import { TOOLS } from '../data/tools.js';
import { FEATURED_SEO_TOOLS, TOOL_GUIDES } from './toolGuides.js';

const link = (Component, tool) => h(Component, { key: tool.id, ...(Component === 'a' ? { href: tool.route } : { to: tool.route }) }, tool.name);
export function ToolGuide({ tool, LinkComponent = 'a' }) {
  const [purpose, steps, limitation] = TOOL_GUIDES[tool.id];
  const ai = tool.catKey === 'ai';
  const privacy = ai ? 'This feature sends extracted document text to AI through the app’s API. The original PDF stays in your browser. A configured AI API key and internet access are required, and API usage is billed by AI.'
    : tool.id === 'html-to-pdf' ? 'HTML and CSS are sent to this app’s server for rendering, including previews. Referenced public HTTPS styles, fonts and images may be loaded. Uploaded scripts are disabled.'
    : ['word-to-pdf', 'powerpoint-to-pdf'].includes(tool.id) ? 'Your document is sent to this app’s server for layout-preserving conversion. The temporary document copy is deleted after conversion.'
    : tool.id === 'invoice-extractor' ? 'Text extraction and OCR run locally by default. If you choose optional AI extraction, the extracted bill text is sent to AI.'
    : tool.catKey === 'collab' ? 'Sharing and collaboration connect participants through the available room and peer connection. Only share documents and boards with the intended recipients.'
    : 'This tool processes your document in your browser. There is no document upload to the application server for this operation. Download the result to keep your own copy.';
  const related = [...TOOLS.filter((item) => item.id !== tool.id && item.category === tool.category), ...FEATURED_SEO_TOOLS.map((id) => TOOLS.find((item) => item.id === id))].filter((item, index, items) => item.id !== tool.id && items.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 4);
  return h('section', { className: 'tool-guide', 'aria-label': `${tool.name} guide` },
    h('h2', null, `How to use ${tool.name}`), h('p', null, purpose),
    h('ol', null, steps.map((step) => h('li', { key: step }, step))),
    h('h3', null, 'What to check before using the result'), h('p', null, limitation),
    h('div', { className: 'tool-guide-faq' },
      h('h3', null, 'Common questions'),
      h('details', null, h('summary', null, `Where does ${tool.name} process my document?`), h('p', null, privacy)),
      h('details', null, h('summary', null, `Can I use ${tool.name} on my phone?`), h('p', null, `Open ${tool.name} in a modern mobile browser and use the same document controls. Large files and image-heavy documents can take longer on a phone; a desktop browser is useful when you need more screen space.`)),
      h('details', null, h('summary', null, ai ? 'Does this AI feature have usage costs?' : 'Is a CreatePDF.si account required?'), h('p', null, ai ? 'The app has no subscription or account system, but the AI API key must be configured by the site operator. AI charges for the API requests, including review passes.' : 'No CreatePDF.si account is needed. Core PDF operations do not add a watermark. Download any output you need to retain.'))),
    h('h3', null, 'Related tools'), h('nav', { className: 'tool-guide-links', 'aria-label': `Related to ${tool.name}` }, related.map((item) => link(LinkComponent, item))));
}

export function HomeGuide({ LinkComponent = 'a' }) {
  return h('section', { className: 'tool-guide home-tool-guide', 'aria-label': 'PDF toolkit guide' },
    h('h2', null, 'Free online PDF tools for everyday document work'),
    h('p', null, 'Combine application documents, reduce an attachment’s size, turn images into a PDF or recover editable text for a Word document. CreatePDF.si brings these different tasks into one browser workspace, with no account required for its core tools.'),
    h('h3', null, 'Choose the right tool for your file'),
    h('p', null, 'Merge PDF combines complete files. Split PDF keeps selected pages. Compress PDF reduces file size, while Images to PDF collects photographs into a document. PDF to Word reconstructs editable content; Word to PDF prepares a document for sharing. For a scanned file, the OCR-enabled translator, chat, summarizer and invoice extractor can recognize supported printed text.'),
    h('nav', { className: 'tool-guide-links', 'aria-label': 'Common PDF tasks' }, FEATURED_SEO_TOOLS.map((id) => link(LinkComponent, TOOLS.find((tool) => tool.id === id)))),
    h('h3', null, 'Local PDF processing and optional AI'),
    h('p', null, 'Core PDF tools work on your device and do not add watermarks. AI translation, document questions and summaries send extracted text to AI, and require a configured API key. Invoice extraction is local unless you choose its AI option. OCR language data downloads on first use, while recognition runs in your browser.'),
    h('h3', null, 'Review and save your output'),
    h('p', null, 'Check page order after merging or splitting, inspect images after compression, and review tables after converting a PDF into an editable format. AI and OCR results also need checking against the source. Download the finished file rather than relying only on browser storage.'));
}
