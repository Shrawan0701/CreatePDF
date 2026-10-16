# CreatePDF.si

CreatePDF.si is a local-first PDF toolkit with 64 registered tools for page management, editing, conversion, privacy, business documents, AI document processing, and collaboration. Core document processing runs in the browser. AI tools use same-repository serverless functions and OpenAI `gpt-4o-mini`.

## Run locally

```bash
npm install
npm run dev
```

Production build and server:

```bash
npm run build
npm start
```

The optional production server listens on `PORT` (default `4173`), serves the same `/api` handlers, and exposes `GET /health` plus the `/signal` WebSocket endpoint. P2P sharing needs this server (or an equivalent `/signal` relay).

## OpenAI configuration and Vercel deployment

1. Create `.env.local` in the repository root and set `OPENAI_API_KEY=your-key` there. All `.env` files are ignored by Git and must stay local. Never use a `VITE_` prefix for this secret.
2. Run or restart `npm run dev`. Vite serves `/api/translate`, `/api/chat`, `/api/summarize` and `/api/invoice` on the same origin; no separate development server is needed.
3. On Vercel, import this repository, choose Vite, and add `OPENAI_API_KEY` to the appropriate project environment (Production and/or Preview). Deploy or redeploy after changing the secret. `vercel.json` preserves API functions and SPA routes.

No database, account system, or authentication is added. API functions use a fixed model and action-specific input validation, payload limits and timeouts. A public deployment makes AI actions publicly callable and charges your OpenAI account; configure provider spending limits for your deployment. Vercel does not host the optional WebSocket relay; existing P2P/whiteboard sharing still needs its relay for cross-device collaboration.

### New document tools

- **PDF Translator** (`/pdf-translator`): source/target language selection, English/Hindi/Marathi/Spanish/French/German/Portuguese/Italian, full-document chunked translation, structured text and PDF preview/download. Each translation batch gets surrounding context and a second AI proofreading pass against its original text. Headings, paragraphs, lists and detected table cells are reconstructed with the existing rich PDF renderer and local Devanagari fonts. Original artwork, exact typography, page count, and complex columns are not preserved.
- **Chat with PDF** (`/chat-with-pdf`): questions and answers in all eight languages, with an answer-language selector or automatic matching to the question. Small documents are supplied in full. Longer documents use AI evidence selection over every section, including cross-language and paraphrased matches, then up to 14 relevant sections are supplied for answering. Follow-up history is bounded and sent with both stages. Every supported draft gets an AI review against the evidence, followed by server checks of verbatim source quotes and page citations. Invalid evidence is rejected; unsupported answers use localized messages. Source quotes remain in their original language and open the original PDF page. Evidence selection and model review can still miss nuances; verified quotes do not guarantee every inference is correct.
- **PDF Summarizer** (`/pdf-summarizer`): short/medium/detailed executive summaries, key points, study notes and chapter-wise summaries, with a separate output-language selector for all eight languages or the document language. Every source chunk is summarized and reviewed against its original text; long results are combined hierarchically instead of truncating the source. The final summary gets an additional review for coverage, figures, language and unsupported claims. Physical page IDs are retained, unknown page references are rejected, and missing references or Hindi/Marathi script drift trigger a correction request. Preview and TXT/PDF exports use the selected language.
- **Purchase Bill / Invoice Extractor** (`/invoice-extractor`): local text/OCR first, optional OpenAI extraction, editable supplier/invoice/GST/line-item fields, missing-value and calculation checks, CSV/JSON export. Use one invoice per upload. The local parser handles labelled fields and simple line-item tables; complex bills may need the optional AI step or manual correction. Item and invoice discounts are absolute currency amounts. Unknown taxes/discounts stay blank and are treated as zero only for arithmetic checks, with a warning. CSV text is protected against spreadsheet formula injection.
- **Photo to Passport Sheet** (`/photo-to-passport`): local multiple-photo import, drag/slider crop positioning, zoom, per-photo copies, 35 × 45 mm, 2 × 2 inch or custom dimensions, A4/Letter, margins, spacing and cut guides. PDFs use exact physical points and 300-DPI raster output, with source-resolution warnings. Print at **100% / Actual size**, with “Fit to page” off. Crop controls do not certify official passport compliance or remove backgrounds.

