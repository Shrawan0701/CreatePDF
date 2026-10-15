# CreatePDF.si

CreatePDF.si is a local-first PDF toolkit with 59 registered tools for page management, editing, conversion, privacy, business documents, and collaboration. Core document processing runs in the browser; the optional Node server serves the built app and relays whiteboard and P2P signaling messages.

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

The production server listens on `PORT` (default `4173`) and exposes `GET /health` plus the `/signal` WebSocket endpoint. P2P sharing needs this server (or an equivalent `/signal` relay); the other tools run entirely in the browser.

## Quality gates

```bash
npm test
npm run lint
npm run build
npm run smoke
npm run smoke:conversion
npm run smoke:exports
npm audit --omit=dev
```

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
- Scanned PDFs require an OCR engine before text-based conversion or automatic PII detection. The app reports this instead of fabricating extracted content.

## Collaboration

Whiteboard room links use `BroadcastChannel` locally and automatically connect to `/signal` in production. Set `VITE_SIGNALING_URL=wss://example.com/signal` when the relay is hosted separately. P2P file sharing uses room-code signaling and WebRTC; file bytes do not pass through the server. Some networks require a TURN relay, which is not bundled.

## Privacy

Uploaded documents are not sent to the application server. Settings offers local JSON backup/restore, persistent-storage requests, and data clearing. Browser storage is not a permanent backup. The app does not require remote fonts or analytics.

The export smoke test can also run [EPUBCheck](https://github.com/w3c/epubcheck) when `EPUBCHECK_JAR` points to an installed `epubcheck.jar` and Java is available.
