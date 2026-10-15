import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
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