OCR runs in the browser through Tesseract.js for all eight supported languages. Each language also offers an English-mixed option, alongside English + Hindi + Marathi. OCR language is the language printed in the scan, independent of answer/translation language. First use downloads the engine and selected language data; document images are processed locally. Automatic OCR runs on pages with little selectable text or replacement characters. “Rescan every page” replaces unreliable text layers with fresh OCR. Empty pages and low-confidence recognition are flagged. OCR recovers text rather than original table geometry. Failed downloads or unreadable scans produce errors rather than fabricated results.

All AI actions use strict JSON schemas with `gpt-4o-mini`. AI review and full-document evidence selection make extra model calls, so long documents take longer and consume more OpenAI usage. These checks reduce avoidable errors; they do not guarantee correctness. Summaries of very long documents are reviewed against factual section notes after the source-level reviews, rather than sending the entire original PDF into one request.

AI document tools require a configured, funded OpenAI API key and internet access. Missing configuration and upstream errors are displayed in the tool. Nothing stores the key in frontend code or browser storage, and no uploaded PDF is retained by the API handlers. Extracted text is sent to OpenAI only when an AI action runs; invoice AI is opt-in. Review AI/OCR outputs before using them.

## Quality gates

```bash
npm test
npm run lint
npm run build
npm run smoke
npm run smoke:conversion
npm run smoke:exports
npm run smoke:documents
npm run smoke:api
npm run smoke:seo
npm audit --omit=dev
```

## SEO and Vercel routing

`npm run build` creates one public HTML page per tool plus the homepage. Their titles, descriptions, canonical links, Open Graph/Twitter cards, JSON-LD, step-by-step guides, limitations, FAQs and internal links are present in the initial response, without requiring a crawler to execute JavaScript. The interactive app displays the same guide content and updates metadata during client navigation. The generated content contains no uploaded files or locally saved user data.

- The canonical origin defaults to **https://createpdf.si**. If your production domain differs, set the public `VITE_SITE_URL=https://your-domain.example` at build time, including in Vercel, and rebuild. Use the same value locally if you compare development metadata with production. This is a public URL, never an API key.
- `dist/sitemap.xml` lists the homepage and all 64 tool routes. `dist/robots.txt` points to it. Settings and missing pages use `noindex`; unknown URLs return HTTP 404 instead of displaying the homepage with a success status.
- `vercel.json` explicitly rewrites each tool route and `/settings` to its generated HTML file. API functions and static files are not sent to the homepage. URL aliases redirect to the clean route. Deploy from the repository root with `npm run build` and `dist` as the output directory. Changes to these files take effect after a new Vercel deployment.
- When adding or renaming a tool, update its entry in `src/seo/toolGuides.js`, then run `npm run seo:routes` and commit the updated `vercel.json`. The build and tests check route coverage. Common conversion/editing tools have dedicated search titles and prominent internal links; every tool has its own guide.
- `public/social-card.png` is a bundled 1200 × 630 social-preview image. Run `node scripts/generate-social-card.mjs` locally to regenerate it. Vercel builds do not require a browser executable.
- WebSite, Organization, WebApplication, WebPage, breadcrumb and tool-list JSON-LD describe actual features. No fabricated ratings, reviews, traffic counts or unsupported rich-result promises are included.

