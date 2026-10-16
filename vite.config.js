import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createHandler } from './server/ai.js'
import { createWordPdfHandler } from './server/wordPdf.js'

export default defineConfig({
  plugins: [react(), {
    name: 'createpdf-local-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      const wordPdf = createWordPdfHandler({ env: { ...env, ...process.env } })
      server.middlewares.use('/api', (req, res) => {
        const task = req.url?.split('?')[0].replace(/^\//, '')
        if (task === 'word-to-pdf') return wordPdf(req, res)
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
    exclude: ['pdfjs-dist']
  },
  build: {
    rollupOptions: {},
  },
  worker: {
    format: 'es'
  }
})
