import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHandler } from './server/ai.js'
import { createWordPdfHandler, createPowerpointPdfHandler } from './server/wordPdf.js'
import { createHtmlPdfHandler } from './server/htmlPdf.js'
import { attachWhiteboardRelay } from './server/whiteboard.js'

export default defineConfig({
  assetsInclude: ['**/*.wasm'],
  plugins: [react(), {
    name: 'createpdf-local-api',
    configureServer(server) {
      if (server.httpServer) attachWhiteboardRelay(server.httpServer)
      const env = loadEnv(server.config.mode, server.config.root, '')
      const wordPdf = createWordPdfHandler({ env: { ...env, ...process.env } })
      const powerpointPdf = createPowerpointPdfHandler({ env: { ...env, ...process.env } })
      const htmlPdf = createHtmlPdfHandler()
      server.middlewares.use('/api', (req, res) => {
        const task = req.url?.split('?')[0].replace(/^\//, '')
        if (task === 'word-to-pdf') return wordPdf(req, res)
        if (task === 'powerpoint-to-pdf') return powerpointPdf(req, res)
        if (task === 'html-to-pdf') return htmlPdf(req, res)
        if (!['translate', 'chat', 'summarize', 'invoice'].includes(task)) {
          res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Unknown API endpoint.' })); return
        }
        return createHandler(task, { apiKey: process.env.OPENAI_API_KEY || env.OPENAI_API_KEY })(req, res)
      })
    },
  }],
  server: {
    proxy: {
      '/signal': { target: 'ws://localhost:4173', ws: true },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom'],
    exclude: ['pdfjs-dist', '@lipoe/browser-qpdf']
  },
  build: {
    rollupOptions: {},
  },
  worker: {
    format: 'es'
  }
})
