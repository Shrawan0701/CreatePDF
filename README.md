# CreatePDF.si

CreatePDF.si is a local-first PDF toolkit with 59 registered tools for page management, editing, conversion, privacy, business documents, and collaboration. Core document processing runs in the browser; the optional Node server only serves the built app and relays whiteboard messages.

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

The production server listens on `PORT` (default `4173`) and exposes `GET /health` plus the `/signal` WebSocket endpoint.

## Quality gates

```bash
npm test
npm run lint
npm run build
npm audit --omit=dev
```

## Architecture

- React 19 and Vite with route-level lazy loading.
- `pdf-lib` for structural PDF operations and PDF generation.
- `pdfjs-dist` for rendering, text/layout analysis, and embedded-image discovery.
- IndexedDB for local invoices, POS data, resumes, recent files, and whiteboards.
- Service worker and web manifest for installable/offline app-shell behavior.
- Express and WebSocket server for static hosting and optional whiteboard relay.

## Conversion behavior

- PDF page operations, overlays, signatures, form filling, permanent raster redaction, encryption, metadata, and image rendering are performed locally.
- PDF-to-Word and PDF-to-Excel reconstruct editable content from detected text coordinates. Complex typography, merged cells, and vector artwork are best-effort because PDF does not store semantic document structure.
- PDF-to-PowerPoint preserves appearance by placing each rendered PDF page on a slide.
- Word, Excel, and PowerPoint imports read Open XML content locally. They preserve textual/table structure but do not claim pixel-identical Office rendering.
- Scanned PDFs require an OCR engine before text-based conversion or automatic PII detection. The app reports this instead of fabricating extracted content.

## Collaboration

Whiteboard room links use `BroadcastChannel` locally and automatically connect to `/signal` in production. Set `VITE_SIGNALING_URL=wss://example.com/signal` when the relay is hosted separately. P2P file sharing uses WebRTC and manual offer/answer exchange; file bytes do not pass through the server.

## Privacy

Uploaded documents are not sent to the application server. Browser memory and local storage are cleared by the user from Settings. Remote fonts and analytics are not required for PDF processing.