After deploying, verify the domain in [Google Search Console](https://search.google.com/search-console/about), submit `https://createpdf.si/sitemap.xml` (or your configured domain), and inspect a few tool URLs with URL Inspection. Check actual HTTPS URLs, mobile usability, generated metadata and structured data on the deployed host. Indexing and competitive rankings also depend on content usefulness, reputation, links and site performance; a technical SEO implementation cannot guarantee a first-place ranking.

`npm run smoke:seo` checks the served HTML and metadata for every route, JavaScript-disabled guide visibility, mobile deep-link refresh, metadata updates during navigation, API isolation, real 404 responses and the social image. It tests the local production server; the Vercel deployment still needs a post-deploy URL check. Implementation references: [Google’s JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) and [Vercel’s Vite deployment guidance](https://vercel.com/docs/frameworks/frontend/vite).

## Architecture

- React 19 and Vite with route-level lazy loading.
- `pdf-lib` for structural PDF operations and PDF generation.
- `pdfjs-dist` for rendering, text/layout analysis, and embedded-image discovery.
- IndexedDB for local invoices, POS data, resumes, recent files, and whiteboards.
- Dashboard document vault stores PDF bytes locally, reopens them in the editor, and supports rename, delete, download, and File System Access pick/save where the browser permits.
- Service worker and web manifest with versioned asset precaching and offline route navigation.
- Express and WebSocket server for static hosting and optional whiteboard relay.

## Conversion behavior

- PDF page operations, overlays, signatures, form filling, permanent raster redaction, encryption, metadata, and image rendering are performed locally.
- PDF-to-Word and PDF-to-Excel reconstruct editable content from detected text coordinates. Complex typography, merged cells, and vector artwork are best-effort because PDF does not store semantic document structure.
- PDF-to-PowerPoint places rendered pages on slides using the first page's aspect ratio and fits mixed-size pages without stretching.
- PDF-to-HTML exports page images with selectable text and supported links, either in one HTML file or a ZIP with local image assets.
- PDF-to-EPUB generates chapter files, a contents page, reading-order metadata, and typography controls. Page-image mode preserves appearance; scans are included as page images.
- PDF-to-Excel supports page selection, detected-table filtering, XLSX, and CSV output.
- Word imports preserve common headings, tables, PNG/JPEG images, links, paragraph alignment, source page size, and explicit page breaks. Complex layouts and mixed inline typography remain approximate.
- Excel imports offer worksheet selection, orientation, margins, text size, and column spacing. Cached formula values are retained; formulas are not recalculated, and charts and merged-cell styling are not reconstructed.
- CSV to PDF parses quoted fields, previews rows, supports column selection and portrait/landscape pages.
- PowerPoint import preserves slide count, aspect ratio, positioned basic text, solid shapes, and embedded PNG/JPEG images. Charts, effects, masters, and advanced typography are not supported.
- Create PDF, Markdown, and HTML support document import, page layout, margins, headers/footers, common headings, paragraphs, lists, clickable links, code, tables, and embedded local images. Previews block remote image and CSS resources. Arbitrary browser CSS is not reproduced.
- eBook import keeps EPUB spine order, chapter breaks, basic structure, and supported local images; TXT import and reading typography controls are also available.
- Resume Builder includes modern, classic, and compact templates, projects, local saved versions, and multi-page PDF output.
- Latin and Devanagari text, including the rupee sign, are supported in invoice, receipt, and structured-document PDF exports. Other scripts still need font support; extracted Devanagari text can have glyph-order differences despite rendering correctly.
- The new AI document tools and invoice extractor include local OCR for scans. Older text-based conversion and PII tools retain their existing behavior and do not automatically use this OCR pipeline.

## Collaboration

Whiteboard room links use `BroadcastChannel` locally and automatically connect to `/signal` in production. Set `VITE_SIGNALING_URL=wss://example.com/signal` when the relay is hosted separately. P2P file sharing uses room-code signaling and WebRTC; file bytes do not pass through the server. Some networks require a TURN relay, which is not bundled.

## Privacy

Core tools and passport-sheet generation process documents locally. AI tools explicitly send extracted text through the server-side OpenAI handlers; optional invoice AI is off by default. Settings offers local data clearing. Browser storage is not a permanent backup. PDF fonts are bundled locally; OCR engine/language assets download on first use. No analytics are added.

The document-tool smoke test uses real PDF/image processing and downloads. Its AI responses are deterministic test fixtures, not live OpenAI calls. Set `TEST_OCR=1` when running it to include actual English and Spanish OCR plus replacement of an incorrect PDF text layer. Unit tests cover language coverage, whole-document evidence scanning, AI review orchestration, strict response schemas, language/page validation, source quotes, invoice checks and physical passport layout. `npm run smoke:ai-live` is an opt-in, billable check using a small synthetic document with actual cross-language evidence selection, Marathi chat/translation, Hindi follow-ups/summaries and a French unsupported-answer check. This reads the server key from `.env.local` and never prints it. Set `AI_LIVE_FOCUS=summary` to run only summary and unsupported-answer checks.

The export smoke test can also run [EPUBCheck](https://github.com/w3c/epubcheck) when `EPUBCHECK_JAR` points to an installed `epubcheck.jar` and Java is available.
